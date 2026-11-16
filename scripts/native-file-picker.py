import argparse
import ctypes
import json
import time
from pathlib import Path
from ctypes import wintypes

# 只操作指定源码进程所属的原生文件对话框，不向当前前台应用发送快捷键。
parser = argparse.ArgumentParser()
parser.add_argument('--pid', type=int, required=True)
parser.add_argument('--file')
parser.add_argument('--cancel', action='store_true')
args = parser.parse_args()
user = ctypes.windll.user32
user.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user.SendMessageW.restype = wintypes.LPARAM
callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
dialogs = []

@callback_type
def scan(handle, parameter):
    pid = wintypes.DWORD()
    user.GetWindowThreadProcessId(handle, ctypes.byref(pid))
    name = ctypes.create_unicode_buffer(128)
    user.GetClassNameW(handle, name, len(name))
    if pid.value == args.pid and user.IsWindowVisible(handle) and name.value == '#32770':
        dialogs.append(handle)
    return True

user.EnumWindows(scan, 0)
if len(dialogs) != 1:
    raise RuntimeError('未找到唯一的本进程文件对话框：' + str(dialogs))
dialog = dialogs[0]
if args.cancel:
    button = user.GetDlgItem(dialog, 2)
    user.PostMessageW(button, 0x00F5, 0, 0)
else:
    source = Path(args.file).resolve(strict=True)
    edits = []

    @callback_type
    def child(handle, parameter):
        name = ctypes.create_unicode_buffer(128)
        user.GetClassNameW(handle, name, len(name))
        if name.value == 'Edit' and user.GetDlgCtrlID(handle) == 1148:
            edits.append(handle)
        return True

    user.EnumChildWindows(dialog, child, 0)
    if len(edits) != 1:
        raise RuntimeError('未找到唯一的文件名输入框：' + str(edits))
    text = ctypes.create_unicode_buffer(str(source))
    user.SendMessageW(edits[0], 0x000C, 0, ctypes.addressof(text))
    button = user.GetDlgItem(dialog, 1)
    if not button:
        raise RuntimeError('没有找到原生打开按钮')
    user.PostMessageW(button, 0x00F5, 0, 0)
time.sleep(.5)
print(json.dumps({'pid': args.pid, 'dialog': dialog, 'action': 'cancel' if args.cancel else 'select-file', 'closed': not bool(user.IsWindow(dialog))}))
