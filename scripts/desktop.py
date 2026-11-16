import argparse
import ctypes
import json
import time
from pathlib import Path
from ctypes import wintypes
from PIL import ImageGrab

# 所有点击使用参考窗口内的相对坐标，操作后保存截图作为依据。
parser = argparse.ArgumentParser()
parser.add_argument('--handle', type=int, default=198910)
parser.add_argument('--click', nargs=2, type=int)
parser.add_argument('--double-click', nargs=2, type=int)
parser.add_argument('--hover', nargs=2, type=int)
parser.add_argument('--scroll', type=int)
parser.add_argument('--key', nargs='*', type=int)
parser.add_argument('--owned-dialog', action='store_true')
parser.add_argument('--output', required=True)
args = parser.parse_args()
user = ctypes.windll.user32
user.SetProcessDPIAware()
# 原生文件选择器打开时聚焦其自身，避免父窗口抢焦点导致点击落到页面。
if not args.owned_dialog:
    user.ShowWindowAsync(args.handle, 9)
    user.SetForegroundWindow(args.handle)
# 对话框模式保留当前前台，避免还原父窗口时原生选择器被取消。
time.sleep(0.25)
rect = wintypes.RECT()
user.GetWindowRect(args.handle, ctypes.byref(rect))
if args.click:
    user.SetCursorPos(rect.left + args.click[0], rect.top + args.click[1])
    user.mouse_event(2, 0, 0, 0, 0)
    user.mouse_event(4, 0, 0, 0, 0)
if args.double_click:
    # 连续双击用于真实进入画布文字编辑，避免把两张选中截图误认为编辑成功。
    user.SetCursorPos(rect.left + args.double_click[0], rect.top + args.double_click[1])
    for index in range(2):
        user.mouse_event(2, 0, 0, 0, 0)
        user.mouse_event(4, 0, 0, 0, 0)
        if index == 0:
            time.sleep(0.08)
if args.hover:
    user.SetCursorPos(rect.left + args.hover[0], rect.top + args.hover[1])
if args.scroll:
    # 只对当前鼠标所在的可见面板滚动，实际结果由截图核对。
    user.mouse_event(0x0800, 0, 0, args.scroll, 0)
if args.key:
    for key in args.key:
        user.keybd_event(key, 0, 0, 0)
    for key in reversed(args.key):
        user.keybd_event(key, 0, 2, 0)
time.sleep(0.65)
destination = Path(args.output)
destination.parent.mkdir(parents=True, exist_ok=True)
ImageGrab.grab(bbox=(rect.left, rect.top, rect.right, rect.bottom), all_screens=True).save(destination)
print(json.dumps({'file': str(destination.resolve()), 'rect': [rect.left, rect.top, rect.right, rect.bottom]}))
