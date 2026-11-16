import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

# 对比同源解码帧中新增字幕所在区域，避开源视频本身已经烧录的文字。
root = Path('evidence/validation/subtitle-editor-parity')
region = (0, 455, 360, 555)
frames = []
tiles = []
for stamp in ['0.2', '1', '4', '7.8']:
    source = Image.open(root / ('source-' + stamp + '.png')).convert('RGB')
    result = Image.open(root / ('result-' + stamp + '.png')).convert('RGB')
    a = np.asarray(source.crop(region), dtype=np.int16)
    b = np.asarray(result.crop(region), dtype=np.int16)
    diff = np.max(np.abs(a - b), axis=2)
    mask = (np.min(b, axis=2) > 180) & (diff > 45)
    y, x = np.where(mask)
    bounds = [int(x.min()), int(y.min()) + region[1], int(x.max()) + 1, int(y.max()) + region[1] + 1] if len(x) else None
    frames.append({'time': float(stamp), 'newWhiteBounds': bounds, 'regionMAE': float(np.abs(a - b).mean()), 'newWhitePixels': int(mask.sum())})
    tile = Image.new('RGB', (720, 668), '#242632')
    ImageDraw.Draw(tile).text((12, 6), 'Source / Actual output ' + stamp + 's', fill='white')
    tile.paste(source, (0, 28))
    tile.paste(result, (360, 28))
    tiles.append(tile)
assert frames[0]['newWhitePixels'] < 10, '字幕开始前不应出现新增白字'
assert frames[-1]['newWhitePixels'] < 10, '字幕结束后不应残留新增白字'
for row in frames[1:3]:
    assert row['newWhitePixels'] > 80, '有效字幕区间必须出现新增字形'
    assert 475 <= row['newWhiteBounds'][1] <= 515, '新增字幕不在预期坐标附近'
canvas = Image.new('RGB', (1440, 1336), '#242632')
for i, tile in enumerate(tiles):
    canvas.paste(tile, ((i % 2) * 720, (i // 2) * 668))
canvas.save(root / 'actual-subtitle-frames.png')
report = {'scope': '本地新版ASS实际字形、位置和出现区间；不代表原厂ASS一致或音画质量通过', 'region': region, 'frames': frames, 'passed': True}
(root / 'frame-metrics.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
