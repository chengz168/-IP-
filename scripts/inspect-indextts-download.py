"""只读取官方模型元数据，生成最小权重清单，不下载权重。"""
import concurrent.futures
import json
from pathlib import Path
import urllib.request
from datetime import datetime, timezone


ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "evidence/research/generation-chain-20261115/indextts-model-plan"
MANIFEST = json.loads((ROOT / "integrations/indextts-local/model-manifest.json").read_text(encoding="utf-8"))
SPECS = {
    "IndexTeam/IndexTTS-2.5": [(name, name) for name in MANIFEST["required"] if not name.startswith("hf_cache/")],
    "facebook/w2v-bert-2.0": [(name, "hf_cache/w2v-bert-2.0/" + name) for name in ("config.json", "preprocessor_config.json", "model.safetensors")],
    "amphion/MaskGCT": [("semantic_codec/model.safetensors", "hf_cache/semantic_codec_model.safetensors")],
    "funasr/campplus": [("campplus_cn_common.bin", "hf_cache/campplus_cn_common.bin")],
    "nvidia/bigvgan_v2_22khz_80band_256x": [(name, "hf_cache/bigvgan/" + name) for name in ("config.json", "bigvgan_generator.pt")],
}


def inspect(spec):
    repo, selected = spec
    errors = []
    for endpoint in ("https://huggingface.co", "https://hf-mirror.com"):
        try:
            url = endpoint + "/api/models/" + repo + "?blobs=true"
            request = urllib.request.Request(url, headers={"User-Agent": "SuperIP-readonly-model-inspection"})
            with urllib.request.urlopen(request, timeout=20) as response:
                data = json.load(response)
            key = repo.replace("/", "__")
            (OUT / (key + ".json")).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            files = {item["rfilename"]: item for item in data["siblings"]}
            records = []
            for name, target in selected:
                if name == "model.safetensors" and name not in files:
                    name = "pytorch_model.bin"
                    target = "hf_cache/w2v-bert-2.0/" + name
                info = files[name]
                size = info.get("size", info.get("lfs", {}).get("size"))
                if not isinstance(size, int) or size <= 0:
                    raise ValueError("文件大小未知：" + name)
                records.append({"file": name, "target": target, "bytes": size, "sha256": info.get("lfs", {}).get("sha256")})
            return {"repo": repo, "revision": data["sha"], "metadataSource": url, "files": records, "bytes": sum(item["bytes"] for item in records)}
        except Exception as error:
            errors.append({"endpoint": endpoint, "error": str(error)})
    return {"repo": repo, "errors": errors}


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        records = list(pool.map(inspect, SPECS.items()))
    report = {"checkedAt": datetime.now(timezone.utc).isoformat(), "weightDownloadPerformed": False,
              "repositories": records, "metadataComplete": all("bytes" in item for item in records),
              "knownTotalBytes": sum(item.get("bytes", 0) for item in records)}
    (OUT / "plan.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
