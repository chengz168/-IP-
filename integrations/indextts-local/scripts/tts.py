"""Codex-friendly CLI. Only the inference subprocess needs third-party packages."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

from common import (ENDPOINTS, SCRIPTS, UPSTREAM_REVISION, UPSTREAM_URL, default_home, environment,
                    missing_models, read_json, runtime_python, write_json)


def emit(value):
    print(json.dumps(value, ensure_ascii=False, indent=2))


def run(command, home, cwd=None):
    subprocess.run([str(item) for item in command], cwd=cwd or home,
                   env=environment(home), check=True)


def api(state, route="/health", payload=None, timeout=3):
    # Never send a local worker credential through an HTTP proxy.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"http://127.0.0.1:{int(state['port'])}{route}", data=body,
        headers={"Authorization": f"Bearer {state['token']}", "Content-Type": "application/json"})
    try:
        with opener.open(request, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Worker HTTP {error.code}: {detail}") from error


def live_worker(home):
    state = read_json(home / "worker.json", {})
    if not state:
        return None
    try:
        return api(state)
    except urllib.error.URLError as error:
        if isinstance(error.reason, PermissionError):
            raise RuntimeError("Local worker communication is blocked by the execution sandbox. "
                               "Run this same command with local-network permission; "
                               "do not start another worker.") from error
        return None
    except (OSError, ValueError, KeyError, RuntimeError):
        return None


def status(home):
    stored = read_json(home / "worker.json", {})
    last_failure = {"stage": "failed", "error": stored.get("error")} if stored.get("stage") == "failed" else {"stage": "stopped"}
    return {
        "home": str(home),
        "source": read_json(home / "settings.json", {}).get("source", "hf-mirror"),
        "dependencies_installed": runtime_python(home).is_file() and (home / "setup.json").is_file(),
        "missing_models": missing_models(home),
        "worker": live_worker(home) or last_failure,
        "log": str(home / "worker.log"),
    }


def download(home, source=None, sample=False):
    if not runtime_python(home).is_file():
        raise RuntimeError("Runtime missing. Run setup first.")
    selected = source or read_json(home / "settings.json", {}).get("source", "hf-mirror")
    write_json(home / "settings.json", {"source": selected})
    command = [runtime_python(home), SCRIPTS / "download_models.py", "--home", home, "--source", selected]
    if sample:
        command.append("--sample")
    run(command, home, home / "upstream")


def setup(home, args):
    if live_worker(home):
        raise RuntimeError("Stop the worker before changing its environment.")
    for tool in ("git", "uv"):
        if not shutil.which(tool):
            raise RuntimeError(f"{tool} is required on PATH.")
    home.mkdir(parents=True, exist_ok=True)
    write_json(home / "settings.json", {"source": args.source})
    repo = home / "upstream"
    if not (repo / ".git").is_dir():
        if repo.exists() and any(repo.iterdir()):
            raise RuntimeError(f"Refusing to replace a non-Git directory: {repo}")
        run(["git", "clone", "--depth", "1", "--filter=blob:none", "--no-checkout", "--progress", UPSTREAM_URL, repo], home)
        run(["git", "fetch", "--depth", "1", "--progress", "origin", UPSTREAM_REVISION], home, repo)
    else:
        current = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo,
                                          text=True, env=environment(home)).strip()
        if current != UPSTREAM_REVISION:
            raise RuntimeError(f"Upstream checkout is {current}; expected {UPSTREAM_REVISION}. "
                               "Use another --home rather than resetting this checkout.")
    # Exclude videos, paper figures and benchmark assets from the partial clone.
    run(["git", "sparse-checkout", "init", "--cone"], home, repo)
    paths = ["indextts", "examples"] + (["assets"] if args.webui else [])
    run(["git", "sparse-checkout", "set", *paths], home, repo)
    run(["git", "checkout", "--detach", UPSTREAM_REVISION], home, repo)
    marker = home / "setup.json"
    marker.unlink(missing_ok=True)
    command = ["uv", "sync", "--project", repo, "--python", "3.11", "--no-dev"]
    if args.webui:
        command.extend(["--extra", "webui"])
    run(command, home, repo)
    write_json(marker, {"upstream_revision": UPSTREAM_REVISION, "webui": args.webui})
    if not args.skip_download:
        download(home, args.source, args.sample)
    emit(status(home))


def start(home, emotion_text=False):
    existing = live_worker(home)
    if existing:
        if emotion_text and not existing.get("qwen_emotion"):
            raise RuntimeError("Worker was started without QwenEmotion. Run stop, then retry.")
        return existing
    if not runtime_python(home).is_file() or not (home / "setup.json").is_file():
        raise RuntimeError("Dependencies missing. Run setup first.")
    missing = missing_models(home)
    if missing:
        raise RuntimeError("Model download incomplete. Run download. Missing: " + ", ".join(missing))
    lock = home / "start.lock"
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        # A launcher owns this lock only while spawning, not throughout model load.
        if time.time() - lock.stat().st_mtime > 60:
            lock.unlink(missing_ok=True)
            return start(home, emotion_text)
        raise RuntimeError("Another launcher is starting the worker. Check status shortly.")
    try:
        os.close(fd)
        state_path = home / "worker.json"
        state_path.unlink(missing_ok=True)
        command = [str(runtime_python(home)), str(SCRIPTS / "worker.py"), "--home", str(home)]
        if emotion_text:
            command.append("--emotion-text")
        options = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {"start_new_session": True}
        with (home / "worker.log").open("a", encoding="utf-8") as log:
            process = subprocess.Popen(command, cwd=home / "upstream", env=environment(home),
                                       stdin=subprocess.DEVNULL, stdout=log, stderr=log, **options)
        for _ in range(100):
            if state_path.exists():
                state = read_json(state_path)
                return {"stage": state["stage"], "pid": state["pid"], "qwen_emotion": emotion_text}
            if process.poll() is not None:
                raise RuntimeError(f"Worker exited before startup. See {home / 'worker.log'}")
            time.sleep(0.1)
        raise RuntimeError(f"Worker startup has not published status. See {home / 'worker.log'}")
    finally:
        lock.unlink(missing_ok=True)


def voice_registry(home):
    return read_json(home / "voices.json", {})


def voice_command(home, args):
    registry = voice_registry(home)
    if args.voice_action == "list":
        emit(registry)
        return
    if not re.fullmatch(r"[\w-]{1,64}", args.name):
        raise ValueError("Voice name must contain 1–64 letters, numbers, underscores or hyphens.")
    if args.name in registry and not args.overwrite:
        raise ValueError("Voice exists. Choose another name or pass --overwrite.")
    audio = Path(args.audio).expanduser().resolve()
    if not audio.is_file():
        raise ValueError(f"Reference audio missing: {audio}")
    target = home / "voices" / (args.name + audio.suffix.lower())
    target.parent.mkdir(parents=True, exist_ok=True)
    if audio != target:
        shutil.copy2(audio, target)
    registry[args.name] = {"audio": str(target)}
    write_json(home / "voices.json", registry)
    emit({"voice": args.name, "audio": str(target)})


def speak(home, args):
    text = Path(args.text_file).read_text(encoding="utf-8-sig") if args.text_file else args.text
    if not text.strip():
        raise ValueError("Text is empty.")
    if args.voice:
        entry = voice_registry(home).get(args.voice)
        if entry is None:
            raise ValueError(f"Unknown voice: {args.voice}. Run voices list.")
        reference = Path(entry["audio"])
    else:
        reference = Path(args.reference).expanduser().resolve()
    if not reference.is_file():
        raise ValueError(f"Reference audio missing: {reference}")
    output = Path(args.output).expanduser().resolve() if args.output else home / "outputs" / f"speech-{uuid.uuid4().hex[:12]}.wav"
    if output.suffix.lower() != ".wav":
        raise ValueError("Output must be a .wav file.")
    if output.exists() and not args.overwrite:
        raise ValueError(f"Output exists: {output}. Use another path or --overwrite.")
    payload = {"text": text, "reference": str(reference), "output": str(output),
               "language": args.language, "speed": args.speed,
               "emotion": args.emotion, "emotion_strength": args.emotion_strength,
               "emotion_reference": str(Path(args.emotion_reference).resolve()) if args.emotion_reference else None,
               "emotion_text": args.emotion_text, "seed": args.seed, "overwrite": args.overwrite}
    # Validate before loading several GB into VRAM.
    from worker import validate_payload
    validate_payload(payload)
    start(home, bool(args.emotion_text))
    deadline = time.monotonic() + args.timeout
    while time.monotonic() < deadline:
        state = read_json(home / "worker.json", {})
        if state.get("stage") == "failed":
            raise RuntimeError(f"{state.get('error', 'Model loading failed')}. See {home / 'worker.log'}")
        health = live_worker(home)
        if health and health.get("stage") == "ready":
            remaining = max(1, deadline - time.monotonic())
            emit(api(state, "/speak", payload, timeout=remaining))
            return
        time.sleep(0.5)
    raise TimeoutError(f"Model not ready within {args.timeout}s. See {home / 'worker.log'}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=default_home())
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("setup", help="Install isolated runtime and download models")
    p.add_argument("--source", choices=ENDPOINTS, default="hf-mirror")
    p.add_argument("--skip-download", action="store_true")
    p.add_argument("--sample", action="store_true")
    p.add_argument("--webui", action="store_true")
    p = sub.add_parser("download", help="Resume all model downloads")
    p.add_argument("--source", choices=ENDPOINTS)
    p.add_argument("--sample", action="store_true")
    sub.add_parser("status")
    sub.add_parser("doctor", help="Check installed Torch and CUDA")
    p = sub.add_parser("start")
    p.add_argument("--emotion-text", action="store_true")
    sub.add_parser("stop")
    p = sub.add_parser("voices")
    voices = p.add_subparsers(dest="voice_action", required=True)
    voices.add_parser("list")
    v = voices.add_parser("add")
    v.add_argument("name")
    v.add_argument("--audio", required=True)
    v.add_argument("--overwrite", action="store_true")
    p = sub.add_parser("speak")
    text = p.add_mutually_exclusive_group(required=True)
    text.add_argument("--text")
    text.add_argument("--text-file")
    voice = p.add_mutually_exclusive_group(required=True)
    voice.add_argument("--reference")
    voice.add_argument("--voice")
    p.add_argument("--output")
    p.add_argument("--language", choices=("ZH", "EN", "JA", "ES", "AR"), default="ZH")
    p.add_argument("--speed", type=float, default=1.0, help="0.5–2; larger means faster")
    emo = p.add_mutually_exclusive_group()
    emo.add_argument("--emotion", choices=("happy", "angry", "sad", "afraid", "disgusted", "melancholic", "surprised", "calm"))
    emo.add_argument("--emotion-reference")
    emo.add_argument("--emotion-text")
    p.add_argument("--emotion-strength", type=float, default=0.8)
    p.add_argument("--seed", type=int, default=1234)
    p.add_argument("--timeout", type=int, default=1800)
    p.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    home = args.home.expanduser().resolve()
    if args.command == "setup":
        setup(home, args)
    elif args.command == "download":
        if live_worker(home):
            raise RuntimeError("Stop the worker before downloading/updating models.")
        download(home, args.source, args.sample)
    elif args.command == "status":
        emit(status(home))
    elif args.command == "doctor":
        emit(status(home))
        if runtime_python(home).is_file():
            run([runtime_python(home), "-c", "import torch; print({'torch': torch.__version__, 'cuda': torch.cuda.is_available(), 'gpu': torch.cuda.get_device_name(0) if torch.cuda.is_available() else None})"], home)
    elif args.command == "start":
        emit(start(home, args.emotion_text))
    elif args.command == "stop":
        state = read_json(home / "worker.json", {})
        emit(api(state, "/stop", {}) if live_worker(home) else {"stage": "stopped"})
    elif args.command == "voices":
        voice_command(home, args)
    elif args.command == "speak":
        speak(home, args)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.SubprocessError) as error:
        emit({"error": str(error)})
        sys.exit(1)
