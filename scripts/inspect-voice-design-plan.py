"""读取官方元数据和小型说明文件，准备自主音色候选清单；不下载权重。"""
import concurrent.futures
import hashlib
import json
import base64
import io
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path
import urllib.request
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "evidence/research/generation-chain-20261115/voice-design-plan"
HEADERS = {"User-Agent": "SuperIP-VoiceDesign-readonly-research"}
REPOS = ("Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", "Qwen/Qwen3-TTS-Tokenizer-12Hz")


def read_url(url, limit=8 * 1024 * 1024):
    if urlparse(url).netloc in ("api.github.com", "raw.githubusercontent.com", "pypi.org", "files.pythonhosted.org"):
        # 当前 Python 到 GitHub 连接被重置，使用同机已核实可用的 Node HTTPS 客户端。
        script = "const r=await fetch(process.argv[1],{headers:{'User-Agent':'SuperIP-readonly-research'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('HTTP '+r.status);const b=Buffer.from(await r.arrayBuffer());if(b.length>Number(process.argv[2]))throw Error('研究文件过大');process.stdout.write(b);"
        result = subprocess.run(["node", "--input-type=module", "-e", script, url, str(limit)],
                                capture_output=True, timeout=30, check=True)
        return result.stdout
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=25) as response:
        body = response.read(limit + 1)
    if len(body) > limit:
        raise ValueError("只读研究文件超过体积限制")
    return body


def inspect_repo(repo):
    errors = []
    for endpoint in ("https://huggingface.co", "https://hf-mirror.com"):
        try:
            url = endpoint + "/api/models/" + repo + "?blobs=true"
            body = read_url(url)
            data = json.loads(body)
            key = repo.replace("/", "__")
            (OUT / (key + ".metadata.json")).write_bytes(body)
            records = []
            for item in data["siblings"]:
                name = item["rfilename"]
                # 只选择推理所需配置与权重，排除文档、演示和 Git 控制文件。
                if not name.endswith((".json", ".txt", ".safetensors", ".model")):
                    continue
                size = item.get("size", item.get("lfs", {}).get("size"))
                if not isinstance(size, int) or size <= 0:
                    raise ValueError("文件大小未知：" + name)
                records.append({"file": name, "bytes": size,
                                "sha256": item.get("lfs", {}).get("sha256"),
                                "gitBlobId": item.get("blobId")})
            return {"repo": repo, "revision": data["sha"], "metadataSource": url,
                    "license": data.get("cardData", {}).get("license"), "files": records,
                    "bytes": sum(item["bytes"] for item in records), "errorsBeforeSuccess": errors}
        except Exception as error:
            errors.append({"endpoint": endpoint, "error": str(error)})
    return {"repo": repo, "errors": errors}


def inspect_source():
    url = "https://api.github.com/repos/QwenLM/Qwen3-TTS/commits/main"
    body = read_url(url)
    commit = json.loads(body)["sha"]
    (OUT / "upstream-commit.json").write_bytes(body)
    records = []
    for name in ("README.md", "LICENSE", "pyproject.toml", "qwen_tts/inference/qwen3_tts_model.py",
                 "qwen_tts/core/models/modeling_qwen3_tts.py"):
        target_url = "https://api.github.com/repos/QwenLM/Qwen3-TTS/contents/" + name + "?ref=" + commit
        info = json.loads(read_url(target_url))
        if info.get("encoding") != "base64":
            raise ValueError("官方源码未返回预期内容：" + name)
        content = base64.b64decode(info["content"])
        git_blob = hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()
        if git_blob != info["sha"]:
            raise ValueError("官方源码 blob 校验失败：" + name)
        target = OUT / "upstream" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        records.append({"file": name, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest(), "gitBlobId": git_blob, "url": target_url})
    return {"repo": "QwenLM/Qwen3-TTS", "commit": commit, "files": records}


def inspect_package():
    url = "https://pypi.org/pypi/qwen-tts/0.1.1/json"
    metadata = json.loads(read_url(url))
    wheel = next(item for item in metadata["urls"] if item["filename"] == "qwen_tts-0.1.1-py3-none-any.whl")
    body = read_url(wheel["url"])
    actual = hashlib.sha256(body).hexdigest()
    if len(body) != wheel["size"] or actual != wheel["digests"]["sha256"]:
        raise ValueError("官方小型源码发行包校验失败")
    (OUT / wheel["filename"]).write_bytes(body)
    records = []
    with zipfile.ZipFile(io.BytesIO(body)) as archive:
        for name in archive.namelist():
            if name.startswith("qwen_tts/") and name.endswith((".py", ".npz")):
                content = archive.read(name)
                records.append({"file": name, "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)})
                if name.endswith("inference/qwen3_tts_model.py"):
                    target = OUT / "release-source" / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(content)
    return {"name": "qwen-tts", "version": "0.1.1", "filename": wheel["filename"],
            "bytes": len(body), "sha256": actual, "url": wheel["url"], "sourceFiles": records,
            "installed": False}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        model_futures = [pool.submit(inspect_repo, repo) for repo in REPOS]
        source_future = pool.submit(inspect_source)
        package_future = pool.submit(inspect_package)
        models = [future.result() for future in model_futures]
        try:
            source = source_future.result()
        except Exception as error:
            source = {"error": str(error)}
        try:
            package = package_future.result()
        except Exception as error:
            package = {"error": str(error)}
    # VoiceDesign 仓库自带同 SHA 的语音 tokenizer，独立 tokenizer 仓库仅供核对，不重复下载。
    selected = models[:1]
    embedded = {item["file"].removeprefix("speech_tokenizer/"): item for item in selected[0].get("files", []) if item["file"].startswith("speech_tokenizer/")}
    tokenizer_matches = bool(embedded) and all(embedded.get(item["file"], {}).get("gitBlobId") == item.get("gitBlobId") for item in models[1].get("files", []))
    report = {"checkedAt": datetime.now(timezone.utc).isoformat(), "models": selected, "upstream": source, "package": package,
              "relatedMetadataOnly": models[1:], "embeddedTokenizerMatchesStandalone": tokenizer_matches,
              "weightDownloadPerformed": False, "inferencePerformed": False, "qualityAccepted": False,
              "runtimeDirectory": "D:/AI-Runtimes/super-ip/qwen3-tts-voice-design",
              "metadataComplete": all("bytes" in model for model in models) and "commit" in source and tokenizer_matches and "sha256" in package,
              "knownTotalBytes": sum(model.get("bytes", 0) for model in selected),
              "scope": "VoiceDesign 独立音色短句；持续复用方案仍需核对，不含尚未批准的 Base 模型"}
    (OUT / "plan.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not report["metadataComplete"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
