"""工作器契约与真实媒体子进程测试；夹具不代表模型生成验证。"""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import wave

spec = importlib.util.spec_from_file_location("candidate_worker", Path(__file__).with_name("worker.py"))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="口型工作器 带空格-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.video = self.root / "原形象.mp4"
        self.video.write_bytes(b"explicit-test-fixture")
        self.audio = self.root / "驱动.wav"
        with wave.open(str(self.audio), "wb") as sound:
            sound.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            sound.writeframes(b"\0\0" * 16000)
        self.plan = {"kind": "musetalk-short-input", "version": 1, "duration": 1, "fps": 2, "frameRate": "2/1",
                     "width": 32, "height": 24, "frameCount": 2, "sourceFrameCount": 2, "firstSourceFrame": 0,
                     "lastSourceFrame": 1, "sourceFramePolicy": "first-target-frames-no-loop-v1", "targetSamples": 16000,
                     "video": {"path": str(self.video), "sha256": worker.digest(self.video)},
                     "audio": {"path": str(self.audio), "sha256": worker.digest(self.audio)},
                     "driver": {"path": str(self.audio), "sha256": worker.digest(self.audio), "samples": 16000}}
        self.input = self.root / "input.json"

    def save(self):
        self.input.write_text(json.dumps(self.plan), encoding="utf-8")

    def test_input_sha_change_and_truncated_pcm_rejected(self):
        self.save()
        self.assertEqual(worker.validate_input(self.input), self.plan)
        self.video.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "video"):
            worker.validate_input(self.input)
        self.plan["video"]["sha256"] = worker.digest(self.video)
        self.audio.write_bytes(self.audio.read_bytes()[:-2])
        for key in ["audio", "driver"]:
            self.plan[key]["sha256"] = worker.digest(self.audio)
        self.save()
        with self.assertRaisesRegex(ValueError, "截断"):
            worker.validate_input(self.input)

    def test_no_fractional_rate_padding_or_loop(self):
        original = copy.deepcopy(self.plan)
        for changes in [{"frameRate": "30000/1001", "fps": 30000 / 1001}, {"duration": 1.1},
                        {"sourceFrameCount": 1}, {"firstSourceFrame": 1}, {"width": 33}]:
            self.plan = {**original, **changes}
            self.save()
            with self.assertRaises(ValueError):
                worker.validate_input(self.input)

    def test_bad_face_box_fails_at_original_index(self):
        self.assertEqual(worker.validate_box([1, 2, 20, 22], 32, 24, 15), (1, 2, 20, 22))
        for box in [[0, 0, 0, 0], [-1, 2, 20, 22], [1, 2, 33, 22], [1, float("nan"), 20, 22]]:
            with self.assertRaisesRegex(ValueError, "15"):
                worker.validate_box(box, 32, 24, 15)

    def test_no_missing_or_extra_frame_is_accepted(self):
        frames = self.root / "frames"
        frames.mkdir()
        (frames / "00000000.png").write_bytes(b"test")
        with self.assertRaises(ValueError):
            worker.validate_frames(frames, 2)
        (frames / "00000001.png").write_bytes(b"test")
        worker.validate_frames(frames, 2)
        (frames / "00000002.png").write_bytes(b"extra")
        with self.assertRaises(ValueError):
            worker.validate_frames(frames, 2)

    def test_vfr_duplicate_and_missing_timestamps_are_rejected(self):
        def values(times):
            return {"frames": [{"best_effort_timestamp_time": value} for value in times]}
        worker.validate_timeline(values([0, 1 / 30, 2 / 30]), 3, 30)
        for times in [[0, 1 / 30, 4 / 30], [0, 0, 2 / 30], [0, 1 / 30], [0, 1 / 30, float("nan")]]:
            with self.assertRaises(ValueError):
                worker.validate_timeline(values(times), 3, 30)

    def test_process_error_is_not_success_and_paths_are_literal(self):
        job = worker.Job(self.root)
        marker = self.root / "中文 & 空格.txt"
        job.process([sys.executable, "-c", "import pathlib,sys;pathlib.Path(sys.argv[1]).write_text('literal')", marker], "literal")
        self.assertEqual(marker.read_text(), "literal")
        with self.assertRaisesRegex(RuntimeError, "退出码7"):
            job.process([sys.executable, "-c", "raise SystemExit(7)"], "failure")

    def test_cancel_terminates_real_child_process(self):
        job = worker.Job(self.root)
        children = []
        original = subprocess.Popen
        def observe(*args, **kwargs):
            child = original(*args, **kwargs)
            children.append(child)
            return child
        timer = threading.Timer(0.2, job.cancel)
        timer.start()
        self.addCleanup(timer.cancel)
        with patch.object(worker.subprocess, "Popen", side_effect=observe):
            with self.assertRaises(worker.Cancelled):
                job.process([sys.executable, "-c", "import time;time.sleep(30)"], "cancel")
        self.assertEqual(len(children), 1)
        self.assertIsNotNone(children[0].poll())

    def test_media_frame_count_rotation_audio_cover_failures(self):
        picture = {"codec_type": "video", "width": 32, "height": 24, "avg_frame_rate": "2/1",
                   "r_frame_rate": "2/1", "nb_read_frames": "2"}
        probe = {"streams": [picture, {"codec_type": "audio", "duration": "1.0"}]}
        worker.validate_video(probe, self.plan, output=True)
        picture["nb_read_frames"] = "1"
        with self.assertRaisesRegex(ValueError, "帧数"):
            worker.validate_video(probe, self.plan, output=True)
        picture["nb_read_frames"] = "2"
        picture["side_data_list"] = [{"rotation": 90}]
        with self.assertRaisesRegex(ValueError, "旋转"):
            worker.validate_video(probe, self.plan, output=True)
        del picture["side_data_list"]
        probe["streams"][1]["duration"] = "0.5"
        with self.assertRaisesRegex(ValueError, "音轨"):
            worker.validate_video(probe, self.plan, output=True)

    def test_missing_runtime_returns_nonzero_without_importing_model(self):
        self.save()
        output = self.root / "attempt"
        args = type("Args", (), {"output": output, "input": self.input, "home": self.root / "missing",
                                "ffmpeg": "not-executed", "ffprobe": "not-executed"})()
        self.assertEqual(worker.execute(args), 1)
        report = json.loads((output / "result.json").read_text(encoding="utf-8"))
        self.assertEqual(report["status"], "failed")
        self.assertFalse(report["modelExecuted"])
        self.assertFalse(args.home.exists())
        self.assertNotIn("torch", sys.modules)
        self.assertFalse((output / "candidate.mp4").exists())
        before = (output / "result.json").read_bytes()
        with self.assertRaises(FileExistsError):
            worker.execute(args)
        self.assertEqual((output / "result.json").read_bytes(), before)

    @unittest.skipUnless(os.environ.get("MUSE_TEST_FFMPEG") and os.environ.get("MUSE_TEST_FFPROBE"), "需要明确媒体工具路径")
    def test_real_ffmpeg_unicode_paths_extract_encode_and_decode(self):
        ffmpeg, ffprobe = os.environ["MUSE_TEST_FFMPEG"], os.environ["MUSE_TEST_FFPROBE"]
        job = worker.Job(self.root)
        source = self.root / "真实合成夹具.mp4"
        job.process([ffmpeg, "-v", "error", "-n", "-f", "lavfi", "-i", "color=c=blue:s=32x24:r=2:d=1",
                     "-i", self.audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                     "-c:a", "aac", "-t", "1", source], "fixture")
        frames = self.root / "原尺寸帧"
        frames.mkdir()
        job.process([ffmpeg, "-v", "error", "-n", "-i", source, "-map", "0:v:0", "-an", "-vsync", "0",
                     "-frames:v", "2", "-start_number", "0", frames / "%08d.png"], "extract")
        worker.validate_frames(frames, 2)
        result = self.root / "封装夹具.mp4"
        job.process([ffmpeg, "-v", "error", "-n", "-framerate", "2/1", "-i", frames / "%08d.png", "-i", self.audio,
                     "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-t", "1", result], "encode")
        worker.validate_video(job.probe(ffprobe, result, "probe", count=True), self.plan, output=True)
        job.process([ffmpeg, "-v", "error", "-xerror", "-i", result, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"], "decode")


if __name__ == "__main__":
    unittest.main()
