from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import sys

# 对照只用于人工审查，不用整屏像素误差冒充功能或视觉验收。
root = Path(__file__).resolve().parents[1]
reference = root / 'evidence/reference'
current = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'evidence/validation/layout-style2-delivery-1400x1000'
output = Path(sys.argv[2]) if len(sys.argv) > 2 else root / 'evidence/validation/style-comparisons'
output.mkdir(parents=True, exist_ok=True)
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 18)
pairs = [
    ('提取', 'learning-recheck.png', '01-extract.png'),
    ('IP大脑', 'brain-tab-recheck.png', '02-brain.png'),
    ('选题', 'topics-functional-open.png', '03-topic.png'),
    ('营销', 'marketing-functional-open.png', '04-marketing.png'),
    ('改写', 'rewrite-functional.png', '05-rewrite.png'),
    ('声音', 'voice-functional.png', '06-voice.png'),
    ('视频', 'video-functional.png', '07-video.png'),
    ('剪辑', 'editing-functional.png', '09-edit-params.png'),
    ('封面', 'cover-functional.png', '17-cover.png'),
    ('声音管理', 'voice-management-functional.png', '23-voices.png'),
    ('形象管理', 'avatar-management-functional.png', '24-avatars.png'),
    ('素材管理', 'asset-management-functional.png', '25-assets.png'),
    ('账号管理', 'account-management-functional.png', '26-accounts.png'),
    ('任务中心', 'task-center-functional.png', '27-tasks.png'),
    ('设置', 'settings-verified.png', '28-settings-general.png'),
]
for offset in range(0, len(pairs), 3):
    sheet = Image.new('RGB', (1400, 1590), '#151721')
    draw = ImageDraw.Draw(sheet)
    for row, (name, source, actual) in enumerate(pairs[offset:offset+3]):
        y = row * 530
        draw.text((12, y+3), f'{name}：原软件', font=font, fill='white')
        draw.text((712, y+3), '当前实现（任务内容可能不同）', font=font, fill='white')
        for column, file in enumerate([reference/source, current/actual]):
            image = Image.open(file).convert('RGB')
            image.thumbnail((700, 500), Image.Resampling.LANCZOS)
            sheet.paste(image, (column*700, y+30))
    file = output / f'pages-{offset+1:02d}-{min(offset+3, len(pairs)):02d}.jpg'
    sheet.save(file, quality=92)
    print(file)
