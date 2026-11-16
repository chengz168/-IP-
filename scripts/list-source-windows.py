import argparse
import ctypes
import json
from ctypes import wintypes

# 只读列出指定源码进程的顶层窗口，用标题和客户区尺寸确认主窗口。
parser = argparse.ArgumentParser()
parser.add_argument('--pid', type=int, required=True)
args = parser.parse_args()
user = ctypes.windll.user32
user.SetProcessDPIAware()
result = []

@ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
def inspect(hwnd, param):
    pid = wintypes.DWORD()
    user.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    if pid.value == args.pid:
        title = ctypes.create_unicode_buffer(512)
        user.GetWindowTextW(hwnd, title, len(title))
        rect = wintypes.RECT()
        client = wintypes.RECT()
        user.GetWindowRect(hwnd, ctypes.byref(rect))
        user.GetClientRect(hwnd, ctypes.byref(client))
        result.append({'handle': hwnd, 'visible': bool(user.IsWindowVisible(hwnd)), 'title': title.value, 'rect': [rect.left, rect.top, rect.right, rect.bottom], 'client': [client.right, client.bottom]})
    return True

user.EnumWindows(inspect, 0)
print(json.dumps(result, ensure_ascii=False))
