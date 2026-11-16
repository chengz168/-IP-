"""对失败帧只读检查检测候选；不执行口型生成、不替换源帧。"""
import argparse
import json
import os
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--frames", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()
    integration = Path(__file__).resolve().parent.parent / "integrations/musetalk-local"
    sys.path.insert(0, str(integration))
    from worker import network_guard
    from face_selection import select_primary
    network_guard()
    sys.path.insert(0, str(args.home))
    sys.path.insert(1, str(args.home / "musetalk/utils"))
    os.chdir(args.home)
    import cv2
    import numpy as np
    import torch
    from mmpose.apis import inference_topdown
    from mmpose.structures import merge_data_samples
    from musetalk.utils.preprocessing import model, fa
    result = []
    previous = None
    files = sorted(args.frames.glob("*.png")) if args.all else [args.frames / f"{i:08d}.png" for i in [0, 239, 280, 281, 282, 283, 284, 400, 592]]
    with torch.inference_mode():
        for file in files:
            index = int(file.stem)
            original = cv2.imdecode(np.frombuffer(file.read_bytes(), np.uint8), cv2.IMREAD_COLOR)
            detections = fa.face_detector.detect_from_batch(np.asarray([original])[..., ::-1].copy())
            faces = [list(map(float, face)) for face in detections[0]]
            row = {"frame": index, "detections": faces,
                   "areas": [max(0, f[2]-f[0])*max(0, f[3]-f[1]) for f in faces]}
            primary, selection = select_primary(faces, original.shape[1], original.shape[0], index, previous if args.all else None)
            previous = primary
            row["selection"] = selection
            result.append(row)
            if not args.all or index % 50 == 0 or selection["duplicates"]:
                print(json.dumps(row), flush=True)
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump({"kind": "read-only-face-diagnostics", "frames": result, "modelGenerationPerformed": False}, stream, indent=2)


if __name__ == "__main__":
    main()
