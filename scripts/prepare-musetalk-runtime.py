"""在独立目录准备已授权的固定MuseTalk源码、模型与推理依赖。"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
HOME = Path("D:/AI-Runtimes/super-ip/musetalk-1.5")
RESEARCH = ROOT / "evidence/research/generation-chain-20261115/lipsync-plan"
sys.path.insert(0, str(ROOT / "integrations/indextts-local/scripts"))
from download_plan import digest, download_range
from common import write_json


def command(args, **kwargs):
    print(json.dumps({"command": [str(item) for item in args]}, ensure_ascii=True), flush=True)
    subprocess.run([str(item) for item in args], check=True, **kwargs)


def prepare_models():
    plan_file = RESEARCH / "plan.json"
    plan = json.loads(plan_file.read_text(encoding="utf-8-sig"))
    if len(plan["files"]) != 11 or sum(item["bytes"] for item in plan["files"]) != 4482904130:
        raise ValueError("模型清单与已批准的11项4482904130字节不一致")
    report = {"approvalReceived": True, "approvalDate": "2026-11-15", "planSha256": digest(plan_file),
              "expectedBytes": plan["totalBytes"], "complete": False, "files": []}
    progress_file = HOME / "model-download-progress.json"
    curl = shutil.which("curl.exe" if os.name == "nt" else "curl")
    if not curl:
        raise RuntimeError("未找到curl")
    try:
        for item in plan["files"]:
            target = (HOME / item["target"]).resolve()
            if not target.is_relative_to(HOME.resolve()):
                raise ValueError("模型目标越界")
            target.parent.mkdir(parents=True, exist_ok=True)
            row = {**item, "state": "checking"}
            report["files"].append(row)
            write_json(progress_file, report)
            if target.exists():
                if target.stat().st_size != item["bytes"] or (item["expectedSha256"] and digest(target) != item["expectedSha256"]):
                    raise RuntimeError("已有模型不符，保留文件：" + str(target))
                row.update(state="complete", sha256=digest(target), reused=True)
                write_json(progress_file, report)
                continue
            partial = target.with_name(target.name + ".partial")
            row.update(state="downloading", partial=str(partial))
            def note(offset):
                row["downloadedBytes"] = offset
                report["updatedAt"] = datetime.now(timezone.utc).isoformat()
                write_json(progress_file, report)
                print(json.dumps({"file": item["target"], "bytes": offset, "total": item["bytes"]}), flush=True)
            # S3FD没有已知完整预期SHA，按已批准来源完整下载并明确记录自算SHA。
            chunk = item["bytes"] if not item.get("repo") else 8 * 1024 * 1024
            actual_url = item["downloadUrl"]
            if not item.get("repo"):
                actual_url = actual_url.replace("https://www.adrianbulat.com/", "https://adrianbulat.com/")
            row["actualDownloadUrl"] = actual_url
            if not item.get("repo"):
                spec = importlib.util.spec_from_file_location("range_download", ROOT / "scripts/download-verified-wheel.py")
                range_download = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(range_download)
                # 原站已实测IPv4小范围可用；避免整包89MB请求停顿丢失断点。
                actual_url = item["downloadUrl"]
                row["actualDownloadUrl"] = actual_url
                range_download.download(actual_url, target, item["bytes"], None, chunk_bytes=4 * 1024 * 1024)
                row.update(state="complete", sha256=digest(target), reused=False, checksumCompared=False,
                           officialMetadataIndependentlyVerified=False, downloadedBytes=item["bytes"])
                write_json(progress_file, report)
                continue
            download_range(curl, actual_url, partial, item["bytes"], note, chunk_bytes=chunk)
            actual = digest(partial)
            if item["expectedSha256"] and actual != item["expectedSha256"]:
                raise RuntimeError("模型SHA与固定清单不一致：" + item["target"])
            os.link(partial, target)
            partial.unlink()
            row.update(state="complete", sha256=actual, reused=False,
                       checksumCompared=bool(item["expectedSha256"]), officialMetadataIndependentlyVerified=False)
            write_json(progress_file, report)
        report.update(complete=True, completedAt=datetime.now(timezone.utc).isoformat())
        write_json(HOME / "model-receipt.json", report)
    except BaseException as error:
        report["error"] = str(error)
        raise
    finally:
        write_json(progress_file, report)


def prepare_source():
    manifest = json.loads((ROOT / "integrations/musetalk-local/model-manifest.json").read_text(encoding="utf-8"))
    commit = manifest["sourceCommit"]
    archive = HOME / ("source-" + commit + ".zip")
    if not archive.exists():
        command(["curl.exe", "--fail", "--location", "--retry", "2", "--connect-timeout", "20",
                 "--max-time", "180", "--output", str(archive) + ".partial",
                 "https://codeload.github.com/TMElyralab/MuseTalk/zip/" + commit])
        os.link(str(archive) + ".partial", archive)
        Path(str(archive) + ".partial").unlink()
    rows = []
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            relative = Path(*Path(entry.filename).parts[1:])
            if not relative.parts or entry.is_dir():
                continue
            target = (HOME / relative).resolve()
            if not target.is_relative_to(HOME.resolve()) or entry.file_size > 32 * 1024 * 1024:
                raise ValueError("源码包包含越界或过大文件")
            contents = bundle.read(entry)
            if target.exists():
                if target.read_bytes() != contents:
                    raise RuntimeError("已有源码不同，保留文件：" + str(target))
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("xb") as output:
                    output.write(contents)
        for item in manifest["sourceFiles"]:
            contents = (HOME / item["path"]).read_bytes()
            actual = hashlib.sha1(b"blob " + str(len(contents)).encode() + b"\0" + contents).hexdigest()
            if actual != item["gitBlobSha1"]:
                raise RuntimeError("固定源码散列不符：" + item["path"])
            rows.append({"path": item["path"], "gitBlobSha1": actual})
    write_json(HOME / "source-receipt.json", {"sourceCommit": commit, "sourceTreeSha": manifest["sourceTreeSha"],
               "archiveSha256": digest(archive), "sourceFiles": rows, "downloadedAt": datetime.now(timezone.utc).isoformat()})
    print(json.dumps({"sourceCommit": commit, "verifiedPythonFiles": len(rows)}), flush=True)


def prepare_dependencies():
    uv = Path("C:/Users/DELL/.local/bin/uv.exe")
    python = HOME / ".venv/Scripts/python.exe"
    env = os.environ.copy()
    env.update(UV_CACHE_DIR=str(HOME / "cache/uv"), UV_LINK_MODE="copy", UV_HTTP_TIMEOUT="1200",
               UV_INDEX_STRATEGY="unsafe-best-match", PYTHONNOUSERSITE="1",
               UV_CONFIG_FILE=str(ROOT / "integrations/musetalk-local/uv.toml"))
    if not python.exists():
        command([uv, "venv", "--python", "F:/Software/Python310/python.exe", HOME / ".venv"], env=env)
    wheel_root = HOME / "verified-wheels"
    torch_wheel = wheel_root / "torch-2.0.1+cu118-cp310-cp310-win_amd64.whl"
    if not torch_wheel.is_file() or digest(torch_wheel) != "f58d75619bc96e4322343c030b893613701caa2d6db8017155da226c14171335":
        raise RuntimeError("请先完成固定官方Torch安装包的完整校验，保留原缓存与环境")
    official_wheels = [torch_wheel]
    for name in ["torchvision-0.15.2+cu118-cp310-cp310-win_amd64.whl", "torchaudio-2.0.2+cu118-cp310-cp310-win_amd64.whl"]:
        wheel = wheel_root / name
        receipt = json.loads(wheel.with_suffix(wheel.suffix + ".json").read_text(encoding="utf-8-sig"))
        if not receipt.get("verified") or digest(wheel) != receipt["sha256"]:
            raise RuntimeError("官方安装包校验不符：" + name)
        official_wheels.append(wheel)
    command([uv, "pip", "install", "--python", python, "--no-deps", *official_wheels], env=env)
    # 使用本轮实际解析出的完整版本锁，避免安装阶段再次选择不同的间接依赖。
    dependency_lock = HOME / "inference-dependencies.lock"
    if not dependency_lock.is_file():
        raise RuntimeError("请先完成推理依赖预解析，不能隐式改变依赖集合")
    command([uv, "pip", "install", "--python", python, "--requirements", dependency_lock,
             "--find-links", wheel_root], env=env)
    with (HOME / "installed-dependencies.txt").open("w", encoding="utf-8") as output:
        subprocess.run([str(uv), "pip", "freeze", "--python", str(python)], stdout=output, check=True, env=env)
    write_json(HOME / "dependency-receipt.json", {"installed": True, "python": str(python),
               "lockSha256": digest(dependency_lock), "freezeSha256": digest(HOME / "installed-dependencies.txt"),
               "inferenceVerified": False})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=["models", "source", "dependencies"])
    args = parser.parse_args()
    HOME.mkdir(parents=True, exist_ok=True)
    lock = HOME / ("prepare-" + args.stage + ".lock")
    with lock.open("x", encoding="utf-8") as handle:
        json.dump({"pid": os.getpid()}, handle)
    try:
        {"models": prepare_models, "source": prepare_source, "dependencies": prepare_dependencies}[args.stage]()
    finally:
        lock.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
