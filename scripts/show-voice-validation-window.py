"""只恢复并定位已验证的源码窗口，供系统截图读取，不操作原软件。"""
import argparse
import ctypes
from ctypes import wintypes
import json
parser=argparse.ArgumentParser()
parser.add_argument('--handle',type=int,required=True)
args=parser.parse_args()
user=ctypes.windll.user32
user.SetProcessDPIAware()
if not user.IsWindow(args.handle):
    raise RuntimeError('源码窗口不存在')
owner=wintypes.DWORD()
user.GetWindowThreadProcessId(args.handle,ctypes.byref(owner))
if owner.value!=13984:
    raise RuntimeError('窗口不属于本批已核实的源码进程')
was_iconic=bool(user.IsIconic(args.handle))
user.ShowWindow(args.handle,9)
user.SetForegroundWindow(args.handle)
rect=wintypes.RECT()
user.GetWindowRect(args.handle,ctypes.byref(rect))
width,height=rect.right-rect.left,rect.bottom-rect.top
user.MoveWindow(args.handle,0,0,width,height,True)
print(json.dumps({'handle':args.handle,'pid':owner.value,'wasMinimized':was_iconic,'rect':[0,0,width,height]}))
