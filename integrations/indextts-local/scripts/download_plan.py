"""按已审阅的固定版本清单下载，支持断点并核对完整文件。"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
from urllib.parse import quote

from common import ENDPOINTS, MODEL_MANIFEST, models, write_json


def digest(file):
    value = hashlib.sha256()
    with file.open("rb") as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def download_range(curl, url, temporary, size, on_progress, chunk_bytes=8 * 1024 * 1024):
    offset = temporary.stat().st_size if temporary.exists() else 0
    if offset > size:
        raise RuntimeError("已有断点超过目标文件大小，保留断点：" + str(temporary))
    while offset < size:
        end = min(offset + chunk_bytes, size) - 1
        chunk = temporary.with_name(temporary.name + ".chunk")
        headers = temporary.with_name(temporary.name + ".headers")
        subprocess.run([curl, "--fail", "--location", "--silent", "--show-error", "--retry", "3", "--retry-delay", "3",
                        "--connect-timeout", "20", "--max-time", "180", "--speed-limit", "1024", "--speed-time", "45",
                        "--range", f"{offset}-{end}", "--dump-header", str(headers), "--output", str(chunk), url], check=True)
        response_headers = headers.read_text(encoding="iso-8859-1")
        ranges = re.findall(r"^content-range:\s*bytes\s+(\d+)-(\d+)/(\d+)", response_headers, re.I | re.M)
        if ranges:
            if tuple(map(int, ranges[-1])) != (offset, end, size):
                raise RuntimeError("服务器返回的下载范围与请求不符")
        elif offset != 0 or end != size - 1:
            raise RuntimeError("服务器未确认分段下载范围")
        if chunk.stat().st_size != end - offset + 1:
            raise RuntimeError("分块长度与请求不一致，未追加到断点文件")
        with temporary.open("ab") as output, chunk.open("rb") as incoming:
            shutil.copyfileobj(incoming, output)
            output.flush()
            os.fsync(output.fileno())
        chunk.unlink()
        headers.unlink()
        offset = end + 1
        on_progress(offset)


def read_plan(file):
    data = json.loads(file.read_text(encoding="utf-8-sig"))
    if not data.get("metadataComplete") or data.get("weightDownloadPerformed") is not False:
        raise ValueError("需要完整且尚未执行的模型清单")
    required = set(MODEL_MANIFEST["required"])
    targets = []
    for repo in data["repositories"]:
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo["repo"]) or not re.fullmatch(r"[a-f0-9]{40}", repo["revision"]):
            raise ValueError("模型仓库或固定版本无效")
        for item in repo["files"]:
            for key in ("file", "target"):
                value = item[key]
                if not isinstance(value, str) or not value or "\\" in value or ":" in value or PurePosixPath(value).is_absolute() or ".." in PurePosixPath(value).parts:
                    raise ValueError("模型文件路径无效")
            if type(item["bytes"]) is not int or item["bytes"] <= 0:
                raise ValueError("模型文件大小无效")
            if item.get("sha256") is not None and not re.fullmatch(r"[a-f0-9]{64}", item["sha256"]):
                raise ValueError("模型校验值无效")
            if item["bytes"] > 1024 * 1024 and not item.get("sha256"):
                raise ValueError("大模型文件缺少SHA256校验值")
            targets.append(item["target"])
    if len(set(targets)) != len(targets) or not required.issubset(targets):
        raise ValueError("模型清单重复或缺少必需文件")
    for alternative in MODEL_MANIFEST["alternatives"]:
        if not any(name in targets for name in alternative["files"]):
            raise ValueError("模型清单缺少可选权重：" + alternative["label"])
    total = sum(item["bytes"] for repo in data["repositories"] for item in repo["files"])
    if total != data.get("knownTotalBytes"):
        raise ValueError("模型清单总大小不一致")
    return data


def download_plan(home, file, source, chunk_bytes=8 * 1024 * 1024):
    data = read_plan(file)
    root = models(home)
    root.mkdir(parents=True, exist_ok=True)
    curl = shutil.which("curl.exe" if os.name == "nt" else "curl")
    if not curl:
        raise RuntimeError("未找到支持断点下载的 curl")
    lock = home / "model-download.lock"
    with lock.open("x", encoding="utf-8") as handle:
        json.dump({"pid": os.getpid(), "planSha256": digest(file)}, handle)
    records = []
    progress = {"planSha256": digest(file), "source": source, "expectedBytes": data["knownTotalBytes"],
                "complete": False, "files": records}
    progress_file = home / "download-progress.json"
    try:
        for repo in data["repositories"]:
            for item in repo["files"]:
                target = root / item["target"]
                if not target.resolve().is_relative_to(root.resolve()):
                    raise ValueError("模型目标超出检查点目录")
                target.parent.mkdir(parents=True, exist_ok=True)
                record = {"repo": repo["repo"], "revision": repo["revision"], **item, "state": "checking"}
                records.append(record)
                write_json(progress_file, progress)
                if target.exists():
                    if not target.is_file() or target.stat().st_size != item["bytes"] or (item.get("sha256") and digest(target) != item["sha256"]):
                        raise RuntimeError("已有文件与清单不符，保留原文件：" + str(target))
                    record.update(state="complete", reused=True, outputSha256=digest(target))
                    write_json(progress_file, progress)
                    continue
                temporary = target.with_name(target.name + "." + repo["revision"][:12] + ".partial")
                url = ENDPOINTS[source] + "/" + repo["repo"] + "/resolve/" + repo["revision"] + "/" + quote(item["file"], safe="/") + "?download=true"
                record.update(state="downloading", partial=str(temporary))
                write_json(progress_file, progress)
                print(json.dumps({"downloading": item["target"], "bytes": item["bytes"], "resumeBytes": temporary.stat().st_size if temporary.exists() else 0}, ensure_ascii=False), flush=True)
                def note_progress(offset):
                    record["downloadedBytes"] = offset
                    progress["updatedAt"] = datetime.now(timezone.utc).isoformat()
                    write_json(progress_file, progress)
                    print(json.dumps({"progress": item["target"], "downloadedBytes": offset, "totalBytes": item["bytes"]}, ensure_ascii=False), flush=True)
                download_range(curl, url, temporary, item["bytes"], note_progress, chunk_bytes)
                if temporary.stat().st_size != item["bytes"]:
                    raise RuntimeError("下载文件大小与清单不一致：" + item["target"])
                actual = digest(temporary)
                if item.get("sha256") and actual != item["sha256"]:
                    raise RuntimeError("下载文件SHA256与清单不一致：" + item["target"])
                # 不覆盖下载期间由其他程序创建的目标文件。
                os.link(temporary, target)
                temporary.unlink()
                record.update(state="complete", reused=False, outputSha256=actual)
                write_json(progress_file, progress)
                print(json.dumps({"completed": item["target"], "sha256": actual}, ensure_ascii=False), flush=True)
        progress.update(complete=True, completedAt=datetime.now(timezone.utc).isoformat())
        write_json(home / MODEL_MANIFEST["receipt"], {"source": source, "endpoint": ENDPOINTS[source],
                   "completed_at": progress["completedAt"], "planSha256": progress["planSha256"],
                   "models": [{"repo": repo["repo"], "revision": repo["revision"]} for repo in data["repositories"]], "files": records})
        write_json(progress_file, progress)
    except Exception as error:
        progress["error"] = str(error)
        write_json(progress_file, progress)
        raise
    finally:
        lock.unlink(missing_ok=True)
