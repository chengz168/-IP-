import argparse
import ctypes
import time
from ctypes import wintypes

# 通过系统Unicode键盘事件输入，避免占用或改写用户剪贴板。
parser = argparse.ArgumentParser()
parser.add_argument('--handle', type=int, required=True)
parser.add_argument('--text', required=True)
args = parser.parse_args()
user = ctypes.windll.user32

class Keyboard(ctypes.Structure):
    _fields_ = [('vk', wintypes.WORD), ('scan', wintypes.WORD), ('flags', wintypes.DWORD), ('time', wintypes.DWORD), ('extra', ctypes.c_size_t)]

class Mouse(ctypes.Structure):
    _fields_ = [('x', wintypes.LONG), ('y', wintypes.LONG), ('data', wintypes.DWORD), ('flags', wintypes.DWORD), ('time', wintypes.DWORD), ('extra', ctypes.c_size_t)]

class Payload(ctypes.Union):
    _fields_ = [('keyboard', Keyboard), ('mouse', Mouse)]

class Input(ctypes.Structure):
    _fields_ = [('kind', wintypes.DWORD), ('payload', Payload)]

if not user.IsWindow(args.handle):
    raise RuntimeError('目标窗口不存在')
user.SetForegroundWindow(args.handle)
time.sleep(0.2)
if user.GetForegroundWindow() != args.handle:
    raise RuntimeError('目标窗口未获得前台，取消输入')
encoded = args.text.encode('utf-16-le')
for index in range(0, len(encoded), 2):
    code = int.from_bytes(encoded[index:index + 2], 'little')
    events = (Input * 2)(Input(1, Payload(keyboard=Keyboard(0, code, 4, 0, 0))), Input(1, Payload(keyboard=Keyboard(0, code, 6, 0, 0))))
    if user.SendInput(2, events, ctypes.sizeof(Input)) != 2:
        raise RuntimeError('系统文本输入未完整提交')
print('已提交Unicode键盘事件：' + str(len(args.text)) + '个字符')
