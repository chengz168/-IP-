"""使用真实本机HTTP范围响应验证下载器；数据均为明确测试夹具。"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import threading
import unittest

spec = importlib.util.spec_from_file_location("wheel_download", Path(__file__).with_name("download-verified-wheel.py"))
downloader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(downloader)
DATA = bytes(range(256)) * 32


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        start, end = map(int, self.headers["Range"].split("=")[1].split("-"))
        wrong = self.path.startswith("/wrong")
        self.send_response(206)
        self.send_header("Content-Range", f"bytes {start + int(wrong)}-{end}/{len(DATA)}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self.wfile.write(DATA[start:end + 1])


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="官方安装包测试-")
        self.addCleanup(self.temporary.cleanup)
        self.output = Path(self.temporary.name) / "test.whl"
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        self.expected = hashlib.sha256(DATA).hexdigest()

    def test_real_range_download_and_contiguous_resume(self):
        self.output.with_suffix(".whl.partial").write_bytes(DATA[:3072])
        downloader.download(self.url + "/file", self.output, len(DATA), self.expected, chunk_bytes=1024, workers=2)
        self.assertEqual(self.output.read_bytes(), DATA)
        self.assertTrue(self.output.with_suffix(".whl.json").exists())
        self.assertFalse(self.output.with_suffix(".whl.lock").exists())

    def test_wrong_range_is_not_appended_or_published(self):
        with self.assertRaisesRegex(RuntimeError, "范围"):
            downloader.download(self.url + "/wrong", self.output, len(DATA), self.expected, chunk_bytes=1024, workers=2)
        self.assertFalse(self.output.exists())
        self.assertEqual(self.output.with_suffix(".whl.partial").stat().st_size, 0)

    def test_whole_file_hash_mismatch_keeps_partial_only(self):
        with self.assertRaisesRegex(RuntimeError, "SHA"):
            downloader.download(self.url + "/file", self.output, len(DATA), "0" * 64, chunk_bytes=4096, workers=2)
        self.assertFalse(self.output.exists())
        self.assertEqual(self.output.with_suffix(".whl.partial").read_bytes(), DATA)

    def test_existing_wrong_file_is_preserved(self):
        self.output.write_bytes(b"original")
        with self.assertRaisesRegex(RuntimeError, "保留"):
            downloader.download(self.url + "/file", self.output, len(DATA), self.expected)
        self.assertEqual(self.output.read_bytes(), b"original")

    def test_unknown_checksum_is_recorded_without_claiming_verification(self):
        import json
        downloader.download(self.url + "/file", self.output, len(DATA), None, chunk_bytes=4096, workers=2)
        receipt = json.loads(self.output.with_suffix(".whl.json").read_text())
        self.assertFalse(receipt["verified"])
        self.assertIsNone(receipt["expectedSha256"])
        self.assertEqual(receipt["sha256"], self.expected)


if __name__ == "__main__":
    unittest.main()
