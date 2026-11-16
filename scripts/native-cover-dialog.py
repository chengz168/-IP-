import argparse
import ctypes
import json
import time
from pathlib import Path
from ctypes import wintypes

# 原生保存框的文件栏在本机未暴露 UIA ValuePattern，使用其真实 Edit 窗口。
parser = argparse.ArgumentParser()
parser.add_argument('--pid', type=int, required=True)
parser.add_argument('--path', required=True)
parser.add_argument('--cancel', action='store_true')
parser.add_argument('--title', choices=('导出封面图片', '导出封面视频', '导出视频'))
args = parser.parse_args()
user = ctypes.WinDLL('user32', use_last_error=True)
callback = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
user.GetDlgItem.restype = wintypes.HWND
user.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user.SendMessageW.restype = wintypes.LPARAM


def text(hwnd):
    value = ctypes.create_unicode_buffer(1024)
    user.SendMessageW(hwnd, 0x000D, len(value), ctypes.cast(value, ctypes.c_void_p).value)
    return value.value


def class_name(hwnd):
    value = ctypes.create_unicode_buffer(256)
    user.GetClassNameW(hwnd, value, len(value))
    return value.value


def windows(parent=None):
    result = []
    @callback
    def collect(hwnd, _):
        result.append(hwnd)
        return True
    if parent:
        user.EnumChildWindows(parent, collect, 0)
    else:
        user.EnumWindows(collect, 0)
    return result


dialog = None
for _ in range(40):
    candidates = []
    for hwnd in windows():
        process_id = wintypes.DWORD()
        user.GetWindowThreadProcessId(hwnd, ctypes.byref(process_id))
        titles = (args.title,) if args.title else ('导出封面图片', '导出封面视频')
        if process_id.value == args.pid and user.IsWindowVisible(hwnd) and class_name(hwnd) == '#32770' and text(hwnd) in titles:
            candidates.append(hwnd)
    if candidates:
        foreground = user.GetForegroundWindow()
        dialog = foreground if foreground in candidates else candidates[0]
        break
    time.sleep(0.15)
if not dialog:
    raise RuntimeError('没有找到指定源码实例的保存框')

if args.cancel:
    button = user.GetDlgItem(dialog, 2)
else:
    destination = Path(args.path).resolve()
    allowed = (Path.cwd() / 'evidence/validation/cover-editor').resolve()
    if allowed not in destination.parents or destination.exists():
        raise RuntimeError('验收文件必须位于本批目录且不能覆盖已有文件')
    edits = [hwnd for hwnd in windows(dialog) if class_name(hwnd) == 'Edit' and user.GetDlgCtrlID(hwnd) in (1001, 1148)]
    if len(edits) != 1:
        raise RuntimeError('不能唯一定位保存框文件名 Edit')
    value = ctypes.create_unicode_buffer(str(destination))
    user.SendMessageW(edits[0], 0x000C, 0, ctypes.cast(value, ctypes.c_void_p).value)
    if text(edits[0]) != str(destination):
        raise RuntimeError('原生文件名写入后读回不一致')
    button = user.GetDlgItem(dialog, 1)
if not button:
    raise RuntimeError('原生保存框缺少提交按钮')
user.PostMessageW(button, 0x00F5, 0, 0)
for _ in range(60):
    if not user.IsWindow(dialog):
        break
    time.sleep(0.1)
else:
    raise RuntimeError('原生保存框提交后未关闭')
if not args.cancel:
    for _ in range(40):
        if destination.exists() and destination.stat().st_size:
            break
        time.sleep(0.1)
    else:
        raise RuntimeError('保存框关闭后没有实际输出文件')
print(json.dumps({'dialog': dialog, 'canceled': args.cancel, 'path': None if args.cancel else str(destination)}, ensure_ascii=False))
