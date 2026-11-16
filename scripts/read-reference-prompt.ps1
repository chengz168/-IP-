param([int]$TargetPid=12548,[int]$RelativeX=550,[int]$RelativeY=455,[Parameter(Mandatory=$true)][string]$OutputPath)

# 只复制已经打开的提示词文本，不键入内容、不保存原软件；结束后恢复剪贴板。
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class PromptWindow {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[PromptWindow]::SetProcessDPIAware() | Out-Null
$promptHandle=(Get-Process -Id $TargetPid -ErrorAction Stop).MainWindowHandle
$previous=[System.Windows.Forms.Clipboard]::GetDataObject()
$snapshot=New-Object System.Windows.Forms.DataObject
if($previous){foreach($format in $previous.GetFormats($false)){try{$snapshot.SetData($format,$false,$previous.GetData($format,$false))}catch{}}}
try {
 [PromptWindow]::SetForegroundWindow($promptHandle) | Out-Null
 Start-Sleep -Milliseconds 250
 if([PromptWindow]::GetForegroundWindow() -ne $promptHandle){throw 'Reference window is not in foreground'}
 $promptRect=New-Object PromptWindow+Rect
 [PromptWindow]::GetWindowRect($promptHandle,[ref]$promptRect) | Out-Null
 [PromptWindow]::SetCursorPos($promptRect.Left+$RelativeX,$promptRect.Top+$RelativeY) | Out-Null
 [PromptWindow]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
 [PromptWindow]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
 [System.Windows.Forms.SendKeys]::SendWait('^a')
 [System.Windows.Forms.SendKeys]::SendWait('^c')
 Start-Sleep -Milliseconds 350
 $promptText=[System.Windows.Forms.Clipboard]::GetText()
 if([string]::IsNullOrWhiteSpace($promptText)){throw 'No text was copied'}
 [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($OutputPath),$promptText,(New-Object System.Text.UTF8Encoding($false)))
 Write-Output ('copied characters: '+$promptText.Length)
} finally {
 if($previous){[System.Windows.Forms.Clipboard]::SetDataObject($snapshot,$true)}else{[System.Windows.Forms.Clipboard]::Clear()}
}
