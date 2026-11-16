"""真实执行已有增强模型的四秒候选，保持原画幅、时间轴及驱动音轨。"""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import subprocess
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--ffmpeg", type=Path, required=True)
    parser.add_argument("--ffprobe", type=Path, required=True)
    args = parser.parse_args()
    import numpy as np
    import torch
    from PIL import Image, ImageDraw, ImageFont
    from spandrel import ModelLoader
    helper_path = Path(__file__).with_name("try-musetalk-detail-enhance.py")
    spec = importlib.util.spec_from_file_location("detail_enhance",helper_path)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    args.output = args.output.resolve()
    args.output.mkdir(exist_ok=False)
    started = time.perf_counter()
    report = json.loads(args.report.read_text(encoding="utf-8-sig"))
    source = Path(report["asset"]["path"])
    source_hash = helper.digest(source)
    model_hash = helper.digest(args.model)
    if source_hash != report["output"]["sha256"]:
        raise ValueError("原口型产物哈希变化")
    model = ModelLoader().load_from_state_dict(torch.load(args.model,map_location="cpu",weights_only=True)).eval().to("cuda").half()
    if model.scale != 2:
        raise ValueError("不是已核验2倍增强模型")
    measurements = {row["frame"]:row for row in map(json.loads,(Path(report["worker"])/"face-measurements.jsonl").read_text(encoding="utf-8").splitlines())}
    start_seconds, seconds, fps, width, height = 99, 4, 30, 1080, 1920
    frame_count = seconds*fps
    first_frame = start_seconds*fps
    baseline = args.output / "99-103秒-原口型.mp4"
    candidate = args.output / "99-103秒-嘴周增强候选.mp4"
    flags = {"creationflags":subprocess.CREATE_NO_WINDOW}
    decode_log = (args.output/"decode-stderr.log").open("wb")
    decoder = subprocess.Popen([str(args.ffmpeg),"-v","error","-ss",str(start_seconds),"-i",str(source),"-map","0:v:0","-frames:v",str(frame_count),"-pix_fmt","rgb24","-f","rawvideo","pipe:1"],stdout=subprocess.PIPE,stderr=decode_log,**flags)
    encoders = []
    logs = []
    try:
        for file in [baseline,candidate]:
            log = (args.output/(file.stem+"-stderr.log")).open("wb")
            logs.append(log)
            command = [str(args.ffmpeg),"-v","error","-n","-f","rawvideo","-pixel_format","rgb24","-video_size",f"{width}x{height}","-framerate",str(fps),"-i","pipe:0","-ss",str(start_seconds),"-i",str(source),"-map","0:v:0","-map","1:a:0","-t",str(seconds),"-c:v","libx264","-crf","18","-preset","fast","-pix_fmt","yuv420p","-c:a","aac","-b:a","160k","-movflags","+faststart",str(file)]
            encoders.append(subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=log,**flags))
        trace = []
        panels = []
        font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc",17)
        with torch.inference_mode():
            for index in range(frame_count):
                data = bytearray()
                while len(data)<width*height*3:
                    block = decoder.stdout.read(width*height*3-len(data))
                    if not block:
                        raise ValueError("短片原帧提前结束")
                    data.extend(block)
                original = np.frombuffer(data,np.uint8).reshape(height,width,3)
                x1,y1,x2,y2 = measurements[first_frame+index]["box"]
                crop = original[y1:y2,x1:x2]
                whole, local, alpha = helper.enhance_local_image(model,crop)
                combined = original.copy()
                combined[y1:y2,x1:x2] = local
                difference = np.any(combined!=original,axis=2)
                allowed = np.zeros((height,width),dtype=bool)
                allowed[y1:y2,x1:x2] = alpha>0
                if np.any(difference & ~allowed):
                    raise ValueError("候选改动了局部掩码以外画面")
                encoders[0].stdin.write(original.tobytes())
                encoders[1].stdin.write(combined.tobytes())
                trace.append({"frame":index,"sourceFrame":first_frame+index,"box":[x1,y1,x2,y2],"changedPixels":int(difference.sum()),"outsideMaskUnchangedBeforeEncoding":True})
                if index%15==0:
                    panel = Image.new("RGB",(560,405),"#181a23")
                    for column,(name,img) in enumerate([("原口型",crop),("局部增强候选",local)]):
                        display = Image.fromarray(img)
                        display.thumbnail((270,355))
                        panel.paste(display,(column*280+(280-display.width)//2,42))
                        ImageDraw.Draw(panel).text((column*280+5,10),f"{start_seconds+index/fps:.1f}秒 "+name,font=font,fill="white")
                    panels.append(panel)
                    print(json.dumps({"stage":"frame_enhanced","completed":index+1,"total":frame_count}),flush=True)
        if decoder.stdout.read(1):
            raise ValueError("短片原帧超出计划")
        decoder.stdout.close()
        if decoder.wait(timeout=30)!=0:
            raise ValueError("原视频解码失败")
        for encoder in encoders:
            encoder.stdin.close()
            if encoder.wait(timeout=60)!=0:
                raise ValueError("候选视频封装失败，参见stderr日志")
        outputs = []
        audio_bytes = []
        for file in [baseline,candidate]:
            probe = subprocess.run([str(args.ffprobe),"-v","error","-count_frames","-show_entries","stream=codec_type,width,height,avg_frame_rate,duration,nb_read_frames:format=duration","-of","json",str(file)],capture_output=True,check=True,**flags)
            metadata = json.loads(probe.stdout)
            video = next(row for row in metadata["streams"] if row["codec_type"]=="video")
            audio = next(row for row in metadata["streams"] if row["codec_type"]=="audio")
            if (video["width"],video["height"],video["avg_frame_rate"],int(video["nb_read_frames"]))!=(width,height,"30/1",frame_count) or abs(float(video["duration"])-seconds)>.001 or abs(float(audio["duration"])-seconds)>.05:
                raise ValueError("短片实际帧数/时长/画幅/音轨不符")
            subprocess.run([str(args.ffmpeg),"-v","error","-xerror","-i",str(file),"-map","0:v:0","-map","0:a:0","-f","null","-"],capture_output=True,check=True,**flags)
            sound = subprocess.run([str(args.ffmpeg),"-v","error","-i",str(file),"-map","0:a:0","-ar","16000","-ac","1","-f","s16le","pipe:1"],capture_output=True,check=True,**flags)
            audio_bytes.append(sound.stdout)
            outputs.append({"path":str(file),"sha256":helper.digest(file),"probe":metadata,"fullDecode":True})
        if audio_bytes[0]!=audio_bytes[1]:
            raise ValueError("两个对照版本音轨不一致")
        if helper.digest(source)!=source_hash or helper.digest(args.model)!=model_hash:
            raise ValueError("源视频或模型发生变化")
        sheet = Image.new("RGB",(1120,405*((len(panels)+1)//2)),"#181a23")
        for index,panel in enumerate(panels):
            sheet.paste(panel,((index%2)*560,(index//2)*405))
        sheet_file = args.output/"short-motion-contact-sheet.jpg"
        sheet.save(sheet_file,quality=96)
        result = {"at":datetime.now(timezone.utc).isoformat(),"kind":"existing-model-local-detail-short-trial","source":{"path":str(source),"sha256":source_hash},"model":{"path":str(args.model.resolve()),"sha256":model_hash,"scale":2,"architecture":model.architecture.name},"helperSha256":helper.digest(helper_path),"startSeconds":start_seconds,"duration":seconds,"frames":frame_count,"modelActuallyExecuted":True,"inferenceCalls":frame_count,"elapsedSeconds":time.perf_counter()-started,"outputs":outputs,"trace":trace,"audioBetweenCandidatesIdentical":True,"outsideMaskUnchangedBeforeEncoding":True,"inputsUnchanged":True,"contactSheet":str(sheet_file),"qualityAccepted":False,"referenceParityAccepted":False,"newSpeechGenerated":False,"newLipSyncGenerated":False,"productionDefaultChanged":False}
        with (args.output/"short-trial-report.json").open("x",encoding="utf-8") as stream:
            json.dump(result,stream,ensure_ascii=False,indent=2)
        print(json.dumps({"complete":True,"frames":frame_count,"audioIdentical":True,"elapsedSeconds":result["elapsedSeconds"]}),flush=True)
    finally:
        if decoder.poll() is None:
            decoder.kill()
            decoder.wait()
        for encoder in encoders:
            if encoder.poll() is None:
                encoder.kill()
                encoder.wait()
        decode_log.close()
        for log in logs:
            log.close()


if __name__ == "__main__":
    main()
