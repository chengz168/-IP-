"""复用已有增强模型做独立静态候选，不替换原视频或生产默认。"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time


def digest(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def enhance_local_image(model, current):
    """共用静态与短片候选的局部增强，掩码外必须逐像素一致。"""
    import numpy as np
    import torch
    from PIL import Image
    height, width = current.shape[:2]
    tensor = torch.from_numpy(current.copy()).permute(2,0,1).unsqueeze(0).to("cuda", dtype=torch.float16) / 255
    raw = model(tensor).clamp(0, 1)
    if tuple(raw.shape) != (1,3,height*2,width*2):
        raise ValueError("模型输出尺寸错误")
    enhanced = (raw[0].float().cpu().permute(1,2,0).numpy()*255).round().astype(np.uint8)
    whole = np.asarray(Image.fromarray(enhanced).resize((width,height), Image.Resampling.LANCZOS))
    yy, xx = np.mgrid[:height,:width]
    radius = np.sqrt(((xx/width-.5)/.40)**2+((yy/height-.76)/.21)**2)
    alpha = np.clip((1-radius)/.25,0,1)
    local = np.rint(current.astype(np.float32)*(1-alpha[...,None])+whole.astype(np.float32)*alpha[...,None]).clip(0,255).astype(np.uint8)
    if not np.array_equal(local[alpha==0], current[alpha==0]):
        raise ValueError("局部增强改动了掩码以外区域")
    return whole, local, alpha


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--diagnostic", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output = args.output.resolve()
    import numpy as np
    import torch
    from PIL import Image, ImageDraw, ImageFont
    from spandrel import ModelLoader, ImageModelDescriptor
    args.output.mkdir(exist_ok=False)
    started = time.perf_counter()
    report = json.loads(args.diagnostic.read_text(encoding="utf-8-sig"))
    weights_hash = digest(args.model)
    weights = torch.load(args.model, map_location="cpu", weights_only=True)
    model = ModelLoader().load_from_state_dict(weights).eval()
    if not isinstance(model, ImageModelDescriptor) or model.scale != 2 or not model.supports_half:
        raise ValueError("现有模型并非预期的2倍图像增强模型")
    if not torch.cuda.is_available():
        raise ValueError("现有CUDA不可用，不自动更换环境")
    model = model.to("cuda").half()
    torch.manual_seed(42)
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 17)
    rows = []
    panels = []
    with torch.inference_mode():
        for row in report["frames"]:
            source_file = Path(row["files"]["原片"]["path"])
            current_file = Path(row["files"]["既有口型产物"]["path"])
            if digest(current_file) != row["files"]["既有口型产物"]["sha256"]:
                raise ValueError("已有诊断输入变化")
            current = np.asarray(Image.open(current_file).convert("RGB"))
            source = np.asarray(Image.open(source_file).convert("RGB"))
            whole, local, alpha = enhance_local_image(model, current)
            variants = {"原片":source,"现有生成":current,"整脸增强候选":whole,"嘴周增强候选":local}
            files = {}
            panel = Image.new("RGB", (1120,405), "#181a23")
            for column,(name,img) in enumerate(variants.items()):
                file = args.output / ("frame-"+str(row["frame"])+"-"+str(column)+".png")
                Image.fromarray(img).save(file)
                files[name] = {"path":str(file),"sha256":digest(file)}
                display = Image.fromarray(img)
                display.thumbnail((270,355))
                panel.paste(display,(column*280+(280-display.width)//2,42))
                ImageDraw.Draw(panel).text((column*280+5,10),str(row["time"])+"秒 "+name,font=font,fill="white")
            comparison = args.output / ("comparison-"+str(row["frame"])+".jpg")
            panel.save(comparison,quality=96)
            panels.append(panel)
            rows.append({"frame":row["frame"],"time":row["time"],"files":files,"comparison":str(comparison),"outsideLocalMaskUnchanged":True})
            print(json.dumps({"stage":"enhanced","frame":row["frame"]}),flush=True)
    if digest(args.model) != weights_hash:
        raise ValueError("增强模型文件在运行中变化")
    sheet = Image.new("RGB",(1120,405*len(panels)),"#181a23")
    for index,panel in enumerate(panels):
        sheet.paste(panel,(0,405*index))
    sheet_file = args.output / "enhancement-contact-sheet.jpg"
    sheet.save(sheet_file,quality=95)
    result = {"at":datetime.now(timezone.utc).isoformat(),"modelPath":str(args.model.resolve()),"modelSha256":weights_hash,"architecture":model.architecture.name,"modelScale":model.scale,"precision":"float16","diagnosticReport":str(args.diagnostic.resolve()),"modelActuallyExecuted":True,"inferenceCalls":len(rows),"elapsedSeconds":time.perf_counter()-started,"frames":rows,"contactSheet":str(sheet_file),"newLipSyncInference":False,"newSpeechGenerated":False,"productionDefaultChanged":False,"qualityAccepted":False,"limitations":["本批仅在已有生成帧上执行已有增强模型，没有重新生成口型。","2倍增强后缩回原画幅，不能称为原生高分辨率生成。","增强细节不等于恢复真实牙齿结构，连续闪烁和人物匹配待验证。"]}
    with (args.output / "enhancement-report.json").open("x",encoding="utf-8") as stream:
        json.dump(result,stream,ensure_ascii=False,indent=2)
    print(json.dumps({"complete":True,"inferenceCalls":len(rows),"elapsedSeconds":result["elapsedSeconds"]}),flush=True)


if __name__ == "__main__":
    main()
