"""并行获取固定文件；检查范围、长度及已知SHA，未知SHA明确记录。"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def digest(file):
    value = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def download(url, output, size, expected, *, chunk_bytes=16 * 1024 * 1024, workers=4, curl_args=()):
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        if output.stat().st_size != size or (expected and digest(output) != expected):
            raise RuntimeError("已有安装包校验不符，保留原文件")
        return
    lock = output.with_suffix(output.suffix + ".lock")
    with lock.open("x") as stream:
        stream.write(str(os.getpid()))
    try:
        partial = output.with_suffix(output.suffix + ".partial")
        offset = partial.stat().st_size if partial.exists() else 0
        if offset > size:
            raise RuntimeError("断点越过安装包大小")
        def fetch(start):
            end = min(start + chunk_bytes, size) - 1
            block = output.with_name(output.name + f".{start}-{end}.block")
            receipt = block.with_suffix(".json")
            if block.exists() and receipt.exists():
                record = json.loads(receipt.read_text())
                if (block.stat().st_size == end - start + 1 and record.get("sha256") == digest(block)
                        and record.get("url") == url and record.get("total") == size):
                    return block
            headers = block.with_suffix(".headers")
            temporary = block.with_suffix(".downloading")
            request_url = url + ("&" if "?" in url else "?") + f"segment={start}-{end}"
            subprocess.run(["curl.exe", "--ipv4", "--fail", "--location", "--silent", "--show-error", "--retry", "2",
                            "--connect-timeout", "20", "--max-time", "180", "--range", f"{start}-{end}",
                            "--dump-header", str(headers), "--output", str(temporary), *curl_args, request_url], check=True)
            ranges = re.findall(r"^content-range:\s*bytes\s+(\d+)-(\d+)/(\d+)", headers.read_text(encoding="iso-8859-1"), re.I | re.M)
            if not ranges or tuple(map(int, ranges[-1])) != (start, end, size) or temporary.stat().st_size != end - start + 1:
                raise RuntimeError("安装包服务器范围或分块长度不符")
            actual = digest(temporary)
            os.replace(temporary, block)
            receipt.write_text(json.dumps({"url": url, "total": size, "sha256": actual}), encoding="utf-8")
            headers.unlink()
            return block
        with ThreadPoolExecutor(max_workers=workers) as pool:
            # 有界窗口防止大量已完成块积压；主文件仅按连续顺序追加并落盘。
            with partial.open("ab") as stream:
                for window in range(offset, size, chunk_bytes * workers):
                    starts = range(window, min(window + chunk_bytes * workers, size), chunk_bytes)
                    for block in pool.map(fetch, starts):
                        with block.open("rb") as incoming:
                            for contents in iter(lambda: incoming.read(1024 * 1024), b""):
                                stream.write(contents)
                        stream.flush()
                        os.fsync(stream.fileno())
                        print(json.dumps({"file": output.name, "downloadedBytes": stream.tell(), "total": size}), flush=True)
                        block.unlink()
                        block.with_suffix(".json").unlink()
        actual = digest(partial)
        if partial.stat().st_size != size or (expected and actual != expected):
            raise RuntimeError("安装包完整大小或官方SHA校验不符")
        os.link(partial, output)
        partial.unlink()
        output.with_suffix(output.suffix + ".json").write_text(json.dumps({"url": url, "bytes": size,
                      "expectedSha256": expected, "sha256": actual, "verified": bool(expected)}), encoding="utf-8")
    finally:
        lock.unlink(missing_ok=True)


if __name__ == "__main__":
    spec = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
    download(spec["url"], Path(spec["output"]), spec["bytes"], spec["sha256"])
