import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

sys.stdout.reconfigure(encoding='utf-8')
root = Path('evidence/validation/subtitle-reference-match')
report = {'scope': '同源视频两处解码帧的底部新增字幕，仅限实际ASS底部80、字号89对照，不代表编辑器或全部模板一致', 'region': [0, 1640, 1080, 1880], 'frames': []}

def bounds(mask):
    y, x = np.where(mask)
    return [int(x.min()), int(y.min()) + 1640, int(x.max()) + 1, int(y.max()) + 1641] if len(x) else None

panels = []
for stamp in ['0.5', '1.6']:
    images = [Image.open(root / f'{kind}-{stamp}.png').convert('RGB') for kind in ['reference', 'current', 'source']]
    arrays = [np.asarray(image.crop(tuple(report['region'])), dtype=np.int16) for image in images]
    reference, current, source = arrays
    # 源图此区域应为黑底，阈值只标记新增的亮色字形，避开源图中间已有的字幕。
    if np.max(source) > 16:
        raise RuntimeError('源图底部区域不再是黑底，不能继续使用当前字形分割规则')
    masks = [np.min(a, axis=2) > 200 for a in [reference, current]]
    union = np.logical_or(*masks).sum()
    report['frames'].append({'time': float(stamp), 'referenceBounds': bounds(masks[0]), 'currentBounds': bounds(masks[1]), 'whitePixelIoU': float(np.logical_and(*masks).sum() / union) if union else None, 'regionMAE': float(np.abs(reference - current).mean()), 'referenceDifferenceFromSource': float(np.abs(reference - source).mean()), 'currentDifferenceFromSource': float(np.abs(current - source).mean())})
    panel = Image.new('RGB', (1080, 528), '#242632')
    draw = ImageDraw.Draw(panel)
    draw.text((12, 7), f'Reference {stamp}s', fill='white')
    panel.paste(images[0].crop(tuple(report['region'])), (0, 24))
    draw.text((12, 271), f'Current {stamp}s', fill='white')
    panel.paste(images[1].crop(tuple(report['region'])), (0, 288))
    panels.append(panel)
canvas = Image.new('RGB', (1080, 1056))
for index, panel in enumerate(panels):
    canvas.paste(panel, (0, index * 528))
canvas.save(root / 'subtitle-region-comparison.png')
(root / 'frame-metrics.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
