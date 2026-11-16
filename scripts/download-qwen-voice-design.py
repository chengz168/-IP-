"""按用户已批准的固定清单下载自主音色模型，并逐项核对哈希。"""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = Path(r"D:\AI-Runtimes\super-ip\qwen3-tts-voice-design")
MANIFEST = ROOT / "integrations/qwen-voice-design/manifest.json"


def verify(file, item):
    if not file.is_file() or file.stat().st_size != item["bytes"]:
        raise RuntimeError("文件长度不符：" + item["file"])
    digest = hashlib.sha256()
    blob = hashlib.sha1(b"blob " + str(item["bytes"]).encode() + b"\0")
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
            blob.update(chunk)
    if item.get("sha256"):
        valid = digest.hexdigest() == item["sha256"]
    else:
        valid = blob.hexdigest() == item["gitBlobId"]
    if not valid:
        raise RuntimeError("文件哈希不符，保留现场：" + item["file"])
    return {"file": item["file"], "bytes": item["bytes"], "sha256": digest.hexdigest(), "verified": True}


def main():
    started = time.monotonic()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8-sig"))
    spec = importlib.util.spec_from_file_location("verified_download", ROOT / "scripts/download-verified-wheel.py")
    downloader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(downloader)
    records = []
    for item in manifest["files"]:
        relative = Path(item["file"])
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("清单路径不合法")
        file = RUNTIME / "models/voice-design" / relative
        file.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://hf-mirror.com/{manifest['repo']}/resolve/{manifest['revision']}/{item['file']}?download=true"
        if not file.exists():
            if item["bytes"] >= 16 * 1024 * 1024:
                downloader.download(url, file, item["bytes"], item["sha256"])
            else:
                temporary = file.with_suffix(file.suffix + ".downloading")
                subprocess.run(["curl.exe", "--ipv4", "--fail", "--location", "--silent", "--show-error",
                                "--retry", "2", "--connect-timeout", "20", "--max-time", "180",
                                "--output", str(temporary), url], check=True)
                verify(temporary, item)
                temporary.rename(file)
        record = verify(file, item)
        record["source"] = url
        records.append(record)
        print(json.dumps(record), flush=True)
    receipt = {"repo": manifest["repo"], "revision": manifest["revision"], "bytes": sum(x["bytes"] for x in records),
               "files": records, "elapsedSeconds": time.monotonic() - started, "verified": True}
    target = RUNTIME / "model-download-receipt.json"
    target.write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
