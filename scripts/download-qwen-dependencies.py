"""从实际解析锁读取版本，以官方PyPI元数据和SHA下载独立依赖；不修改其他环境。"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import time
from packaging.tags import sys_tags
from packaging.utils import parse_wheel_filename

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = Path(r"D:\AI-Runtimes\super-ip\qwen3-tts-voice-design")
DESTINATION = RUNTIME / "verified-dependencies"
TAGS = {tag: rank for rank, tag in enumerate(sys_tags())}


def curl(url, file):
    route = ["--resolve", "files.pythonhosted.org:443:151.101.0.223"] if url.startswith("https://files.pythonhosted.org/") else []
    subprocess.run(["curl.exe", "--ipv4", "--fail", "--location", "--silent", "--show-error", "--retry", "2",
                    "--connect-timeout", "20", "--max-time", "120", "--output", str(file), *route, url], check=True)


def metadata(item):
    name, version = item
    file = DESTINATION / (name + "-" + version + ".pypi.json")
    if not file.exists():
        temporary = file.with_suffix(".downloading")
        curl(f"https://pypi.org/pypi/{name}/{version}/json", temporary)
        temporary.rename(file)
    data = json.loads(file.read_text(encoding="utf-8"))
    choices = []
    for package in data["urls"]:
        if package["packagetype"] != "bdist_wheel":
            continue
        _, _, _, tags = parse_wheel_filename(package["filename"])
        ranks = [TAGS[tag] for tag in tags if tag in TAGS]
        if ranks:
            choices.append((min(ranks), package))
    if choices:
        package = min(choices, key=lambda entry: entry[0])[1]
    else:
        package = next((package for package in data["urls"] if package["packagetype"] == "sdist"), None)
        if not package:
            raise RuntimeError("没有本机可用的官方发行文件：" + name)
    return {"name": name, "version": version, "filename": package["filename"], "url": package["url"],
            "bytes": package["size"], "sha256": package["digests"]["sha256"], "type": package["packagetype"]}


def digest(file):
    value = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def main():
    started = time.monotonic()
    DESTINATION.mkdir(exist_ok=True)
    locked = (RUNTIME / "requirements-resolved.txt").read_text(encoding="utf-8-sig")
    packages = [match.groups() for line in locked.splitlines() if (match := re.fullmatch(r"([A-Za-z0-9_.-]+)==([^\s]+)", line))]
    with ThreadPoolExecutor(max_workers=6) as pool:
        plan = list(pool.map(metadata, packages))
    (DESTINATION / "plan.json").write_text(json.dumps({"files": plan, "bytes": sum(item["bytes"] for item in plan)}, indent=2), encoding="utf-8")
    module_spec = importlib.util.spec_from_file_location("verified_download", ROOT / "scripts/download-verified-wheel.py")
    downloader = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(downloader)

    def fetch(item):
        output = DESTINATION / item["filename"]
        mirror_url = item["url"].replace("https://files.pythonhosted.org/packages/", "https://mirrors.aliyun.com/pypi/packages/")
        download_url = item["url"]
        if output.exists():
            if output.stat().st_size != item["bytes"] or digest(output) != item["sha256"]:
                raise RuntimeError("已有依赖校验不符，保留现场：" + item["filename"])
            receipt = output.with_suffix(output.suffix + ".json")
            if receipt.exists():
                download_url = json.loads(receipt.read_text(encoding="utf-8"))["url"]
        elif item["bytes"] >= 4 * 1024 * 1024:
            download_url = mirror_url
            downloader.download(download_url, output, item["bytes"], item["sha256"], chunk_bytes=4 * 1024 * 1024, workers=2)
        else:
            download_url = mirror_url
            temporary = output.with_suffix(output.suffix + ".downloading")
            curl(download_url + "?superip=voice-design-20261115", temporary)
            if temporary.stat().st_size != item["bytes"] or digest(temporary) != item["sha256"]:
                raise RuntimeError("下载依赖长度或SHA不符：" + item["filename"])
            temporary.rename(output)
        print(json.dumps({"package": item["name"], "bytes": item["bytes"], "verified": True}), flush=True)
        return {**item, "downloadUrl": download_url, "shaSource": "官方PyPI版本元数据", "resumedPartialMayIncludeOfficialSource": True}

    with ThreadPoolExecutor(max_workers=4) as pool:
        verified = list(pool.map(fetch, plan))
    receipt = {"files": verified, "bytes": sum(item["bytes"] for item in verified), "allVerified": True,
               "elapsedSeconds": time.monotonic() - started}
    (DESTINATION / "receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
