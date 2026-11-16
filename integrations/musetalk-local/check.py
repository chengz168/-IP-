"""只读检查专用口型候选，不安装依赖、下载权重或导入模型预处理模块。"""
import argparse
import hashlib
import importlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys


REQUIREMENTS = {
    "torch": "2.0.1", "torchvision": "0.15.2", "torchaudio": "2.0.2",
    "diffusers": "0.30.2", "accelerate": "0.28.0", "numpy": "1.23.5",
    "opencv-python": "4.9.0.80", "soundfile": "0.12.1",
    "transformers": "4.39.2", "huggingface_hub": "0.30.2",
    "librosa": "0.11.0", "einops": "0.8.1",
    "mmcv": "2.0.1", "mmdet": "3.1.0", "mmpose": "1.1.0",
    "mmengine": None, "omegaconf": None, "Pillow": None, "tqdm": None,
    "setuptools": "80.9.0",
}


def sha256(file):
    value = hashlib.sha256()
    with file.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def inside(root, relative):
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
        raise ValueError("清单路径必须为相对路径")
    target = (root / relative).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError("清单路径越过运行目录")
    return target


def inspect(home, manifest, *, full_hash=False, device=False):
    home = Path(home).resolve()
    models = []
    for item in manifest["files"]:
        target = inside(home, item["target"])
        exists = target.is_file()
        size = target.stat().st_size if exists else None
        actual_hash = sha256(target) if exists and size == item["bytes"] and full_hash else None
        expected = item.get("expectedSha256") or None
        models.append({"path": item["target"], "present": exists,
                       "bytes": size, "expectedBytes": item["bytes"],
                       "sizeMatches": size == item["bytes"],
                       "sha256": actual_hash, "expectedSha256": expected,
                       "hashMatches": actual_hash == expected if actual_hash and expected else None,
                       "checksumOrigin": "既有镜像计划" if expected else "暂无独立已知预期SHA"})
    source = []
    for item in manifest["sourceFiles"]:
        target = inside(home, item["path"])
        contents = target.read_bytes() if target.is_file() else None
        actual = hashlib.sha256(contents).hexdigest() if contents is not None else None
        git_blob = hashlib.sha1(b"blob " + str(len(contents)).encode("ascii") + b"\0" + contents).hexdigest() if contents is not None else None
        matches = git_blob == item["gitBlobSha1"] if item.get("gitBlobSha1") else actual == item.get("sha256")
        source.append({"path": item["path"], "present": actual is not None,
                       "sha256": actual, "gitBlobSha1": git_blob, "matchesPinnedSource": matches})
    receipt_file = home / "source-receipt.json"
    receipt = json.loads(receipt_file.read_text(encoding="utf-8-sig")) if receipt_file.is_file() else {}
    source_version = receipt.get("sourceCommit") == manifest["sourceCommit"]
    dependencies = []
    for name, expected in REQUIREMENTS.items():
        try:
            actual = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            actual = None
        # PyTorch CUDA版本使用本地版本后缀，不把+cu118误判为不同基础版本。
        matches = bool(actual) and (expected is None or actual.split("+")[0] == expected)
        dependencies.append({"name": name, "version": actual, "expectedVersion": expected,
                             "matches": matches, "importVerified": False})
    files_present = all(item["sizeMatches"] for item in models)
    hashes = full_hash and all(item["hashMatches"] is not False for item in models)
    model_receipt_file = home / "model-receipt.json"
    model_receipt = json.loads(model_receipt_file.read_text(encoding="utf-8-sig")) if model_receipt_file.is_file() else {}
    receipt_rows = model_receipt.get("files", [])
    receipt_hashes = {item["target"]: item.get("sha256") for item in receipt_rows}
    # 没有独立已知SHA的小配置，也必须与本次实际下载完成记录一致。
    receipt_matches = bool(full_hash and files_present and model_receipt.get("complete")
                           and manifest.get("modelPlanSha256")
                           and model_receipt.get("planSha256") == manifest["modelPlanSha256"]
                           and len(receipt_rows) == len(models)
                           and set(receipt_hashes) == {item["path"] for item in models}
                           and all(item["sha256"] == receipt_hashes[item["path"]] for item in models))
    sources_match = source_version and all(item["matchesPinnedSource"] for item in source)
    dependency_match = all(item["matches"] for item in dependencies)
    isolated_python = Path(sys.executable).resolve().is_relative_to(home)
    allowed_source_paths = {item["path"] for item in manifest["sourceFiles"]}
    unexpected_sources = []
    for relative in ["musetalk", "face_detection"]:
        source_root = home / relative
        if source_root.is_dir():
            unexpected_sources.extend(file.relative_to(home).as_posix() for file in source_root.rglob("*.py")
                                      if file.relative_to(home).as_posix() not in allowed_source_paths)
    imports = []
    device_result = {"checked": False, "cuda": None}
    if device and files_present and hashes and receipt_matches and sources_match and dependency_match and isolated_python and not unexpected_sources:
        os.environ["HF_HOME"] = str(home / "cache/huggingface")
        os.environ["HF_HUB_CACHE"] = str(home / "cache/huggingface/hub")
        os.environ["TRANSFORMERS_CACHE"] = str(home / "cache/transformers")
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        # 只导入通用依赖，不导入会立即初始化DWPose和S3FD的上游预处理模块。
        for name in ["torch", "torchvision", "torchaudio", "cv2", "diffusers", "transformers",
                     "mmengine", "mmcv.ops", "mmdet", "mmpose.apis", "librosa", "soundfile", "omegaconf", "einops"]:
            try:
                importlib.import_module(name)
                imports.append({"name": name, "ok": True})
            except Exception as error:
                imports.append({"name": name, "ok": False, "error": str(error)})
        if all(item["ok"] for item in imports):
            import torch
            device_result = {"checked": True, "cuda": torch.cuda.is_available(),
                             "torch": torch.__version__,
                             "name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None}
    return {"kind": "musetalk-readiness", "home": str(home), "runtimeExists": home.is_dir(),
            "python": sys.executable, "pythonVersion": sys.version.split()[0],
            "pythonSupported": sys.version_info[:2] == (3, 10),
            "isolatedPython": isolated_python,
            "sourceCommit": manifest["sourceCommit"], "sourceReceiptMatches": source_version,
            "models": models, "sources": source, "dependencies": dependencies,
            "allFilesPresent": files_present, "knownHashesChecked": bool(hashes and files_present),
            "modelDownloadReceiptMatches": receipt_matches,
            "allModelHashesIndependentlyVerified": False,
            "unexpectedSourceFiles": unexpected_sources, "dependencyImports": imports,
            "device": device_result,
            "readyForCandidateTrial": bool(files_present and hashes and receipt_matches and sources_match and dependency_match
                                           and isolated_python and not unexpected_sources
                                           and sys.version_info[:2] == (3, 10) and device_result["cuda"]),
            "inferenceVerified": False, "qualityAccepted": False,
            "networkAccessRequested": False, "weightsDownloaded": False,
            "dependenciesInstalled": False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--full-hash", action="store_true")
    parser.add_argument("--device", action="store_true")
    parser.add_argument("--result", type=Path)
    args = parser.parse_args()
    manifest = json.loads((Path(__file__).parent / "model-manifest.json").read_text(encoding="utf-8"))
    result = inspect(args.home, manifest, full_hash=args.full_hash, device=args.device)
    if args.result:
        # 只写调用方明确指定的回执，不在模型运行目录创建任何文件。
        with args.result.open("x", encoding="utf-8") as stream:
            json.dump(result, stream, ensure_ascii=False, indent=2)
    print(json.dumps({"runtimeExists": result["runtimeExists"],
                      "missingModels": sum(not item["present"] for item in result["models"]),
                      "readyForCandidateTrial": result["readyForCandidateTrial"],
                      "inferenceVerified": False}, ensure_ascii=True))


if __name__ == "__main__":
    main()
