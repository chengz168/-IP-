import argparse,ctypes,json,time
from pathlib import Path
from ctypes import wintypes
# 仅提交指定源码进程的原生打开框，读取本批已有样本文件。
a=argparse.ArgumentParser();a.add_argument('--pid',type=int,required=True);a.add_argument('--path',required=True);args=a.parse_args()
p=Path(args.path).resolve();root=(Path.cwd()/'evidence/validation/brain-study').resolve()
if root not in p.parents or not p.is_file():raise RuntimeError('只能导入本批已有验收文件')
u=ctypes.WinDLL('user32',use_last_error=True);cb=ctypes.WINFUNCTYPE(wintypes.BOOL,wintypes.HWND,wintypes.LPARAM)
u.SendMessageW.argtypes=[wintypes.HWND,wintypes.UINT,wintypes.WPARAM,wintypes.LPARAM];u.SendMessageW.restype=wintypes.LPARAM;u.GetDlgItem.restype=wintypes.HWND

def txt(h):
 s=ctypes.create_unicode_buffer(1024);u.SendMessageW(h,13,len(s),ctypes.cast(s,ctypes.c_void_p).value);return s.value

def cls(h):
 s=ctypes.create_unicode_buffer(256);u.GetClassNameW(h,s,len(s));return s.value

def windows(parent=None):
 result=[]
 @cb
 def fn(h,l):result.append(h);return True
 if parent:u.EnumChildWindows(parent,fn,0)
 else:u.EnumWindows(fn,0)
 return result

dialog=None
for i in range(40):
 for h in windows():
  pid=wintypes.DWORD();u.GetWindowThreadProcessId(h,ctypes.byref(pid))
  if pid.value==args.pid and u.IsWindowVisible(h) and cls(h)=='#32770' and txt(h) in ('打开','Open'):dialog=h;break
 if dialog:break
 time.sleep(.15)
if not dialog:raise RuntimeError('未发现指定源码进程的打开框')
edits=[h for h in windows(dialog) if cls(h)=='Edit' and u.GetDlgCtrlID(h) in (1001,1148)]
if len(edits)!=1:raise RuntimeError('不能唯一定位打开框文件名')
v=ctypes.create_unicode_buffer(str(p));u.SendMessageW(edits[0],12,0,ctypes.cast(v,ctypes.c_void_p).value)
if txt(edits[0])!=str(p):raise RuntimeError('文件名读回不一致')
u.PostMessageW(u.GetDlgItem(dialog,1),0xF5,0,0)
for i in range(60):
 if not u.IsWindow(dialog):break
 time.sleep(.1)
else:raise RuntimeError('原生打开框未关闭')
print(json.dumps({'path':str(p),'pid':args.pid,'submitted':True},ensure_ascii=False))
