"""正式输入与真实编码检查；合成彩色帧仅用于媒体契约，不冒称模型效果。"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import wave
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import worker
from stream_encoder import StreamEncoder


class ProductionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="本地口型 编码-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def test_cross_process_lock_released_after_exit(self):
        file = self.root / "shared.lock"
        lock = worker.inference_lock(file)
        command = "import sys;from pathlib import Path;from worker import inference_lock;inference_lock(Path(sys.argv[1])).close()"
        result = subprocess.run([sys.executable, "-c", command, str(file)], cwd=Path(__file__).parent, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        lock.close()
        result = subprocess.run([sys.executable, "-c", command, str(file)], cwd=Path(__file__).parent, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(file.exists())

    def test_source_cycle_and_parent_cancellation(self):
        plan = {"version": 2, "sourceFrameCount": 3}
        self.assertEqual([worker.source_index(i, plan) for i in range(12)], [0, 1, 2, 2, 1, 0, 0, 1, 2, 2, 1, 0])
        child = self.root / "worker"
        child.mkdir()
        (self.root / "cancel.request").touch()
        with self.assertRaises(worker.Cancelled):
            worker.Job(child).checkpoint()

    def test_production_input_exact_samples_and_invalid_padding(self):
        video = self.root / "source.mp4"
        video.write_bytes(b"explicit-protocol-fixture")
        audio = self.root / "audio.wav"
        driver = self.root / "driver.wav"
        for file, samples in [(audio, 32208), (driver, 32535)]:
            with wave.open(str(file), "wb") as sound:
                sound.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
                sound.writeframes(b"\0\0" * samples)
        plan = {"kind": "musetalk-production-input", "version": 2, "duration": 61 / 30,
                "fps": 30, "frameRate": "30/1", "width": 32, "height": 24, "sourceFrameCount": 30,
                "frameCount": 61, "extractedSourceFrames": 30, "sourceFramePolicy": "forward-reverse-repeat-endpoints-v1",
                "audioSamples": 32208, "audioDuration": 32208 / 16000, "targetSamples": 32535,
                "featurePaddingSamples": 327,
                "video": {"path": str(video), "sha256": worker.digest(video)},
                "audio": {"path": str(audio), "sha256": worker.digest(audio)},
                "driver": {"path": str(driver), "sha256": worker.digest(driver), "samples": 32535}}
        file = self.root / "input.json"
        file.write_text(json.dumps(plan), encoding="utf-8")
        self.assertEqual(worker.validate_input(file), plan)
        plan["featurePaddingSamples"] = 326
        file.write_text(json.dumps(plan), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "采样"):
            worker.validate_input(file)

    @unittest.skipUnless(os.environ.get("MUSE_TEST_FFMPEG") and os.environ.get("MUSE_TEST_FFPROBE"), "需要明确媒体工具路径")
    def test_real_stream_order_decode_and_cancel(self):
        job = worker.Job(self.root)
        plan = {"width": 32, "height": 24, "frameRate": "30/1", "frameCount": 61}
        file = self.root / "picture.mp4"
        encoder = StreamEncoder(job, os.environ["MUSE_TEST_FFMPEG"], plan, file)
        try:
            with self.assertRaises(ValueError):
                encoder.write(1, np.zeros((24, 32, 3), dtype=np.uint8))
            for index in range(61):
                encoder.write(index, np.full((24, 32, 3), index * 3, dtype=np.uint8))
            encoder.finish()
        finally:
            encoder.close()
        probe = job.probe(os.environ["MUSE_TEST_FFPROBE"], file, "actual", count=True)
        self.assertEqual(probe["streams"][0]["nb_read_frames"], "61")
        job.process([os.environ["MUSE_TEST_FFMPEG"], "-v", "error", "-xerror", "-i", file, "-f", "null", "-"], "decode")
        encoder = StreamEncoder(job, os.environ["MUSE_TEST_FFMPEG"], plan, self.root / "cancel.mp4")
        try:
            job.cancel()
            with self.assertRaises(worker.Cancelled):
                encoder.write(0, np.zeros((24, 32, 3), dtype=np.uint8))
        finally:
            encoder.close()
        self.assertIsNotNone(encoder.child.poll())


if __name__ == "__main__":
    unittest.main()
