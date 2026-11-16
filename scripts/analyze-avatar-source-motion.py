"""只读比较原示例动作与长成片的源帧对应关系，不推断原厂模型。"""
import argparse
import hashlib
import json
from pathlib import Path
import cv2
import numpy as np


def sha(file):
    value = hashlib.sha256()
    with open(file, "rb") as stream:
        for block in iter(lambda: stream.read(4194304), b""):
            value.update(block)
    return value.hexdigest()


def frames(file, step):
    capture = cv2.VideoCapture(str(file))
    if not capture.isOpened():
        raise RuntimeError("无法解码：" + str(file))
    fps = capture.get(cv2.CAP_PROP_FPS)
    values, indexes = [], []
    index = 0
    while capture.grab():
        if index % step == 0:
            ok, frame = capture.retrieve()
            if not ok:
                raise RuntimeError("帧解码失败")
            values.append(cv2.resize(frame, (54, 96), interpolation=cv2.INTER_AREA).astype(np.float32))
            indexes.append(index)
        index += 1
    capture.release()
    return np.asarray(values), indexes, fps, index


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    hashes = {"source": sha(args.source), "reference": sha(args.reference)}
    source, _, source_fps, count = frames(args.source, 1)
    target, indexes, fps, target_count = frames(args.reference, 15)
    # 排除顶部标题、中央人脸和下方字幕；保留身体两侧和背景区域。
    yy, xx = np.indices((96, 54))
    masks = {"outer": (yy > 14) & (yy < 75) & ((xx < 11) | (xx > 42)),
             "shoulders": (yy > 43) & (yy < 65) & ((xx < 20) | (xx > 34))}
    result = {"kind": "read-only-source-motion-analysis", "files": {"source": str(args.source), "reference": str(args.reference)},
              "hashes": hashes, "sourceFrames": count, "referenceFrames": target_count,
              "sourceFps": source_fps, "referenceFps": fps, "sampleStep": 15, "regions": {},
              "vendorAlgorithmKnown": False, "qualityAccepted": False}
    for name, mask in masks.items():
        base = source[:, mask, :]
        rows, policy_errors = [], {"forward-loop": [], "forward-reverse-repeat-endpoints": [], "forward-reverse-no-repeat-endpoints": []}
        for sample, index in zip(target, indexes):
            errors = np.mean(np.abs(base - sample[mask]), axis=(1, 2))
            nearest = int(np.argmin(errors))
            linear = round(index / fps * source_fps)
            cycle = linear % (2 * count)
            triangle = cycle if cycle < count else 2 * count - 1 - cycle
            triangle2 = linear % (2 * (count - 1))
            triangle2 = min(triangle2, 2 * (count - 1) - triangle2)
            policies = {"forward-loop": linear % count, "forward-reverse-repeat-endpoints": triangle,
                        "forward-reverse-no-repeat-endpoints": triangle2}
            row = {"frame": index, "seconds": index / fps, "nearestSourceFrame": nearest,
                   "nearestMae": float(errors[nearest]), "policies": {}}
            for policy, expected in policies.items():
                error = float(errors[expected])
                policy_errors[policy].append(error)
                row["policies"][policy] = {"sourceFrame": expected, "mae": error, "distanceFromNearest": abs(expected - nearest)}
            rows.append(row)
        result["regions"][name] = {"samples": rows, "meanNearestMae": float(np.mean([row["nearestMae"] for row in rows])),
                                  "meanPolicyMae": {key: float(np.mean(value)) for key, value in policy_errors.items()}}
    if hashes != {"source": sha(args.source), "reference": sha(args.reference)}:
        raise RuntimeError("读取期间源文件发生变化")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
    print(json.dumps({"output": str(args.output), "sourceFrames": count, "referenceFrames": target_count,
                      "metrics": {key: {k: v for k, v in value.items() if k != "samples"} for key, value in result["regions"].items()}}, ensure_ascii=True))


if __name__ == "__main__":
    main()
