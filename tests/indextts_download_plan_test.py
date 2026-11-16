"""本机HTTP夹具验证断点、校验和禁止覆盖，不使用真实模型。"""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "integrations/indextts-local/scripts"))
from common import MODEL_MANIFEST, ENDPOINTS, models
from download_plan import download_plan, read_plan


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.home = Path(self.temporary.name)
        self.payload = b"local-test-fixture-not-a-model" * 8
        self.sha = hashlib.sha256(self.payload).hexdigest()
        self.requests = []
        self.confirm_ranges = True
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                parts = self.headers.get("Range", "bytes=0-").split("=")[1].split("-")
                offset = int(parts[0])
                end = min(int(parts[1]) if parts[1] else len(owner.payload) - 1, len(owner.payload) - 1)
                owner.requests.append({"path": self.path, "offset": offset})
                self.send_response(206 if offset else 200)
                self.send_header("Content-Length", str(end - offset + 1))
                if "Range" in self.headers and owner.confirm_ranges:
                    self.send_header("Content-Range", f"bytes {offset}-{end}/{len(owner.payload)}")
                self.end_headers()
                self.wfile.write(owner.payload[offset:end + 1])

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        ENDPOINTS["test"] = f"http://127.0.0.1:{self.server.server_port}"
        targets = [*MODEL_MANIFEST["required"], MODEL_MANIFEST["alternatives"][0]["files"][0]]
        self.plan = {"metadataComplete": True, "weightDownloadPerformed": False,
                     "knownTotalBytes": len(targets) * len(self.payload),
                     "repositories": [{"repo": "fixture/model", "revision": "a" * 40,
                      "files": [{"file": name, "target": name, "bytes": len(self.payload), "sha256": self.sha} for name in targets]}]}
        self.plan_file = self.home / "plan.json"
        self.save_plan()

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        ENDPOINTS.pop("test", None)

    def save_plan(self):
        self.plan_file.write_text(json.dumps(self.plan), encoding="utf-8")

    def test_resume_publish_and_reuse(self):
        root = models(self.home)
        root.mkdir(parents=True)
        partial = root / ("config.yaml." + "a" * 12 + ".partial")
        partial.write_bytes(self.payload[:17])
        download_plan(self.home, self.plan_file, "test", chunk_bytes=70)
        self.assertEqual(self.requests[0]["offset"], 17)
        self.assertFalse(partial.exists())
        receipt = json.loads((self.home / "downloads.json").read_text(encoding="utf-8"))
        self.assertTrue(all(item["outputSha256"] == self.sha for item in receipt["files"]))
        count = len(self.requests)
        download_plan(self.home, self.plan_file, "test")
        self.assertEqual(len(self.requests), count)
        self.assertFalse((self.home / "model-download.lock").exists())

    def test_bad_hash_never_publishes_or_marks_complete(self):
        self.plan["repositories"][0]["files"][0]["sha256"] = "0" * 64
        self.save_plan()
        with self.assertRaisesRegex(RuntimeError, "SHA256"):
            download_plan(self.home, self.plan_file, "test")
        self.assertFalse((models(self.home) / "config.yaml").exists())
        self.assertFalse((self.home / "downloads.json").exists())
        self.assertFalse(json.loads((self.home / "download-progress.json").read_text(encoding="utf-8"))["complete"])

    def test_existing_conflicting_file_is_preserved(self):
        root = models(self.home)
        root.mkdir(parents=True)
        target = root / "config.yaml"
        target.write_bytes(b"keep-original")
        with self.assertRaisesRegex(RuntimeError, "保留原文件"):
            download_plan(self.home, self.plan_file, "test")
        self.assertEqual(target.read_bytes(), b"keep-original")
        self.assertEqual(self.requests, [])

    def test_path_escape_and_second_downloader_are_blocked(self):
        self.plan["repositories"][0]["files"][0]["target"] = "../escape"
        self.save_plan()
        with self.assertRaisesRegex(ValueError, "路径"):
            read_plan(self.plan_file)
        self.plan["repositories"][0]["files"][0]["target"] = "config.yaml"
        self.save_plan()
        lock = self.home / "model-download.lock"
        lock.write_text("existing-owner", encoding="utf-8")
        with self.assertRaises(FileExistsError):
            download_plan(self.home, self.plan_file, "test")
        self.assertEqual(lock.read_text(), "existing-owner")
        self.assertEqual(self.requests, [])

    def test_server_without_range_confirmation_never_appends(self):
        self.confirm_ranges = False
        with self.assertRaisesRegex(RuntimeError, "未确认分段"):
            download_plan(self.home, self.plan_file, "test", chunk_bytes=70)
        root = models(self.home)
        self.assertFalse((root / "config.yaml").exists())
        self.assertFalse((root / ("config.yaml." + "a" * 12 + ".partial")).exists())
        self.assertFalse((self.home / "downloads.json").exists())


if __name__ == "__main__":
    unittest.main()
