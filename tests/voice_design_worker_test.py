"""自主音色工作器的输入、文件完整性和实际进程失败边界；不冒充模型推理测试。"""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "integrations/qwen-voice-design/worker.py"
spec = importlib.util.spec_from_file_location("voice_design_worker", SCRIPT)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


def job():
    return {"text": "晚上出来走一走，刚好路边的灯都亮了。", "instruct": "成年女性，自然普通话，松弛聊天。",
            "language": "Chinese", "seed": 42, "max_new_tokens": 512}


class VoiceDesignTests(unittest.TestCase):
    def test_actual_process_lock_rejects_overlap_and_releases(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            held = worker.inference_lock(home)
            launch = "import importlib.util,sys,pathlib;spec=importlib.util.spec_from_file_location('worker',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);lock=m.inference_lock(pathlib.Path(sys.argv[2]));lock.close()"
            try:
                result = subprocess.run([sys.executable, "-c", launch, str(SCRIPT), str(home)], capture_output=True, timeout=20)
                self.assertNotEqual(result.returncode, 0)
            finally:
                held.close()
            result = subprocess.run([sys.executable, "-c", launch, str(SCRIPT), str(home)], capture_output=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_input_rejects_reference_and_unknown_parameters(self):
        for extra in ({"reference": "original.wav"}, {"model": "https://example.invalid/model"}, {"speed": 1}):
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                worker.validate_job({**job(), **extra})

    def test_invalid_sampling_or_text_is_rejected(self):
        for field, value in (("seed", True), ("seed", -1), ("max_new_tokens", 0), ("max_new_tokens", 2049),
                             ("text", " " * 10), ("text", "字" * 201), ("instruct", ""), ("language", "English")):
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                worker.validate_job({**job(), field: value})

    def test_model_hash_rejects_same_size_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            folder = home / "models/voice-design"
            folder.mkdir(parents=True)
            file = folder / "model.safetensors"
            file.write_bytes(b"original")
            manifest = {"files": [{"file": file.name, "bytes": 8, "sha256": hashlib.sha256(b"original").hexdigest()}]}
            self.assertTrue(worker.model_files(home, manifest)["ready"])
            file.write_bytes(b"modified")
            result = worker.model_files(home, manifest)
            self.assertFalse(result["ready"])
            self.assertEqual(result["issues"][0]["issue"], "模型校验不符")

    def test_small_git_file_is_verified_by_blob(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            folder = home / "models/voice-design"
            folder.mkdir(parents=True)
            body = b'{"tts_model_type":"voice_design"}'
            (folder / "config.json").write_bytes(body)
            blob = hashlib.sha1(b"blob " + str(len(body)).encode() + b"\0" + body).hexdigest()
            manifest = {"files": [{"file": "config.json", "bytes": len(body), "sha256": None, "gitBlobId": blob}]}
            self.assertTrue(worker.model_files(home, manifest)["ready"])
            manifest["files"][0]["gitBlobId"] = "0" * 40
            self.assertFalse(worker.model_files(home, manifest)["ready"])

    def test_model_path_cannot_escape(self):
        for name in ("../original.wav", "D:/original.wav", "..\\original.wav"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
                worker.model_files(Path(directory), {"files": [{"file": name, "bytes": 1, "sha256": "0" * 64}]})

    def test_actual_missing_runtime_fails_without_network_or_model_import(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "job.json"
            source.write_text(json.dumps(job(), ensure_ascii=False), encoding="utf-8")
            output = base / "检查结果"
            # 审计钩子禁止网络与模型导入；实际执行固定工作器，不能借缺模型路径偷偷下载。
            launch = "import sys,runpy\ndef audit(event,args):\n if event=='socket.connect' or (event=='import' and args[0].split('.')[0] in ('torch','qwen_tts')): raise RuntimeError('禁止网络或提前导入模型')\nsys.addaudithook(audit)\nsys.argv=sys.argv[1:]\nrunpy.run_path(sys.argv[0],run_name='__main__')"
            result = subprocess.run([sys.executable, "-c", launch, str(SCRIPT), "--home", str(base / "未安装环境"),
                                     "--directory", str(output), "--job", str(source)], capture_output=True, timeout=20)
            self.assertEqual(result.returncode, 1, result.stderr.decode(errors="replace"))
            receipt = worker.read_json(output / "result.json")
            self.assertEqual(receipt["status"], "failed")
            self.assertEqual(len(receipt["environment"]["weights"]["issues"]), 11)
            self.assertFalse(receipt["modelLoaded"])
            self.assertFalse(receipt["inferenceStarted"])
            self.assertFalse(receipt["newSpeechGenerated"])
            self.assertFalse(receipt["qualityAccepted"])
            self.assertEqual(list(output.glob("*.wav")), [])
            self.assertFalse((base / "未安装环境").exists())

    def test_existing_candidate_directory_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "job.json"
            source.write_text(json.dumps(job()), encoding="utf-8")
            output = base / "previous"
            output.mkdir()
            marker = output / "result.json"
            marker.write_bytes(b"previous-result")
            result = subprocess.run([sys.executable, str(SCRIPT), "--home", str(base / "runtime"), "--directory", str(output),
                                     "--job", str(source)], capture_output=True, timeout=20)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(marker.read_bytes(), b"previous-result")

    def test_output_cannot_be_inside_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            home = base / "runtime"
            home.mkdir()
            output = home / "bad-output"
            result = subprocess.run([sys.executable, str(SCRIPT), "--home", str(home), "--directory", str(output), "--check"],
                                    capture_output=True, timeout=20)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
