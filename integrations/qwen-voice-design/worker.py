"""独立的自主音色短句工作器；只使用固定本地权重，不下载或克隆真人声音。"""
import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import random
import sys
import time
from datetime import datetime, timezone

MANIFEST_FILE = Path(__file__).with_name("manifest.json")


def now():
    return datetime.now(timezone.utc).isoformat()


def inference_lock(home):
    # 操作系统持有锁，进程退出自动释放；不能凭遗留文件误判仍在推理。
    stream = (Path(home) / "candidate-inference.lock").open("a+b")
    try:
        stream.seek(0, 2)
        if stream.tell() == 0:
            stream.write(b" ")
            stream.flush()
        stream.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return stream
    except Exception as error:
        stream.close()
        raise RuntimeError("自主音色模型正被另一进程使用，请等待其完成或停止后再试") from error


def sha256(file):
    digest = hashlib.sha256()
    with Path(file).open("rb") as source:
        for chunk in iter(lambda: source.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(file):
    return json.loads(Path(file).read_text(encoding="utf-8-sig"))


def validate_job(value):
    fields = {"text", "instruct", "language", "seed", "max_new_tokens"}
    if not isinstance(value, dict) or set(value) != fields:
        raise ValueError("音色设计输入字段不完整或包含不支持的字段；不接受参考音频")
    for name, limit in (("text", 200), ("instruct", 1000)):
        if not isinstance(value[name], str) or not value[name].strip() or len(value[name]) > limit or "\x00" in value[name]:
            raise ValueError("音色设计正文或描述为空、过长或含无效字符")
    if value["language"] != "Chinese":
        raise ValueError("当前短句候选只验证中文")
    for name, low, high in (("seed", 0, 2**32 - 1), ("max_new_tokens", 128, 2048)):
        if type(value[name]) is not int or not low <= value[name] <= high:
            raise ValueError("音色设计采样参数无效：" + name)
    return dict(value)


def model_files(home, manifest):
    root = (Path(home) / "models/voice-design").resolve()
    problems, records = [], []
    if not manifest.get("files"):
        raise ValueError("固定模型清单为空")
    for item in manifest["files"]:
        name = item["file"]
        relative = Path(name)
        if relative.is_absolute() or ".." in relative.parts or "\\" in name or ":" in name:
            raise ValueError("固定清单包含无效路径")
        file = (root / relative).resolve()
        if root not in file.parents:
            raise ValueError("模型文件指向目标目录之外")
        if not file.is_file() or file.stat().st_size != item["bytes"]:
            problems.append({"file": name, "issue": "模型缺失或大小不符"})
            continue
        actual = sha256(file)
        if item.get("sha256"):
            valid = actual == item["sha256"]
        elif item.get("gitBlobId"):
            content = file.read_bytes()
            blob = hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()
            valid = blob == item["gitBlobId"]
        else:
            raise ValueError("固定清单缺少文件校验依据：" + name)
        if not valid:
            problems.append({"file": name, "issue": "模型校验不符"})
        records.append({"file": name, "sha256": actual, "bytes": file.stat().st_size})
    return {"root": str(root), "ready": not problems, "issues": problems, "files": records}


def package_files(manifest):
    spec = manifest["package"]
    try:
        distribution = importlib.metadata.distribution(spec["name"])
    except importlib.metadata.PackageNotFoundError:
        return {"ready": False, "issues": ["缺少独立的 qwen-tts 依赖环境"]}
    issues = []
    if distribution.version != spec["version"]:
        issues.append("qwen-tts 版本与固定发行包不符")
    for item in spec["sourceFiles"]:
        file = distribution.locate_file(item["file"])
        if not file.is_file() or sha256(file) != item["sha256"]:
            issues.append("qwen-tts 源码不符：" + item["file"])
    return {"ready": not issues, "version": distribution.version, "issues": issues}


def save_receipt(directory, value):
    temporary = directory / "result.partial.json"
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, directory / "result.json")


def inspect(home, manifest):
    weights = model_files(home, manifest)
    package = package_files(manifest)
    result = {"weights": weights, "package": package, "ready": weights["ready"] and package["ready"], "cuda": None}
    # 缺少环境或权重时不导入模型，更不尝试联网自动补齐。
    if result["ready"]:
        try:
            for name, expected in (("transformers", "4.57.3"), ("accelerate", "1.12.0")):
                actual = importlib.metadata.version(name)
                if actual != expected:
                    raise RuntimeError(name + " 版本不符：" + actual)
            import torch
            from qwen_tts import Qwen3TTSModel
            if not callable(getattr(Qwen3TTSModel, "generate_voice_design", None)):
                raise RuntimeError("本地发行包没有自主音色设计接口")
            result["torch"] = torch.__version__
            result["cuda"] = torch.cuda.is_available()
            result["ready"] = result["cuda"]
            if result["cuda"]:
                result["device"] = torch.cuda.get_device_name(0)
        except Exception as error:
            result["ready"] = False
            result["dependencyError"] = str(error)
    return result


def infer(directory, job, environment, manifest, receipt):
    import numpy as np
    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSModel

    random.seed(job["seed"])
    np.random.seed(job["seed"])
    torch.manual_seed(job["seed"])
    torch.cuda.manual_seed_all(job["seed"])
    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    model = Qwen3TTSModel.from_pretrained(environment["weights"]["root"], device_map="cuda:0", dtype=dtype,
                                         attn_implementation="sdpa", local_files_only=True)
    receipt["modelLoaded"] = True
    receipt["inferenceStarted"] = True
    receipt["dtype"] = str(dtype)
    save_receipt(directory, receipt)
    wavs, sample_rate = model.generate_voice_design(text=job["text"], instruct=job["instruct"],
                                                   language=job["language"], non_streaming_mode=True,
                                                   max_new_tokens=job["max_new_tokens"])
    if not isinstance(wavs, (list, tuple)) or len(wavs) != 1:
        raise ValueError("模型没有返回一条实际声音")
    audio = np.asarray(wavs[0], dtype=np.float32)
    if audio.ndim != 1 or not audio.size or not np.isfinite(audio).all():
        raise ValueError("模型声音为空、非单声道或包含无效采样")
    if type(sample_rate) is not int or not 8000 <= sample_rate <= 96000:
        raise ValueError("模型采样率无效")
    duration = audio.size / sample_rate
    peak = float(np.max(np.abs(audio)))
    rms = float(np.sqrt(np.mean(audio.astype(np.float64) ** 2)))
    if not 0.25 <= duration <= 90 or peak < 1e-5 or not math.isfinite(rms):
        raise ValueError("实际短句时长或能量无效")
    # 原始浮点输出留档；试听量化前的增益单独记录，不据此声称改善了真人感。
    raw = directory / "voice-design-raw-float.wav"
    output = directory / "voice-design.wav"
    gain = min(1.0, 0.95 / peak)
    for file, sound, subtype in ((raw, audio, "FLOAT"), (output, audio * gain, "PCM_16")):
        with file.open("xb") as target:
            sf.write(target, sound, sample_rate, format="WAV", subtype=subtype)
    decoded, decoded_rate = sf.read(output, dtype="int16")
    if decoded_rate != sample_rate or decoded.shape != audio.shape:
        raise ValueError("新声音写入后采样信息不一致")
    post = model_files(Path(environment["weights"]["root"]).parent.parent, manifest)
    if not post["ready"] or post["files"] != environment["weights"]["files"]:
        raise ValueError("生成期间模型文件发生变化")
    receipt.update(status="technical-complete", newSpeechGenerated=True, sampleRate=sample_rate,
                   samples=int(audio.size), duration=duration, output=str(output), outputSha256=sha256(output),
                   rawOutput=str(raw), rawOutputSha256=sha256(raw),
                   audio={"rawPeak": peak, "rawRms": rms, "rawFullScalePoints": int(np.count_nonzero(np.abs(audio) >= 1)),
                          "quantizationGain": gain, "pcmFullScalePoints": int(np.count_nonzero((decoded == 32767) | (decoded == -32768)))})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--directory", type=Path, required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--job", type=Path)
    args = parser.parse_args()
    if not args.home.is_absolute() or not args.directory.is_absolute():
        parser.error("运行时和新候选目录必须为绝对路径")
    if args.home.resolve() == args.directory.resolve() or args.home.resolve() in args.directory.resolve().parents:
        parser.error("候选输出不能写入模型运行时")
    manifest = read_json(MANIFEST_FILE)
    job = validate_job(read_json(args.job)) if args.job else None
    args.directory.mkdir(exist_ok=False)
    started = time.monotonic()
    receipt = {"at": now(), "status": "checking", "kind": "environment-check" if args.check else "voice-design",
               "model": manifest["repo"], "modelRevision": manifest["revision"],
               "packageVersion": manifest["package"]["version"], "job": job, "referenceAudio": None,
               "modelLoaded": False, "inferenceStarted": False, "newSpeechGenerated": False,
               "naturalnessAccepted": False, "characterMatchAccepted": False, "qualityAccepted": False}
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1", PYTHONNOUSERSITE="1")
    save_receipt(args.directory, receipt)
    exit_code = 0
    lock = None
    try:
        environment = inspect(args.home, manifest)
        receipt["environment"] = environment
        if not environment["ready"]:
            raise RuntimeError("自主音色环境未就绪；请查看缺少的模型或依赖，未自动下载任何文件")
        if args.check:
            receipt["status"] = "environment-ready"
        else:
            lock = inference_lock(args.home)
            receipt["status"] = "running"
            save_receipt(args.directory, receipt)
            infer(args.directory, job, environment, manifest, receipt)
    except KeyboardInterrupt:
        receipt.update(status="cancelled", error="自主音色生成已停止")
        exit_code = 130
    except Exception as error:
        receipt.update(status="failed", error=str(error))
        exit_code = 1
    finally:
        if lock:
            lock.close()
    receipt["elapsedSeconds"] = time.monotonic() - started
    save_receipt(args.directory, receipt)
    print(json.dumps({"status": receipt["status"], "directory": str(args.directory), "newSpeechGenerated": receipt["newSpeechGenerated"],
                      "qualityAccepted": False}, ensure_ascii=False))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
