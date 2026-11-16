"""在声码器浮点输出量化前保留幅度余量。"""
import math

POLICY = "vocoder-before-limit-peak-0.95-v2"


def prepare_waveform(waveform):
    if not waveform.is_floating_point() or not waveform.numel():
        raise ValueError("声码器必须返回非空浮点音频")
    peak = float(waveform.detach().abs().max().item())
    if not math.isfinite(peak):
        raise ValueError("声码器返回无效采样值，未保存音频")
    gain = 0.95 / peak if peak > 0.95 else 1.0
    # 半精度乘法会将0.95向上舍入，缩放时使用单精度保留目标余量。
    return waveform.float() * gain if gain < 1.0 else waveform, {"sourcePeak": peak, "gain": gain, "targetPeak": 0.95}
