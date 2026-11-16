"""下载原锁文件指定的Torch安装包，校验后供原环境修复使用。"""
import json
import os
from pathlib import Path
import re
import shutil
import sys
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "integrations/indextts-local/scripts"))
from common import write_json
from download_plan import digest, download_range

HOME = Path("D:/AI-Runtimes/super-ip/indextts-2.5")
LOCK = HOME / "upstream/uv.lock"
source = LOCK.read_text(encoding="utf-8")
match = re.search(r'url = "(https://download-r2\.pytorch\.org/whl/cu128/torch-2\.8\.0%2Bcu128-cp311-cp311-win_amd64\.whl)", hash = "sha256:([a-f0-9]{64})"', source)
if not match:
    raise RuntimeError("原锁文件未提供所需Torch版本和校验值")
url, expected = match.groups()
locked_url = url
url = url.replace("https://download-r2.pytorch.org/", "https://download.pytorch.org/")
header_file = ROOT / "evidence/research/generation-chain-20261115/torch-wheel-probe.headers"
range_match = re.search(r"content-range:\s*bytes 0-0/(\d+)", header_file.read_text(encoding="iso-8859-1"), re.I)
if not range_match:
    raise RuntimeError("缺少原官方地址的文件大小响应证据")
size = int(range_match[1])
directory = HOME / "verified-wheels"
directory.mkdir(parents=True, exist_ok=True)
target = directory / unquote(url.rsplit("/", 1)[1])
temporary = target.with_suffix(target.suffix + ".partial")
report = {"url": url, "lockedUrl": locked_url, "bytes": size, "expectedSha256": expected, "lockSha256": digest(LOCK), "completed": False, "installationPerformed": False}
receipt = directory / "torch-wheel.json"


def note_progress(offset):
    report["downloadedBytes"] = offset
    write_json(receipt, report)
    print(json.dumps(report), flush=True)


if target.exists():
    if target.stat().st_size != size or digest(target) != expected:
        raise RuntimeError("已有安装包校验不符，保留原文件")
else:
    download_range(shutil.which("curl.exe"), url, temporary, size, note_progress, chunk_bytes=64 * 1024 * 1024)
    if digest(temporary) != expected:
        raise RuntimeError("Torch安装包SHA256与原锁文件不符")
    os.link(temporary, target)
    temporary.unlink()
report.update(completed=True, path=str(target), actualSha256=digest(target))
write_json(receipt, report)
print(json.dumps(report), flush=True)
