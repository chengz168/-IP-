from PIL import Image, ImageDraw
from pathlib import Path

root = Path(__file__).resolve().parent.parent
groups = [
    [('extract', 'learning-recheck.png', '01-extract.png'), ('rewrite', 'rewrite-functional.png', '05-rewrite.png'), ('voice', 'voice-functional.png', '06-voice.png'), ('video', 'video-functional.png', '07-video.png')],
    [('edit', 'editing-functional.png', '09-edit-params.png'), ('cover', 'cover-functional.png', '17-cover.png'), ('publish', 'publish-functional.png', '21-publish.png'), ('legacy', 'old-workflow.png', '22-legacy.png')],
    [('voices', 'voice-management-functional.png', '23-voices.png'), ('avatars', 'avatar-management-functional.png', '24-avatars.png'), ('assets', 'asset-management-functional.png', '25-assets.png'), ('settings', 'settings-functional.png', '28-settings-general.png')],
]
for index, group in enumerate(groups):
    sheet = Image.new('RGB', (1600, 620), '#11131d')
    draw = ImageDraw.Draw(sheet)
    for col, (label, reference, current) in enumerate(group):
        for row, (kind, file) in enumerate([('REFERENCE', root/'evidence/reference'/reference), ('CURRENT', root/'evidence/validation/layout-1400x1000'/current)]):
            image = Image.open(file).convert('RGB')
            image.thumbnail((400, 286))
            sheet.paste(image, (col*400, row*310+22))
            draw.text((col*400+7, row*310+5), kind+' '+label, fill='white')
    destination = root/'evidence/validation'/('layout-contact-'+str(index+1)+'.jpg')
    sheet.save(destination, quality=94)
    print(destination)
