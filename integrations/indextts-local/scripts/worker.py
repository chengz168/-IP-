"""Token-authenticated loopback worker; model imports happen only in main()."""
from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import secrets
import threading
import time
import traceback
import uuid
import wave

from common import environment, models, read_json, write_json
from audio_headroom import POLICY, prepare_waveform

EMOTIONS = ("happy", "angry", "sad", "afraid", "disgusted", "melancholic", "surprised", "calm")


def validate_payload(data):
    if not isinstance(data, dict):
        raise ValueError("Request must be a JSON object.")
    if not isinstance(data.get("text"), str) or not data["text"].strip() or len(data["text"]) > 100000:
        raise ValueError("Text must contain 1–100000 characters.")
    if data.get("language", "ZH") not in {"ZH", "EN", "JA", "ES", "AR"}:
        raise ValueError("Unsupported language.")
    for key, low, high, default in (("speed", 0.5, 2, 1), ("emotion_strength", 0, 1, 0.8)):
        value = data.get(key, default)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f"{key} must be between {low} and {high}.")
    seed = data.get("seed", 1234)
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed < 2**32:
        raise ValueError("Seed must be an integer between 0 and 4294967295.")
    if data.get("emotion") is not None and data["emotion"] not in EMOTIONS:
        raise ValueError("Unknown emotion.")
    modes = [data.get(name) for name in ("emotion", "emotion_reference", "emotion_text")]
    if sum(bool(item) for item in modes) > 1:
        raise ValueError("Use one emotion mode per request.")
    if data.get("emotion_text") is not None and (not isinstance(data["emotion_text"], str) or not data["emotion_text"].strip()):
        raise ValueError("Emotion description is empty.")
    for key in ("reference", "emotion_reference"):
        value = data.get(key)
        if key == "emotion_reference" and value is None:
            continue
        if not isinstance(value, str) or not Path(value).is_absolute() or not Path(value).is_file():
            raise ValueError(f"{key} must be an existing absolute audio path.")
    output = data.get("output")
    if not isinstance(output, str) or not Path(output).is_absolute() or Path(output).suffix.lower() != ".wav":
        raise ValueError("Output must be an absolute .wav path.")
    if "overwrite" in data and not isinstance(data["overwrite"], bool):
        raise ValueError("overwrite must be true or false.")
    if Path(output).exists() and not data.get("overwrite", False):
        raise ValueError("Output exists; choose another path or enable overwrite.")


def inference_arguments(data, temporary):
    kwargs = {
        "spk_audio_prompt": data["reference"], "text": data["text"],
        "output_path": str(temporary), "lang": data.get("language", "ZH"),
        "duration_factor": 1.0 / data.get("speed", 1.0),
        "use_random": False, "verbose": False,
    }
    strength = data.get("emotion_strength", 0.8)
    if data.get("emotion"):
        vector = [0.0] * 8
        vector[EMOTIONS.index(data["emotion"])] = strength
        kwargs["emo_vector"] = vector
    elif data.get("emotion_reference"):
        kwargs.update(emo_audio_prompt=data["emotion_reference"], emo_alpha=strength)
    elif data.get("emotion_text"):
        kwargs.update(use_emo_text=True, emo_text=data["emotion_text"], emo_alpha=strength)
    return kwargs


class Service:
    def __init__(self, home, qwen_emotion=False):
        self.home = home
        self.token = secrets.token_urlsafe(32)
        self.engine = None
        self.stage = "loading"
        self.qwen_emotion = qwen_emotion
        self.lock = threading.Lock()
        self.last_used = time.monotonic()
        self.error = None

    def health(self):
        return {"stage": self.stage, "busy": self.lock.locked(), "pid": os.getpid(),
                "qwen_emotion": self.qwen_emotion, "error": self.error}

    def persist(self, port):
        write_json(self.home / "worker.json", dict(self.health(), token=self.token, port=port))

    def synthesize(self, data):
        validate_payload(data)
        if data.get("emotion_text") and not self.qwen_emotion:
            raise ValueError("Restart with --emotion-text to enable QwenEmotion.")
        output = Path(data["output"])
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.parent / f".{output.stem}-{uuid.uuid4().hex}.partial.wav"
        started = time.monotonic()
        mastering = []
        # 固定版本BigVGAN会先限幅再返回，因此必须在最终卷积之后、限幅之前处理。
        vocoder = self.engine.bigvgan
        if getattr(vocoder, "use_tanh_at_final", None) is not False or not hasattr(vocoder, "conv_post"):
            raise RuntimeError("当前声码器结构与已验证的量化前保护不一致，未启动生成")
        def preserve_headroom(module, inputs, waveform):
            adjusted, record = prepare_waveform(waveform)
            record["location"] = "bigvgan.conv_post-before-clamp"
            mastering.append(record)
            return adjusted
        handle = vocoder.conv_post.register_forward_hook(preserve_headroom)
        try:
            # The engine resets its own random generators because calls are serialized.
            if hasattr(self.engine, "set_seed"):
                self.engine.set_seed(data.get("seed", 1234))
            self.engine.infer(**inference_arguments(data, temporary))
            if not mastering:
                raise RuntimeError("没有收到量化前的声码器音频，未保存本次结果")
            if not temporary.is_file() or temporary.stat().st_size <= 44:
                raise RuntimeError("The model did not produce a nonempty WAV.")
            with wave.open(str(temporary), "rb") as audio:
                duration = audio.getnframes() / audio.getframerate()
                sample_rate = audio.getframerate()
                if duration <= 0:
                    raise RuntimeError("The model returned empty audio.")
            if data.get("overwrite", False):
                os.replace(temporary, output)
            else:
                # Atomic no-clobber publication, even if another request creates output.
                os.link(temporary, output)
            return {"output": str(output), "duration_seconds": round(duration, 3),
                    "sample_rate": sample_rate, "elapsed_seconds": round(time.monotonic() - started, 3),
                    "audio_mastering": {"policy": POLICY, "stages": mastering}}
        finally:
            handle.remove()
            temporary.unlink(missing_ok=True)
            self.last_used = time.monotonic()


def make_server(service):
    class Handler(BaseHTTPRequestHandler):
        def reply(self, code, data):
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def authorized(self):
            supplied = self.headers.get("Authorization", "")
            if self.headers.get("Origin") or not secrets.compare_digest(supplied, f"Bearer {service.token}"):
                self.reply(401, {"error": "Local worker authentication required."})
                return False
            return True

        def do_GET(self):
            if self.authorized():
                self.reply(200, service.health()) if self.path == "/health" else self.reply(404, {"error": "Unknown route."})

        def do_POST(self):
            if not self.authorized():
                return
            if self.path not in {"/speak", "/stop"}:
                self.reply(404, {"error": "Unknown route."})
                return
            if not service.lock.acquire(blocking=False):
                self.reply(409, {"error": "Worker is generating audio. Try after it finishes."})
                return
            try:
                if self.path == "/stop":
                    if service.stage == "loading":
                        self.reply(409, {"error": "Model is loading. Retry stop once loading finishes."})
                        return
                    self.reply(200, {"stage": "stopping"})
                    threading.Thread(target=self.server.shutdown, daemon=True).start()
                    return
                if service.stage != "ready":
                    self.reply(503, {"error": "Model is not ready.", "stage": service.stage})
                    return
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 1024 * 1024:
                    raise ValueError("JSON request must be at most 1 MiB.")
                data = json.loads(self.rfile.read(length))
                self.reply(200, service.synthesize(data))
            except (ValueError, TypeError, KeyError) as error:
                self.reply(400, {"error": str(error)})
            except Exception as error:
                traceback.print_exc()
                self.reply(500, {"error": str(error)})
            finally:
                service.lock.release()

        def log_message(self, format, *args):
            pass

    return ThreadingHTTPServer(("127.0.0.1", 0), Handler)


def load_engine(home, qwen_emotion):
    os.environ.update(environment(home))
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    # Every aux model was explicitly downloaded through the selected HF endpoint.
    from indextts.utils import model_download
    model_download._USING_MODELSCOPE = False
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable. Run doctor to inspect the isolated PyTorch installation.")
    from indextts.infer_v2_5 import IndexTTS2
    engine = IndexTTS2(cfg_path=str(models(home) / "config.yaml"), model_dir=str(models(home)),
                       device="cuda:0", use_bf16=True, use_cuda_kernel=False,
                       use_deepspeed=False, use_accel=False, use_torch_compile=False,
                       use_qwen_emo=qwen_emotion)

    def set_seed(seed):
        import random
        import numpy as np
        random.seed(seed)
        np.random.seed(seed)
        torch.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)

    engine.set_seed = set_seed
    return engine


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--emotion-text", action="store_true")
    parser.add_argument("--idle-seconds", type=int, default=900)
    args = parser.parse_args()
    home = args.home.resolve()
    service = Service(home, args.emotion_text)
    server = make_server(service)
    port = server.server_port
    service.persist(port)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        service.engine = load_engine(home, args.emotion_text)
        service.stage = "ready"
        service.last_used = time.monotonic()
        service.persist(port)
        print("IndexTTS-2.5 worker ready.", flush=True)
        while thread.is_alive():
            thread.join(timeout=1)
            if not service.lock.locked() and time.monotonic() - service.last_used > args.idle_seconds:
                server.shutdown()
    except Exception as error:
        service.stage = "failed"
        service.error = str(error)
        service.persist(port)
        traceback.print_exc()
        server.shutdown()
    finally:
        server.server_close()
        state_path = home / "worker.json"
        state = read_json(state_path, {})
        if service.stage != "failed" and state.get("token") == service.token:
            state_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
