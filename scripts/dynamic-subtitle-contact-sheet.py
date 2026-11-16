from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json

# 将真实解码帧排列，保留模板名称，供逐图人工检查，不以拼图生成代替效果验收。
root = Path('evidence/validation/dynamic-subtitles/media')
templates = json.loads(Path('evidence/reference/dynamic-subtitles/catalog.json').read_text(encoding='utf-8'))['templates']
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 19)
sheet = Image.new('RGB', (1320, 6 * 245), '#171923')
draw = ImageDraw.Draw(sheet)
for index, template in enumerate(templates):
    x, y = (index % 4) * 330, (index // 4) * 245
    draw.text((x + 8, y + 6), template['name'], font=font, fill='white')
    for frame, timestamp in enumerate(['0.08', '0.6', '1.45']):
        image = Image.open(root / (template['id'] + '-' + timestamp + '.png'))
        image = image.crop((0, 520, 540, 960)).resize((106, 86))
        sheet.paste(image, (x + frame * 110 + 2, y + 36))
sheet.save(root / 'contact-sheet.png')
print(str((root / 'contact-sheet.png').resolve()))
