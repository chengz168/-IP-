"""固定1.5中心与256尺寸，真实比较裁脸下沿余量；不改正式参数。"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import wave


def digest(file):
    value = hashlib.sha256()
    with Path(file).open("rb") as stream:
        for chunk in iter(lambda: stream.read(4*1024*1024), b""):
            value.update(chunk)
    return value.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--home",type=Path,required=True)
    parser.add_argument("--report",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--ffmpeg",type=Path,required=True)
    args = parser.parse_args()
    args.home = args.home.resolve()
    args.report = args.report.resolve()
    args.output = args.output.resolve()
    args.output.mkdir(exist_ok=False)
    started = time.perf_counter()
    integration = Path(__file__).resolve().parent.parent / "integrations/musetalk-local"
    sys.path.insert(0,str(integration))
    from worker import network_guard
    network_guard()
    sys.path.insert(0,str(args.home))
    sys.path.insert(1,str(args.home/"musetalk/utils"))
    os.chdir(args.home)
    import cv2
    import numpy as np
    import torch
    from PIL import Image,ImageDraw,ImageFont
    from transformers import WhisperModel
    from musetalk.utils.audio_processor import AudioProcessor
    from musetalk.utils.utils import load_all_model
    from musetalk.utils.face_parsing import FaceParsing
    from musetalk.utils.blending import get_image
    report = json.loads(args.report.read_text(encoding="utf-8-sig"))
    measurements_file = Path(report["worker"])/"face-measurements.jsonl"
    measurements = {row["frame"]:row for row in map(json.loads,measurements_file.read_text(encoding="utf-8").splitlines())}
    # 输入、模型与已固定上游代码全部纳入可复核散列。
    protected = [args.report, measurements_file, Path(report["plan"]["video"]["path"]),Path(report["plan"]["audio"]["path"]),
                 args.home/"models/musetalkV15/unet.pth",args.home/"models/musetalkV15/musetalk.json",args.home/"models/sd-vae/diffusion_pytorch_model.bin",
                 args.home/"scripts/inference.py",args.home/"musetalk/utils/preprocessing.py",integration/"model_backend.py"]
    hashes = {str(file):digest(file) for file in protected}
    flags = {"creationflags":subprocess.CREATE_NO_WINDOW}
    driver = args.output/"driver-99-103s.wav"
    subprocess.run([str(args.ffmpeg),"-v","error","-n","-ss","99","-i",report["plan"]["audio"]["path"],"-t","4","-ar","16000","-ac","1","-c:a","pcm_s16le",str(driver)],capture_output=True,check=True,**flags)
    with wave.open(str(driver),"rb") as stream:
        pcm = stream.readframes(stream.getnframes())
        if (stream.getframerate(),stream.getnchannels(),stream.getsampwidth(),len(pcm)) != (16000,1,2,128000):
            raise ValueError("驱动片段实际格式或采样数不符")
    # 与生产输入相同，增加一个零采样保证120帧特征的浮点边界。
    padded = args.output/"driver-padded.wav"
    with wave.open(str(padded),"wb") as stream:
        stream.setparams((1,2,16000,0,"NONE","not compressed"))
        stream.writeframes(pcm+b"\0\0")
    device = torch.device("cuda:0")
    if not torch.cuda.is_available():
        raise ValueError("当前CUDA不可用")
    vae,unet,pe = load_all_model(unet_model_path=str(args.home/"models/musetalkV15/unet.pth"),unet_config=str(args.home/"models/musetalkV15/musetalk.json"),vae_type="sd-vae",device=device)
    vae.vae = vae.vae.half().to(device).eval()
    unet.model = unet.model.half().to(device).eval()
    pe = pe.half().to(device).eval()
    whisper = WhisperModel.from_pretrained(str(args.home/"models/whisper"),local_files_only=True).to(device=device,dtype=unet.model.dtype).eval()
    whisper.requires_grad_(False)
    processor = AudioProcessor(feature_extractor_path=str(args.home/"models/whisper"))
    face_parser = FaceParsing(left_cheek_width=90,right_cheek_width=90)
    times = [99.5,100,100.5,101]
    samples = []
    for seconds in times:
        completed = subprocess.run([str(args.ffmpeg),"-v","error","-ss",str(seconds),"-i",report["plan"]["video"]["path"],"-frames:v","1","-f","image2pipe","-vcodec","png","pipe:1"],capture_output=True,check=True,**flags)
        image = cv2.imdecode(np.frombuffer(completed.stdout,np.uint8),cv2.IMREAD_COLOR)
        if image is None or image.shape != (1920,1080,3):
            raise ValueError("源图必须为1080×1920原始帧")
        frame = round(seconds*30)
        box = measurements[frame]["box"]
        samples.append({"time":seconds,"frame":frame,"audioFeatureFrame":round((seconds-99)*30),"image":image,"baseBox":box})
    rows = []
    with torch.inference_mode():
        features,length = processor.get_audio_feature(str(padded))
        if length!=64001:
            raise ValueError("驱动特征采样长度不符")
        chunks = processor.get_whisper_chunk(features,device,unet.model.dtype,whisper,length,fps=30,audio_padding_length_left=2,audio_padding_length_right=2)
        if len(chunks)!=120:
            raise ValueError("驱动特征不是120帧")
        conditioning = pe(chunks[[sample["audioFeatureFrame"] for sample in samples]].to(device=device,dtype=unet.model.dtype))
        for margin in [0,10,20]:
            torch.manual_seed(42)
            torch.cuda.manual_seed_all(42)
            latents,boxes = [],[]
            for sample in samples:
                x1,y1,x2,y2 = sample["baseBox"]
                box = [x1,y1,x2,y2-10+margin]
                if not (0<=x1<x2<=1080 and 0<=y1<box[3]<=1920):
                    raise ValueError("候选裁脸框越界")
                crop = cv2.resize(sample["image"][y1:box[3],x1:x2],(256,256),interpolation=cv2.INTER_LANCZOS4)
                latents.append(vae.get_latents_for_unet(crop))
                boxes.append(box)
            predicted = unet.model(torch.cat(latents,dim=0).to(dtype=unet.model.dtype),torch.tensor([0],device=device),encoder_hidden_states=conditioning).sample
            if not torch.isfinite(predicted).all():
                raise ValueError("候选推理包含非有限值")
            decoded = vae.decode_latents(predicted)
            if decoded.shape!=(4,256,256,3):
                raise ValueError("候选推理输出尺寸不符")
            for sample,box,face in zip(samples,boxes,decoded):
                x1,y1,x2,y2 = box
                original = sample["image"]
                resized = cv2.resize(face,(x2-x1,y2-y1),interpolation=cv2.INTER_LINEAR)
                combined = get_image(original.copy(),resized,box,mode="jaw",fp=face_parser)
                outside = (np.array_equal(combined[:y1],original[:y1]) and np.array_equal(combined[y2:],original[y2:]) and np.array_equal(combined[y1:y2,:x1],original[y1:y2,:x1]) and np.array_equal(combined[y1:y2,x2:],original[y1:y2,x2:]))
                if not outside:
                    raise ValueError("融合改动了框外画面")
                changed = int(np.count_nonzero(np.any(combined[y1:y2,x1:x2]!=original[y1:y2,x1:x2],axis=2)))
                if changed<=0:
                    raise ValueError("口型没有实际像素改动")
                file = args.output/f"frame-{sample['frame']}-margin-{margin}.png"
                raw_file = args.output/f"raw-{sample['frame']}-margin-{margin}.png"
                for target,img in [(file,combined),(raw_file,face)]:
                    valid,png = cv2.imencode(".png",img)
                    if not valid:
                        raise ValueError("推理PNG编码失败")
                    target.write_bytes(png.tobytes())
                rows.append({"time":sample["time"],"frame":sample["frame"],"audioFeatureFrame":sample["audioFeatureFrame"],"margin":margin,"box":box,"output":str(file),"outputSha256":digest(file),"rawFace":str(raw_file),"rawFaceSha256":digest(raw_file),"outsideFaceBoxUnchangedBeforeEncoding":outside,"changedPixelsInsideFaceBox":changed})
            print(json.dumps({"stage":"margin_inferred","margin":margin,"frames":len(samples)}),flush=True)
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc",17)
    panels = []
    for sample in samples:
        panel = Image.new("RGB",(1120,405),"#181a23")
        x1,y1,x2,y2 = sample["baseBox"]
        variants = [("原片",sample["image"])]
        for margin in [0,10,20]:
            row = next(row for row in rows if row["frame"]==sample["frame"] and row["margin"]==margin)
            variants.append(("余量"+str(margin),cv2.imdecode(np.frombuffer(Path(row["output"]).read_bytes(),np.uint8),cv2.IMREAD_COLOR)))
        for column,(name,image) in enumerate(variants):
            display = Image.fromarray(cv2.cvtColor(image[y1:y2,x1:x2],cv2.COLOR_BGR2RGB))
            display.thumbnail((270,355))
            panel.paste(display,(column*280+(280-display.width)//2,42))
            ImageDraw.Draw(panel).text((column*280+5,10),str(sample["time"])+"秒 "+name,font=font,fill="white")
        panel.save(args.output/f"comparison-{sample['frame']}.jpg",quality=96)
        panels.append(panel)
    sheet = Image.new("RGB",(1120,405*len(panels)),"#181a23")
    for index,panel in enumerate(panels):
        sheet.paste(panel,(0,405*index))
    sheet_file = args.output/"crop-margin-contact-sheet.jpg"
    sheet.save(sheet_file,quality=95)
    for file,expected in hashes.items():
        if digest(file)!=expected:
            raise ValueError("模型或输入变化："+file)
    result = {"at":datetime.now(timezone.utc).isoformat(),"kind":"musetalk-v15-crop-margin-controlled-trial","modelExecuted":True,"inferenceCalls":3,"generatedFrames":len(rows),"nativeSize":[256,256],"seed":42,"bboxShift":0,"testedMargins":[0,10,20],"baseMargin":10,"driver":{"path":str(driver),"sha256":digest(driver),"paddedPath":str(padded),"paddedSha256":digest(padded),"featureFrames":120},"inputs":hashes,"inputsUnchanged":True,"frames":rows,"contactSheet":str(sheet_file),"elapsedSeconds":time.perf_counter()-started,"productionCodeChanged":False,"productionDefaultChanged":False,"qualityAccepted":False,"referenceParityAccepted":False,"limitations":["仅四时间点的三参数真实推理，不证明连续口型、人物匹配或真人感。","同参数新基线并非208秒任务的逐像素复现，截取音频上下文与随机采样进程不同。","全部候选同256尺寸、同固定中心和jaw融合，未使用超分或锐化。"]}
    with (args.output/"margin-trial-report.json").open("x",encoding="utf-8") as stream:
        json.dump(result,stream,ensure_ascii=False,indent=2)
    print(json.dumps({"complete":True,"calls":3,"generatedFrames":len(rows),"elapsedSeconds":result["elapsedSeconds"]}),flush=True)


if __name__=="__main__":
    main()
