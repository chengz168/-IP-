param(
  [int]$TargetPid = 12548,
  [ValidateSet('Focus','Tree','Click','Keys','Capture','ReadPage')][string]$Action = 'Tree',
  [int]$X = 0,
  [int]$Y = 0,
  [string]$Keys = '',
  [string]$OutputPath = ''
)

# 通过系统公开的窗口和辅助功能接口观察参考软件，避免修改安装目录。
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class ObserveWindow {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h,int x,int y,int w,int z,bool r);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[ObserveWindow]::SetProcessDPIAware() | Out-Null
$taskProcess = Get-Process -Id $TargetPid -ErrorAction Stop
$taskHandle = $taskProcess.MainWindowHandle
Write-Output ('观察窗口 PID=' + $TargetPid + ' HWND=' + $taskHandle + ' 操作=' + $Action)
if ($Action -eq 'Focus') {
  [ObserveWindow]::ShowWindowAsync($taskHandle,9) | Out-Null
  [ObserveWindow]::SetForegroundWindow($taskHandle) | Out-Null
  Start-Sleep -Milliseconds 500
}
if ($Action -eq 'Click') {
  [ObserveWindow]::SetForegroundWindow($taskHandle) | Out-Null
  [ObserveWindow]::SetCursorPos($X,$Y) | Out-Null
  [ObserveWindow]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  [ObserveWindow]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 350
}
if ($Action -eq 'Keys' -or $Action -eq 'ReadPage') {
  [ObserveWindow]::SetForegroundWindow($taskHandle) | Out-Null
  Start-Sleep -Milliseconds 200
  if ($Action -eq 'ReadPage') {
    [System.Windows.Forms.SendKeys]::SendWait('^a')
    [System.Windows.Forms.SendKeys]::SendWait('^c')
    Start-Sleep -Milliseconds 300
    [System.IO.File]::WriteAllText($OutputPath,[System.Windows.Forms.Clipboard]::GetText(),[System.Text.Encoding]::UTF8)
    Write-Output $OutputPath
  } else {
    [System.Windows.Forms.SendKeys]::SendWait($Keys)
    Start-Sleep -Milliseconds 400
  }
}
if ($Action -eq 'Tree') {
  $taskRoot = [System.Windows.Automation.AutomationElement]::FromHandle($taskHandle)
  $taskElements = $taskRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
  $taskRows = for($taskIndex=0;$taskIndex -lt [Math]::Min($taskElements.Count,3000);$taskIndex++) {
    $taskElement=$taskElements.Item($taskIndex)
    [pscustomobject]@{type=$taskElement.Current.ControlType.ProgrammaticName;name=$taskElement.Current.Name;rect=$taskElement.Current.BoundingRectangle.ToString()}
  }
  $taskJson=ConvertTo-Json -InputObject @($taskRows) -Depth 3
  if($OutputPath){[System.IO.File]::WriteAllText($OutputPath,$taskJson,[System.Text.Encoding]::UTF8);Write-Output $OutputPath}else{$taskJson}
}
if ($Action -eq 'Capture') {
  & 'C:\Users\DELL\.codex\skills\screenshot\scripts\take_screenshot.ps1' -Mode temp -WindowHandle $taskHandle
}
