import argparse
import ctypes
from ctypes import wintypes

# 依据本批进程与可见标题枚举窗口，不使用可能缓存为0的MainWindowHandle。
parser = argparse.ArgumentParser()
parser.add_argument('--pid', type=int, required=True)
args = parser.parse_args()
user = ctypes.windll.user32
handles = []
callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

@callback_type
def inspect(handle, parameter):
    owner = wintypes.DWORD()
    user.GetWindowThreadProcessId(handle, ctypes.byref(owner))
    if owner.value == args.pid and user.IsWindowVisible(handle):
        title = ctypes.create_unicode_buffer(256)
        user.GetWindowTextW(handle, title, len(title))
        if title.value == '超级IP智能体':
            handles.append(handle)
    return True

user.EnumWindows(inspect, 0)
if len(handles) != 1:
    raise RuntimeError('未找到唯一的源码工作台窗口：' + str(handles))
print(handles[0])
