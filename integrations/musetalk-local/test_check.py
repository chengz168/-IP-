"""就绪检查的路径和完整性测试；全部模型文件都是明确的微型测试夹具。"""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("musetalk_check", Path(__file__).with_name("check.py"))
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class CheckTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="musetalk-check-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.manifest = {"sourceCommit": "test-pinned-commit", "sourceFiles": [],
                         "files": [{"target": "models/test.bin", "bytes": 3,
                                    "expectedSha256": hashlib.sha256(b"abc").hexdigest()}]}

    def test_missing_runtime_is_not_created_or_imported(self):
        target = self.root / "not-installed"
        report = check.inspect(target, self.manifest, full_hash=True, device=True)
        self.assertFalse(target.exists())
        self.assertFalse(report["readyForCandidateTrial"])
        self.assertFalse(report["device"]["checked"])
        self.assertNotIn("torch", sys.modules)
        self.assertFalse(report["models"][0]["present"])

    def test_wrong_size_and_same_size_wrong_hash_are_rejected(self):
        target = self.root / "models/test.bin"
        target.parent.mkdir()
        target.write_bytes(b"long")
        report = check.inspect(self.root, self.manifest, full_hash=True)
        self.assertFalse(report["models"][0]["sizeMatches"])
        target.write_bytes(b"bad")
        report = check.inspect(self.root, self.manifest, full_hash=True)
        self.assertFalse(report["models"][0]["hashMatches"])
        self.assertFalse(report["readyForCandidateTrial"])

    def test_local_hash_is_not_misrepresented_as_official_checksum(self):
        target = self.root / "models/test.bin"
        target.parent.mkdir()
        target.write_bytes(b"abc")
        self.manifest["files"][0]["expectedSha256"] = ""
        report = check.inspect(self.root, self.manifest, full_hash=True)
        self.assertIsNone(report["models"][0]["hashMatches"])
        self.assertFalse(report["allModelHashesIndependentlyVerified"])
        self.assertEqual(report["models"][0]["sha256"], hashlib.sha256(b"abc").hexdigest())

    def test_local_download_receipt_catches_same_size_configuration_change(self):
        target = self.root / "models/test.bin"
        target.parent.mkdir()
        target.write_bytes(b"abc")
        self.manifest["files"][0]["expectedSha256"] = ""
        self.manifest["modelPlanSha256"] = "fixed-plan-test-fixture"
        receipt = {"complete": True, "planSha256": "fixed-plan-test-fixture",
                   "files": [{"target": "models/test.bin", "sha256": hashlib.sha256(b"abc").hexdigest()}]}
        (self.root / "model-receipt.json").write_text(json.dumps(receipt), encoding="utf-8")
        self.assertTrue(check.inspect(self.root, self.manifest, full_hash=True)["modelDownloadReceiptMatches"])
        target.write_bytes(b"bad")
        report = check.inspect(self.root, self.manifest, full_hash=True)
        self.assertFalse(report["modelDownloadReceiptMatches"])
        self.assertFalse(report["allModelHashesIndependentlyVerified"])

    def test_path_traversal_and_absolute_manifest_path_are_rejected(self):
        for name in ["../other.bin", str(self.root / "absolute.bin")]:
            with self.assertRaises(ValueError):
                check.inside(self.root, name)

    def test_matching_receipt_does_not_hide_modified_source(self):
        source = self.root / "source.py"
        source.write_text("modified", encoding="utf-8")
        self.manifest["sourceFiles"] = [{"path": "source.py", "sha256": hashlib.sha256(b"original").hexdigest()}]
        (self.root / "source-receipt.json").write_text(json.dumps({"sourceCommit": "test-pinned-commit"}), encoding="utf-8")
        report = check.inspect(self.root, self.manifest, full_hash=True)
        self.assertTrue(report["sourceReceiptMatches"])
        self.assertFalse(report["sources"][0]["matchesPinnedSource"])
        self.assertFalse(report["readyForCandidateTrial"])

    def test_official_git_blob_hash_matches_exact_source_bytes(self):
        contents = b"print('pinned source')\n"
        target = self.root / "musetalk/example.py"
        target.parent.mkdir()
        target.write_bytes(contents)
        expected = hashlib.sha1(b"blob " + str(len(contents)).encode("ascii") + b"\0" + contents).hexdigest()
        self.manifest["sourceFiles"] = [{"path": "musetalk/example.py", "gitBlobSha1": expected}]
        report = check.inspect(self.root, self.manifest)
        self.assertTrue(report["sources"][0]["matchesPinnedSource"])
        self.assertEqual(report["sources"][0]["gitBlobSha1"], expected)
        target.write_bytes(contents + b"# changed\n")
        self.assertFalse(check.inspect(self.root, self.manifest)["sources"][0]["matchesPinnedSource"])

    def test_unlisted_source_is_reported_and_does_not_make_environment_ready(self):
        target = self.root / "musetalk/extra.py"
        target.parent.mkdir()
        target.write_text("", encoding="utf-8")
        report = check.inspect(self.root, self.manifest)
        self.assertEqual(report["unexpectedSourceFiles"], ["musetalk/extra.py"])
        self.assertFalse(report["readyForCandidateTrial"])


if __name__ == "__main__":
    unittest.main()
