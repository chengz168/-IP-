"""记录独立环境实际版本、固定锁与下载来源，不把安装通过当作推理通过。"""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import sys
from datetime import datetime, timezone

HOME = Path(r"D:\AI-Runtimes\super-ip\qwen3-tts-voice-design")
ROOT = Path(__file__).resolve().parents[1]


def digest(file):
    value = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def main():
    packages = sorted(({"name": package.metadata["Name"], "version": package.version}
                       for package in importlib.metadata.distributions()), key=lambda package: package["name"].lower())
    source = HOME / "verified-dependencies/sox-1.5.0.tar.gz"
    wheel = HOME / "verified-dependencies/sox-1.5.0-py3-none-any.whl"
    plan = json.loads((HOME / "verified-dependencies/receipt.json").read_text(encoding="utf-8"))
    assert plan["allVerified"]
    for item in plan["files"]:
        file = HOME / "verified-dependencies" / item["filename"]
        assert file.stat().st_size == item["bytes"] and digest(file) == item["sha256"], item["filename"]
    report = {"at": datetime.now(timezone.utc).isoformat(), "python": sys.executable, "version": sys.version,
              "packages": packages, "dependencyLockSha256": digest(HOME / "requirements-resolved.txt"),
              "downloadReceiptSha256": digest(HOME / "verified-dependencies/receipt.json"),
              "sourceBuiltWheel": {"source": str(source), "sourceSha256": digest(source), "wheel": str(wheel),
                                   "sha256": digest(wheel), "builtLocally": True},
              "models": json.loads((HOME / "model-download-receipt.json").read_text(encoding="utf-8")),
              "inferenceVerified": False, "qualityAccepted": False}
    target = HOME / "dependency-receipt.json"
    if target.exists():
        raise RuntimeError("已有环境收据，拒绝覆盖")
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"packages": len(packages), "file": str(target), "inferenceVerified": False}))


if __name__ == "__main__":
    main()
