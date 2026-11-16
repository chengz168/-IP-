from pathlib import Path
from PIL import Image, ImageDraw

# 原软件与源码窗口均为1400×1000，只裁取同坐标区域，不拉伸界面。
base = Path(__file__).resolve().parent.parent
out = base / 'evidence/validation/typography'
rows = []
for preset in ['compact', 'standard', 'comfortable', 'large']:
    reference = base / 'evidence/reference' / ('font-comfortable-restored.png' if preset == 'comfortable' else f'font-{preset}.png')
    current = base / f'evidence/validation/layout-font-{preset}-1400x1000-final/28-settings-general.png'
    canvas = Image.new('RGB', (1800, 470), '#ffffff')
    draw = ImageDraw.Draw(canvas)
    draw.text((12, 6), f'{preset} / reference', fill='#111111')
    draw.text((912, 6), f'{preset} / implementation', fill='#111111')
    for x, image_path in [(0, reference), (900, current)]:
        with Image.open(image_path) as source:
            assert source.size == (1400, 1000), (image_path, source.size)
            canvas.paste(source.crop((15, 75, 1150, 625)).resize((900, 436)), (x, 30))
    rows.append(canvas)
result = Image.new('RGB', (1800, len(rows) * 470), '#ffffff')
for index, row in enumerate(rows):
    result.paste(row, (0, index * 470))
result.save(out / 'four-presets-comparison.jpg', quality=93)
print(str(out / 'four-presets-comparison.jpg'))
