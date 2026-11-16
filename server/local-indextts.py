"""独立进程完成一次模型检查或声音生成，结果通过文件回传。"""
import argparse
import json
import os
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--job", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    scripts = Path(__file__).resolve().parent.parent / "integrations/indextts-local/scripts"
    sys.path.insert(0, str(scripts))
    from common import environment, missing_models, UPSTREAM_REVISION
    os.environ.update(environment(args.home))
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    sys.path.insert(0, str(args.home / "upstream"))
    import torch
    missing = missing_models(args.home)
    if args.check:
        result = {"kind": "environment-check", "cuda": torch.cuda.is_available(),
                  "torch": torch.__version__, "missingModels": missing,
                  "upstreamCommit": UPSTREAM_REVISION, "inferenceVerified": False}
    else:
        if missing:
            raise RuntimeError("模型文件缺失：" + ", ".join(missing))
        if args.job is None:
            raise ValueError("未提供生成任务文件")
        from worker import Service, load_engine
        payload = json.loads(args.job.read_text(encoding="utf-8-sig"))
        service = Service(args.home)
        service.engine = load_engine(args.home, False)
        result = {"kind": "inference", "model": "IndexTTS-2.5", "upstreamCommit": UPSTREAM_REVISION,
                  **service.synthesize(payload)}
    temporary = args.result.with_suffix(".partial.json")
    temporary.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, args.result)


if __name__ == "__main__":
    main()
