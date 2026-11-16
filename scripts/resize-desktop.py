import argparse
import ctypes
from ctypes import wintypes
import json

# 仅调整显式指定的源码验收窗口，不改变其他软件窗口或系统显示设置。
parser = argparse.ArgumentParser()
parser.add_argument('--handle', type=int, required=True)
parser.add_argument('--width', type=int, required=True)
parser.add_argument('--height', type=int, required=True)
args = parser.parse_args()
user = ctypes.windll.user32
user.SetProcessDPIAware()
if not user.IsWindow(args.handle):
    raise RuntimeError('指定窗口不存在')
rect = wintypes.RECT()
user.GetWindowRect(args.handle, ctypes.byref(rect))
if not user.MoveWindow(args.handle, rect.left, rect.top, args.width, args.height, True):
    raise RuntimeError('调整验收窗口失败')
user.GetWindowRect(args.handle, ctypes.byref(rect))
print(json.dumps({'handle': args.handle, 'rect': [rect.left, rect.top, rect.right, rect.bottom]}))
