import json
import sys
from PIL import Image, ImageChops, ImageStat

# 解码后的真视频必须接近同引擎预览，同时明显区别于没有字幕的源图。
preview, frame, source = [Image.open(name).convert('RGB') for name in sys.argv[1:4]]
region = (280, 1350, 820, 1540)
mean = lambda image: sum(ImageStat.Stat(image).mean) / 3
comparison = {
    'wholeMeanAbsoluteError': mean(ImageChops.difference(preview, frame)),
    'subtitleRegionMeanAbsoluteError': mean(ImageChops.difference(preview, frame).crop(region)),
    'subtitleDifferenceFromSource': mean(ImageChops.difference(frame, source).crop(region)),
    'region': region,
    'scope': '本项目预览与独立视频解码帧，含编码和色彩转换差异，不是原厂像素验收',
}
if comparison['subtitleRegionMeanAbsoluteError'] >= 10:
    raise RuntimeError('字幕区域未接近同样式预览，需检查真实烧录及输入配置')
if comparison['subtitleDifferenceFromSource'] <= 10:
    raise RuntimeError('字幕区域与无字幕源图过于接近，不能认定已烧录')
print(json.dumps(comparison, ensure_ascii=True))
