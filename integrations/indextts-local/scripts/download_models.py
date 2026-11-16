"""Run inside the isolated IndexTTS environment, with HF_ENDPOINT set first."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import os
from pathlib import Path
import shutil
import sys

from common import ENDPOINTS, MODEL_ID, environment, models, write_json


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--source", choices=ENDPOINTS, required=True)
    parser.add_argument("--sample", action="store_true")
    parser.add_argument("--plan", type=Path)
    parser.add_argument("--chunk-mib", type=int, choices=(8, 16, 32, 64), default=8)
    args = parser.parse_args()
    home = args.home.resolve()
    os.environ.update(environment(home, args.source))
    if args.plan:
        from download_plan import download_plan
        download_plan(home, args.plan.resolve(), args.source, chunk_bytes=args.chunk_mib * 1024 * 1024)
        return
    # Import only after selecting the endpoint: HF captures it during import.
    from huggingface_hub import HfApi, hf_hub_download, snapshot_download

    api = HfApi(endpoint=ENDPOINTS[args.source])
    records = []

    def snapshot(repo, target, patterns=None):
        revision = api.model_info(repo).sha
        print(f"Downloading {repo} @ {revision} from {ENDPOINTS[args.source]}", flush=True)
        snapshot_download(repo_id=repo, revision=revision, local_dir=str(target),
                          allow_patterns=patterns, max_workers=3)
        records.append({"repo": repo, "revision": revision})

    root = models(home)
    snapshot(MODEL_ID, root)
    bert_repo = "facebook/w2v-bert-2.0"
    files = api.list_repo_files(bert_repo)
    weight = "model.safetensors" if "model.safetensors" in files else "pytorch_model.bin"
    if weight not in files:
        raise RuntimeError("w2v-bert-2.0 has no supported weight file")
    snapshot(bert_repo, root / "hf_cache/w2v-bert-2.0", ["*.json", weight])
    for repo, remote, relative in (
        ("amphion/MaskGCT", "semantic_codec/model.safetensors", "semantic_codec_model.safetensors"),
        ("funasr/campplus", "campplus_cn_common.bin", "campplus_cn_common.bin"),
        ("nvidia/bigvgan_v2_22khz_80band_256x", "config.json", "bigvgan/config.json"),
        ("nvidia/bigvgan_v2_22khz_80band_256x", "bigvgan_generator.pt", "bigvgan/bigvgan_generator.pt"),
    ):
        revision = api.model_info(repo).sha
        target = root / "hf_cache" / relative
        record = {"repo": repo, "revision": revision, "file": remote}
        previous = home / "downloads.json"
        from common import read_json
        done = read_json(previous, {}).get("models", [])
        if not (target.is_file() and target.stat().st_size > 0 and record in done):
            downloaded = hf_hub_download(repo_id=repo, filename=remote, revision=revision,
                                         cache_dir=str(home / "cache/hub-files"))
            target.parent.mkdir(parents=True, exist_ok=True)
            partial = target.with_name(target.name + ".partial")
            shutil.copyfile(downloaded, partial)
            os.replace(partial, target)
        records.append(record)

    if args.sample:
        sample = hf_hub_download(repo_id="IndexTeam/IndexTTS-2-Demo", repo_type="space",
                                filename="examples/voice_01.wav",
                                cache_dir=str(home / "cache/hub-files"))
        destination = home / "samples/upstream-demo.wav"
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(sample, destination)
        print(f"Demo reference: {destination}", flush=True)

    write_json(home / "downloads.json", {
        "source": args.source, "endpoint": ENDPOINTS[args.source],
        "completed_at": datetime.now(timezone.utc).isoformat(), "models": records,
    })
    print("All main and auxiliary models downloaded.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Download failed: {error}", file=sys.stderr)
        sys.exit(1)
