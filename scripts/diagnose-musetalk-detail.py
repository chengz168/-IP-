"""独立定位缩放和VAE重建的细节损失，不改生产参数或既有视频。"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import subprocess


def digest(file):
    value = hashlib.sha256()
    with Path(file).open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--ffmpeg", type=Path, required=True)
    args = parser.parse_args()
    args.home = args.home.resolve()
    args.report = args.report.resolve()
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=False)
    started = time.perf_counter()
    integration = Path(__file__).resolve().parent.parent / "integrations/musetalk-local"
    sys.path.insert(0, str(integration))
    from worker import network_guard
    network_guard()
    sys.path.insert(0, str(args.home))
    os.chdir(args.home)
    import cv2
    import numpy as np
    import torch
    from PIL import Image, ImageDraw, ImageFont
    from musetalk.models.vae import VAE
    report = json.loads(args.report.read_text(encoding="utf-8-sig"))
    measurements_file = Path(report["worker"]) / "face-measurements.jsonl"
    measurements = {row["frame"]: row for row in map(json.loads, measurements_file.read_text(encoding="utf-8").splitlines())}
    model_file = args.home / "models/sd-vae/diffusion_pytorch_model.bin"
    if not model_file.is_file():
        raise ValueError("实际VAE权重路径缺失，禁止自动下载")
    # 预览PNG已缩为540宽，不能套用1080原片的裁脸坐标。
    inputs = [args.report, measurements_file, model_file, Path(report["asset"]["path"]), Path(report["plan"]["video"]["path"])]
    before = {str(file): digest(file) for file in inputs}
    if not torch.cuda.is_available():
        raise ValueError("本次诊断要求已有CUDA，不自动切换计算路径")
    vae = VAE(model_path=str(model_file.parent), use_float16=True)
    vae.vae.eval()
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 17)
    rows = []
    summary_images = []
    def extract(file, seconds):
        command = [str(args.ffmpeg), "-v", "error", "-ss", str(seconds), "-i", str(file), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"]
        completed = subprocess.run(command, capture_output=True, check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        image = cv2.imdecode(np.frombuffer(completed.stdout, np.uint8), cv2.IMREAD_COLOR)
        if image is None or image.shape != (report["plan"]["height"], report["plan"]["width"], 3):
            raise ValueError("诊断必须使用原始分辨率抽帧，禁止预览图套用原框")
        return image
    with torch.inference_mode():
        for sample in report["sampledFrames"]:
            original = extract(report["plan"]["video"]["path"], sample["sourceTime"])
            generated = extract(report["asset"]["path"], sample["time"])
            x1, y1, x2, y2 = measurements[sample["frameIndex"]]["box"]
            source = original[y1:y2, x1:x2]
            if source.shape != (y2-y1, x2-x1, 3):
                raise ValueError("裁脸框超出源图，拒绝无效诊断")
            small = cv2.resize(source, (256, 256), interpolation=cv2.INTER_LANCZOS4)
            resized_only = cv2.resize(small, (x2-x1, y2-y1), interpolation=cv2.INTER_LINEAR)
            torch.manual_seed(42)
            torch.cuda.manual_seed_all(42)
            latent = vae.encode_latents(vae.preprocess_img(small, half_mask=False))
            reconstructed = vae.decode_latents(latent)[0]
            reconstruction = cv2.resize(reconstructed, (x2-x1, y2-y1), interpolation=cv2.INTER_LINEAR)
            current = generated[y1:y2, x1:x2]
            # 固定相对区域只作细节指标，不能声称这是逐帧精确唇部检测。
            height, width = source.shape[:2]
            roi = [round(width*.25), round(height*.58), round(width*.75), round(height*.85)]
            variants = {"原片": source, "仅256缩放": resized_only, "VAE重建": reconstruction, "既有口型产物": current}
            metrics = {}
            for name, image in variants.items():
                if image.shape != source.shape:
                    raise ValueError("诊断对照图尺寸不一致")
                left, top, right, bottom = roi
                region = image[top:bottom, left:right]
                metrics[name] = {"laplacianVariance": float(cv2.Laplacian(cv2.cvtColor(region, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())}
                if name in ["仅256缩放", "VAE重建"]:
                    metrics[name]["meanAbsoluteErrorFromSourceROI"] = float(np.abs(region.astype(np.float32)-source[top:bottom, left:right].astype(np.float32)).mean())
            panel = Image.new("RGB", (4*280, 405), "#181a23")
            files = {}
            for column, (name, image) in enumerate(variants.items()):
                image_path = args.output / ("frame-" + str(sample["frameIndex"]) + "-" + str(column) + ".png")
                valid, png = cv2.imencode(".png", image)
                if not valid:
                    raise ValueError("诊断PNG编码失败")
                image_path.write_bytes(png.tobytes())
                files[name] = {"path": str(image_path), "sha256": digest(image_path)}
                display = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
                display.thumbnail((270, 355))
                panel.paste(display, (column*280+(280-display.width)//2, 42))
                ImageDraw.Draw(panel).text((column*280+8, 10), str(sample["time"])+"秒 "+name, font=font, fill="white")
            panel_path = args.output / ("comparison-"+str(sample["frameIndex"])+".jpg")
            panel.save(panel_path, quality=95)
            summary_images.append(panel)
            rows.append({"time": sample["time"], "frame": sample["frameIndex"], "box": [x1,y1,x2,y2], "nativeModelSize": [256,256], "approximateDetailROI": roi, "metricsAreNotNaturalnessScores": True, "metrics": metrics, "files": files, "comparison": str(panel_path)})
            print(json.dumps({"stage": "frame_diagnosed", "frame": sample["frameIndex"]}), flush=True)
    for file, expected in before.items():
        if digest(file) != expected:
            raise ValueError("诊断期间输入文件变化："+file)
    sheet = Image.new("RGB", (1120, 405*len(summary_images)), "#181a23")
    for index, image in enumerate(summary_images):
        sheet.paste(image, (0, 405*index))
    sheet_file = args.output / "detail-stage-contact-sheet.jpg"
    sheet.save(sheet_file, quality=94)
    result = {"at": datetime.now(timezone.utc).isoformat(), "kind": "musetalk-detail-stage-diagnostics", "newLipSyncInference": False, "vaeActuallyExecuted": True, "vaePrecision": "float16", "seed": 42, "inputs": before, "inputsUnchanged": True, "elapsedSeconds": time.perf_counter()-started, "frames": rows, "contactSheet": str(sheet_file), "qualityAccepted": False, "limitations": ["VAE重建使用完整源脸，只定位表示能力，不等同U-Net新口型。", "已生成嘴形与原片不同，梯度与误差不能充当口型或自然度评分。", "本批未修改任何生产参数或既有音视频。"]}
    with (args.output / "diagnostic-report.json").open("x", encoding="utf-8") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
    print(json.dumps({"complete": True, "frames": len(rows), "elapsedSeconds": result["elapsedSeconds"]}), flush=True)


if __name__ == "__main__":
    main()
