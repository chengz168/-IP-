"""使用真实Torch张量和声码器钩子验证量化前保护，不加载模型权重。"""
import sys
import tempfile
import unittest
import wave
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "integrations/indextts-local/scripts"))
from audio_headroom import POLICY, prepare_waveform
from worker import Service


class HeadroomTests(unittest.TestCase):
    def test_loud_signal_preserves_shape_before_integer_quantization(self):
        source = torch.tensor([-1.8, -0.5, 0.0, 0.4, 1.6], dtype=torch.float32)
        adjusted, record = prepare_waveform(source)
        self.assertAlmostEqual(record["sourcePeak"], 1.8, places=6)
        self.assertAlmostEqual(record["gain"], .95 / record["sourcePeak"])
        self.assertTrue(torch.allclose(adjusted, source * record["gain"]))
        self.assertLessEqual(adjusted.abs().max().item(), .950001)
        pcm = (32767 * adjusted).clamp(-32767, 32767).short()
        self.assertLess(pcm.abs().max().item(), 32767)

    def test_quiet_and_silent_signal_are_unchanged(self):
        for source in (torch.tensor([-.4, .6]), torch.zeros(10)):
            adjusted, record = prepare_waveform(source)
            self.assertIs(adjusted, source)
            self.assertEqual(record["gain"], 1)

    def test_invalid_audio_is_rejected(self):
        for source in (torch.tensor([]), torch.tensor([1]), torch.tensor([float("nan")]),
                       torch.tensor([float("inf")]), torch.tensor([-float("inf")])):
            with self.subTest(source=source), self.assertRaises(ValueError):
                prepare_waveform(source)

    def test_bfloat16_vocoder_output_has_headroom(self):
        adjusted, _ = prepare_waveform(torch.tensor([-1.8, 1.4], dtype=torch.bfloat16))
        self.assertLessEqual(adjusted.abs().max().item(), .950001)

    def service_fixture(self, root, mode):
        class Vocoder(torch.nn.Module):
            def __init__(self):
                super().__init__()
                self.conv_post = torch.nn.Identity()
                self.use_tanh_at_final = False

            def forward(self, value):
                return self.conv_post(value).clamp(-1, 1)

        class Engine:
            def __init__(self):
                self.bigvgan = Vocoder()

            def infer(self, **kwargs):
                if mode == "fail":
                    self.bigvgan(torch.tensor([float("nan")]))
                elif mode == "ok":
                    adjusted = self.bigvgan(torch.tensor([-1.8, 0.0, .8]).repeat(800))
                    pcm = (32767 * adjusted).clamp(-32767, 32767).short()
                    with wave.open(kwargs["output_path"], "wb") as audio:
                        audio.setnchannels(1)
                        audio.setsampwidth(2)
                        audio.setframerate(22050)
                        audio.writeframes(pcm.numpy().tobytes())

        reference = root / "reference.wav"
        reference.write_bytes(b"reference-path-fixture")
        service = Service(root)
        service.engine = Engine()
        return service, {"text": "声音测试", "reference": str(reference), "output": str(root / "output.wav")}

    def test_real_hook_protects_pcm_and_is_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            service, payload = self.service_fixture(root, "ok")
            result = service.synthesize(payload)
            self.assertEqual(result["audio_mastering"]["policy"], POLICY)
            self.assertEqual(len(result["audio_mastering"]["stages"]), 1)
            stage = result["audio_mastering"]["stages"][0]
            self.assertGreater(stage["sourcePeak"], 1, "应记录真实限幅前波形而不是已截断的1")
            self.assertEqual(stage["location"], "bigvgan.conv_post-before-clamp")
            with wave.open(result["output"], "rb") as audio:
                pcm = torch.frombuffer(bytearray(audio.readframes(audio.getnframes())), dtype=torch.int16)
                self.assertLess(pcm.abs().max().item(), 32767)
            self.assertEqual(len(service.engine.bigvgan.conv_post._forward_hooks), 0)
            self.assertEqual(list(root.glob("*.partial.wav")), [])

    def test_invalid_or_missing_hook_output_cannot_publish(self):
        for mode in ("fail", "no-vocoder"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                service, payload = self.service_fixture(root, mode)
                with self.assertRaises((ValueError, RuntimeError)):
                    service.synthesize(payload)
                self.assertEqual(len(service.engine.bigvgan.conv_post._forward_hooks), 0)
                self.assertFalse(Path(payload["output"]).exists())
                self.assertEqual(list(root.glob("*.partial.wav")), [])

    def test_unknown_vocoder_structure_is_rejected_before_inference(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            service, payload = self.service_fixture(root, "ok")
            service.engine.bigvgan.use_tanh_at_final = True
            with self.assertRaisesRegex(RuntimeError, "结构"):
                service.synthesize(payload)
            self.assertFalse(Path(payload["output"]).exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
