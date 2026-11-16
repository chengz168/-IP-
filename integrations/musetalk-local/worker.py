"""专用口型工作器；区分独立短片v1与产品长片v2输入契约。"""
import argparse
from datetime import datetime, timezone
from fractions import Fraction
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import wave
import shutil


class Cancelled(Exception):
    pass


def digest(file):
    value = hashlib.sha256()
    with Path(file).open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def write_json(file, data):
    temporary = file.with_name(file.name + ".partial")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, file)


def validate_input(file):
    plan = json.loads(Path(file).read_text(encoding="utf-8-sig"))
    production = plan.get("kind") == "musetalk-production-input" and plan.get("version") == 2
    if not production and (plan.get("kind") != "musetalk-short-input" or plan.get("version") != 1):
        raise ValueError("不是当前短口型输入清单")
    fps = Fraction(plan["frameRate"])
    duration = plan["duration"]
    if not isinstance(duration, (int, float)) or not math.isfinite(duration) or not 1 <= duration <= (600 if production else 8):
        raise ValueError("驱动时长超出当前输入版本范围")
    if fps.denominator != 1 or not 1 <= fps <= 60 or abs(float(fps) - plan["fps"]) > 1e-8:
        raise ValueError("候选第一版只支持1至60的整数帧率")
    count = plan["frameCount"]
    if type(count) is not int or abs(duration * float(fps) - count) > 1e-6:
        raise ValueError("候选驱动必须恰好覆盖完整帧，不隐式补帧或变速")
    for key in ["width", "height", "sourceFrameCount"]:
        if type(plan[key]) is not int or plan[key] <= 0:
            raise ValueError("画面元数据无效")
    if plan["width"] % 2 or plan["height"] % 2:
        raise ValueError("当前yuv420p封装需偶数尺寸，不隐式缩放")
    if production:
        samples = plan.get("audioSamples")
        if (type(samples) is not int or not 16000 <= samples <= 9600000
                or abs(plan.get("audioDuration", 0) - samples / 16000) > 1e-9
                or count != math.ceil(samples * int(fps) / 16000)
                or plan.get("targetSamples") != math.ceil(count * 16000 / int(fps)) + 1
                or plan.get("featurePaddingSamples") != plan["targetSamples"] - samples
                or plan.get("sourceFramePolicy") != "forward-reverse-repeat-endpoints-v1"
                or plan.get("extractedSourceFrames") != min(count, plan["sourceFrameCount"])):
            raise ValueError("正式输入的采样、尾帧或往返动作计划不符")
    elif (plan.get("firstSourceFrame") != 0 or plan.get("lastSourceFrame") != count - 1
            or plan["sourceFrameCount"] < count
            or plan.get("sourceFramePolicy") != "first-target-frames-no-loop-v1"):
        raise ValueError("源帧计划必须连续且不循环")
    for key in ["video", "audio", "driver"]:
        item = plan[key]
        target = Path(item["path"])
        if not target.is_absolute() or not target.is_file() or digest(target) != item["sha256"]:
            raise ValueError("输入文件不存在或已变化：" + key)
    with wave.open(plan["driver"]["path"], "rb") as sound:
        count_samples = sound.getnframes()
        if (sound.getframerate(), sound.getnchannels(), sound.getsampwidth(), sound.getcomptype()) != (16000, 1, 2, "NONE"):
            raise ValueError("驱动必须为16kHz单声道16位PCM")
        if (count_samples != plan["driver"]["samples"] or count_samples != plan["targetSamples"]
                or abs(count_samples / 16000 - duration) > (2 / 16000 if production else 1 / 16000)):
            raise ValueError("驱动采样数与清单不一致")
        if len(sound.readframes(count_samples)) != count_samples * 2:
            raise ValueError("驱动数据截断")
    return plan


def validate_box(box, width, height, index):
    if len(box) != 4 or any(not math.isfinite(float(value)) for value in box):
        raise ValueError("人脸框无效，帧" + str(index))
    x1, y1, x2, y2 = [int(value) for value in box]
    if not 0 <= x1 < x2 <= width or not 0 <= y1 < y2 <= height:
        raise ValueError("未检出有效人脸或人脸框越界，帧" + str(index))
    return x1, y1, x2, y2


def validate_frames(directory, count):
    actual = sorted(file.name for file in directory.iterdir())
    expected = [f"{index:08d}.png" for index in range(count)]
    if actual != expected or any(not (directory / name).stat().st_size for name in expected):
        raise ValueError("帧序列缺失、多出或不连续")


def validate_timeline(data, count, fps):
    times = [float(frame["best_effort_timestamp_time"]) for frame in data["frames"]]
    if len(times) != count or any(not math.isfinite(value) for value in times):
        raise ValueError("实际帧时间戳缺失或数量不符")
    if any(abs((times[index] - times[index - 1]) - 1 / fps) > 1e-5 for index in range(1, count)):
        raise ValueError("实际画面不是恒定帧率，拒绝隐式转换")


class Job:
    def __init__(self, directory):
        self.directory = directory
        self.stopped = False

    def cancel(self, *_):
        self.stopped = True

    def checkpoint(self):
        if self.stopped or (self.directory / "cancel.request").exists() or (self.directory.parent / "cancel.request").exists():
            raise Cancelled("已取消，保留失败现场且不绑定视频")

    def event(self, stage, **values):
        self.checkpoint()
        row = {"at": datetime.now(timezone.utc).isoformat(), "stage": stage, **values}
        with (self.directory / "events.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")
            stream.flush()
        print(json.dumps(row, ensure_ascii=True), flush=True)

    def process(self, args, name, timeout=180):
        self.checkpoint()
        started = time.monotonic()
        with (self.directory / (name + ".log")).open("wb") as log:
            child = subprocess.Popen([str(arg) for arg in args], shell=False, stdin=subprocess.DEVNULL,
                                     stdout=log, stderr=subprocess.STDOUT,
                                     creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            try:
                while child.poll() is None:
                    self.checkpoint()
                    if time.monotonic() - started > timeout:
                        raise TimeoutError("媒体子进程超时：" + name)
                    time.sleep(0.05)
                if child.returncode:
                    raise RuntimeError("媒体子进程失败：" + name + "，退出码" + str(child.returncode))
            finally:
                if child.poll() is None:
                    child.terminate()
                    try:
                        child.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait()
        self.checkpoint()

    def probe(self, ffprobe, file, name, *, count=False):
        self.process([ffprobe, "-v", "error", *(["-count_frames"] if count else []),
                      "-show_streams", "-show_format", "-of", "json", file], name)
        return json.loads((self.directory / (name + ".log")).read_text(encoding="utf-8-sig"))

    def timeline(self, ffprobe, file, name, count, fps):
        self.process([ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries",
                      "frame=best_effort_timestamp_time", "-of", "json", file], name)
        data = json.loads((self.directory / (name + ".log")).read_text(encoding="utf-8-sig"))
        validate_timeline(data, count, fps)


def validate_video(probe, plan, *, output=False):
    pictures = [item for item in probe["streams"] if item["codec_type"] == "video"]
    if len(pictures) != 1:
        raise ValueError("视频流数量不符")
    picture = pictures[0]
    if (picture["width"], picture["height"]) != (plan["width"], plan["height"]):
        raise ValueError("尺寸与源计划不符")
    if Fraction(picture["avg_frame_rate"]) != Fraction(plan["frameRate"]):
        raise ValueError("帧率与源计划不符")
    if Fraction(picture["r_frame_rate"]) != Fraction(plan["frameRate"]):
        raise ValueError("恒定帧率不符")
    rotation = float(next((item["rotation"] for item in picture.get("side_data_list", []) if "rotation" in item), picture.get("tags", {}).get("rotate", 0)))
    if not math.isfinite(rotation) or rotation % 360:
        raise ValueError("不隐式旋转视频")
    frames = int(picture.get("nb_read_frames", picture.get("nb_frames", -1)))
    if frames != (plan["frameCount"] if output else plan["sourceFrameCount"]):
        raise ValueError("实际解码帧数与计划不符")
    if output:
        sounds = [item for item in probe["streams"] if item["codec_type"] == "audio"]
        if len(sounds) != 1 or abs(float(sounds[0]["duration"]) - plan["duration"]) > 0.05:
            raise ValueError("成片音轨覆盖不符")


def network_guard():
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1", DO_NOT_TRACK="1")
    def deny(event, _):
        if event in {"socket.connect", "socket.getaddrinfo", "socket.sendto"}:
            raise RuntimeError("候选推理禁止Python套接字联网；请先明确补齐依赖或模型")
    sys.addaudithook(deny)


def source_index(index, plan):
    if plan.get("version") == 2:
        count = plan["sourceFrameCount"]
        phase = index % (count * 2)
        return phase if phase < count else count * 2 - 1 - phase
    return index


def inference_lock(file):
    # 使用操作系统持有的互斥锁；进程崩溃时自动释放，不删除路径制造双锁竞态。
    lock = file.open("a+b")
    try:
        lock.seek(0, 2)
        if lock.tell() == 0:
            lock.write(b" ")
            lock.flush()
        lock.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        # 第一个字节始终存在且锁住，记录只写其后。
        lock.seek(1)
        lock.truncate()
        lock.write(json.dumps({"pid": os.getpid(), "at": datetime.now(timezone.utc).isoformat()}).encode())
        lock.flush()
        return lock
    except BaseException:
        lock.close()
        raise RuntimeError("本地口型模型已被其他进程占用，请先等待或取消原任务")


def execute(args):
    args.input = args.input.resolve()
    directory = args.output.resolve()
    # 独占目录在异常处理之外创建，既有结果绝不改写。
    directory.mkdir(parents=False, exist_ok=False)
    job = Job(directory)
    for signum in [signal.SIGINT, signal.SIGTERM]:
        signal.signal(signum, job.cancel)
    report = {"kind": "musetalk-candidate-trial", "status": "running", "modelExecuted": False,
              "inferenceCalls": 0, "generatedFrames": 0, "inferenceVerified": False,
              "newVideoGenerated": False, "qualityAccepted": False, "referenceParityAccepted": False}
    lock, encoder = None, None
    def event(stage, **values):
        if stage == "inference_started":
            report["modelExecuted"] = True
            report["inferenceCalls"] += 1
        if stage == "inferred":
            report["generatedFrames"] = values["completed"]
        job.event(stage, **values)
    try:
        write_json(directory / "result.json", report)
        plan = validate_input(args.input)
        production = plan.get("version") == 2
        report["inputManifestSha256"] = digest(args.input)
        write_json(directory / "input-snapshot.json", plan)
        home = args.home.resolve()
        if not home.is_dir():
            raise RuntimeError("专用口型运行目录尚未准备")
        lock = inference_lock(home / "candidate-inference.lock")
        spec = importlib.util.spec_from_file_location("candidate_readiness", Path(__file__).with_name("check.py"))
        readiness = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(readiness)
        manifest = json.loads(Path(__file__).with_name("model-manifest.json").read_text(encoding="utf-8"))
        network_guard()
        checked = readiness.inspect(home, manifest, full_hash=True, device=True)
        write_json(directory / "readiness.json", checked)
        if not checked["readyForCandidateTrial"]:
            raise RuntimeError("模型、固定源码、隔离Python或CUDA依赖检查未通过，见readiness.json")
        event("ready", sourceCommit=manifest["sourceCommit"])
        source_probe = job.probe(args.ffprobe, plan["video"]["path"], "source-probe", count=True)
        validate_video(source_probe, plan)
        job.timeline(args.ffprobe, plan["video"]["path"], "source-timeline", plan["sourceFrameCount"], plan["fps"])
        frames = directory / "source-frames"
        generated = directory / "generated-frames"
        frames.mkdir()
        extracted_count = plan["extractedSourceFrames"] if production else plan["frameCount"]
        # PNG按未压缩像素保守预估，另留最终编码和日志空间。
        required_space = plan["width"] * plan["height"] * 4 * (extracted_count + 32) + 512 * 1024 * 1024
        if production and shutil.disk_usage(directory).free < required_space:
            raise RuntimeError("本地口型临时磁盘空间不足，至少需要" + str(math.ceil(required_space / 1024 ** 3)) + "GiB")
        if not production:
            generated.mkdir()
        job.process([args.ffmpeg, "-v", "error", "-n", "-noautorotate", "-i", plan["video"]["path"],
                     "-map", "0:v:0", "-an", "-vsync", "0", "-frames:v", extracted_count,
                     "-start_number", "0", frames / "%08d.png"], "extract", timeout=600)
        validate_frames(frames, extracted_count)
        job.event("source_frames_ready", count=extracted_count)
        sys.path.insert(0, str(Path(__file__).parent))
        from model_backend import generate
        if production:
            from stream_encoder import StreamEncoder
            encoder = StreamEncoder(job, args.ffmpeg, plan, directory / "picture.mp4")
            generate(home, plan, frames, generated, event, job.checkpoint, encoder.write)
            encoder.finish()
        else:
            generate(home, plan, frames, generated, event, job.checkpoint)
            validate_frames(generated, plan["frameCount"])
        if report["generatedFrames"] != plan["frameCount"] or not report["modelExecuted"]:
            raise RuntimeError("模型帧数不符，不能把原画面作为新生成")
        if validate_input(args.input) != plan or digest(args.input) != report["inputManifestSha256"]:
            raise RuntimeError("推理过程中输入清单已变化")
        partial = directory / "candidate.partial.mp4"
        picture_args = (["-i", directory / "picture.mp4", "-c:v", "copy"] if production else
                        ["-framerate", plan["frameRate"], "-start_number", "0", "-i", generated / "%08d.png"])
        # 输出选项必须位于全部输入之后，避免-c:v被误解为下一个输入的解码选项。
        video_codec = ["-c:v", "copy"] if production else ["-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p"]
        if production:
            picture_args = ["-i", directory / "picture.mp4"]
        job.process([args.ffmpeg, "-v", "error", "-n", *picture_args,
                     "-i", plan["audio"]["path"], "-map", "0:v:0", "-map", "1:a:0", *video_codec,
                     "-c:a", "aac", "-b:a", "192k", "-t", plan["duration"], "-movflags", "+faststart", partial], "encode", timeout=600)
        actual = job.probe(args.ffprobe, partial, "output-probe", count=True)
        validate_video(actual, plan, output=True)
        job.timeline(args.ffprobe, partial, "output-timeline", plan["frameCount"], plan["fps"])
        job.process([args.ffmpeg, "-v", "error", "-xerror", "-i", partial,
                     "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"], "full-decode")
        validate_input(args.input)
        job.checkpoint()
        result = directory / "candidate.mp4"
        os.link(partial, result)
        partial.unlink()
        report.update(status="technical-complete", inferenceVerified=True, newVideoGenerated=True,
                      output={"path": str(result), "sha256": digest(result), "frames": plan["frameCount"],
                              "width": plan["width"], "height": plan["height"], "fps": plan["fps"]},
                      originalAudioReused=True, newSpeechGenerated=False, fullDecodeVerified=True,
                      sourceFramePolicy=plan["sourceFramePolicy"], sourceVideoReusedOutsideFace=True)
        if production:
            shutil.rmtree(frames)
            (directory / "picture.mp4").unlink()
            report["largeFrameCacheRemoved"] = True
        write_json(directory / "result.json", report)
        return 0
    except BaseException as error:
        cancelled = isinstance(error, (Cancelled, KeyboardInterrupt))
        report.update(status="cancelled" if cancelled else "failed", error=str(error) or type(error).__name__)
        write_json(directory / "result.json", report)
        print(json.dumps(report, ensure_ascii=True), file=sys.stderr, flush=True)
        return 130 if cancelled else 1
    finally:
        if encoder:
            encoder.close()
        if lock:
            lock.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--ffprobe", required=True)
    sys.exit(execute(parser.parse_args()))


if __name__ == "__main__":
    main()
