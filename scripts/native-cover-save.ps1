param([Parameter(Mandatory=$true)][int]$TargetPid,[Parameter(Mandatory=$true)][string]$Path,[switch]$Cancel)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$taskDialog=$null
# 只操作指定源码实例的原生保存框，文件名限定到本批独立证据目录。
for($taskTry=0;$taskTry -lt 30;$taskTry++){
  $taskFocused=[System.Windows.Automation.AutomationElement]::FocusedElement
  if($taskFocused.Current.ProcessId -eq $TargetPid){$taskParent=$taskFocused;for($taskDepth=0;$taskDepth -lt 12 -and $taskParent;$taskDepth++){if($taskParent.Current.ClassName -eq '#32770'){$taskDialog=$taskParent;break};$taskParent=[System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($taskParent)}}
  if($taskDialog){break}
  Start-Sleep -Milliseconds 200
}
if(-not $taskDialog){throw '没有找到指定源码窗口的保存对话框'}
if($Cancel){$taskButton=$taskDialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'2')))}else{
  $taskResolved=[System.IO.Path]::GetFullPath($Path)
  $taskEvidence=[System.IO.Path]::GetFullPath((Join-Path (Get-Location) 'evidence\validation\cover-editor'))+[System.IO.Path]::DirectorySeparatorChar
  if(-not $taskResolved.StartsWith($taskEvidence,[System.StringComparison]::OrdinalIgnoreCase)){throw '验收导出路径不在独立证据目录'}
  if(Test-Path -LiteralPath $taskResolved){throw '验收文件已存在，不能覆盖'}
  $taskEdit=$taskDialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'1148')))
  if(-not $taskEdit){$taskEdit=$taskDialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'1001')))}
  if(-not $taskEdit){throw '保存框未找到文件名输入栏'}
  $taskValue=$taskEdit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  $taskValue.SetValue($taskResolved)
  $taskButton=$taskDialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'1')))
}
if(-not $taskButton){throw '保存框未找到提交按钮'}
$taskInvoke=$taskButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
$taskInvoke.Invoke()
Write-Output $(if($Cancel){'已取消本次原生文件导出'}else{'已通过原生保存框提交本次导出'})
