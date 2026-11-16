"""使用已验证的同版本Torch安装包，继续原环境的离线依赖同步。"""
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "integrations/indextts-local/scripts"))
from common import UPSTREAM_REVISION, environment, runtime_python, write_json
from download_plan import digest

HOME = Path("D:/AI-Runtimes/super-ip/indextts-2.5")
UV = Path("C:/Users/DELL/.local/bin/uv.exe")
receipt_file = HOME / "verified-wheels/torch-wheel.json"
receipt = json.loads(receipt_file.read_text(encoding="utf-8"))
if not receipt.get("completed") or receipt.get("expectedSha256") != receipt.get("actualSha256"):
    raise RuntimeError("备用安装包尚未完整校验，不能更改原环境")
wheel = Path(receipt["path"])
if wheel.stat().st_size != receipt["bytes"] or digest(wheel) != receipt["expectedSha256"]:
    raise RuntimeError("备用安装包发生变化，未更改环境")
if digest(HOME / "upstream/uv.lock") != receipt["lockSha256"]:
    raise RuntimeError("依赖锁文件已经变化，未更改环境")
for pid in (34176, 35724):
    # Windows用只读进程查询，避免os.kill对不存在PID的不同平台行为。
    alive = subprocess.run(["powershell.exe", "-NoProfile", "-Command",
                            f"if (Get-Process -Id {pid} -ErrorAction SilentlyContinue) {{exit 1}} else {{exit 0}}"],
                           capture_output=True).returncode != 0
    if alive:
        raise RuntimeError("原安装进程尚未退出，禁止并发改动环境：" + str(pid))
env = environment(HOME)
env["PATH"] = str(UV.parent) + os.pathsep + env["PATH"]
commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=HOME / "upstream", text=True, env=env).strip()
if commit != UPSTREAM_REVISION:
    raise RuntimeError("原源码提交不一致，未更改环境")
commands = [
    [str(UV), "pip", "install", "--python", str(runtime_python(HOME)), "--no-deps", "--no-index", "--find-links", str(wheel.parent), "torch==2.8.0+cu128"],
    [str(UV), "sync", "--project", str(HOME / "upstream"), "--python", "3.11", "--no-dev", "--offline", "--frozen"],
]
report = {"upstreamCommit": commit, "wheelSha256": receipt["expectedSha256"], "steps": [], "complete": False}
report_file = ROOT / "evidence/research/generation-chain-20261115/indextts-setup-recovery.json"
for command in commands:
    print(json.dumps({"command": command}), flush=True)
    result = subprocess.run(command, cwd=HOME / "upstream", env=env)
    report["steps"].append({"command": command, "exitCode": result.returncode})
    write_json(report_file, report)
    if result.returncode:
        raise RuntimeError("依赖同步未完成，未写入安装完成记录")
write_json(HOME / "setup.json", {"upstream_revision": UPSTREAM_REVISION, "webui": False,
           "recovery": {"wheelSha256": receipt["expectedSha256"], "offlineSyncVerified": True}})
report["complete"] = True
write_json(report_file, report)
print(json.dumps(report), flush=True)
