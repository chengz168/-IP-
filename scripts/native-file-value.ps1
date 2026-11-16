param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
# 只操作当前原生文件框的文件名字段，避免改剪贴板或受中文输入法影响。
$taskFileInput=[System.Windows.Automation.AutomationElement]::FocusedElement
if($taskFileInput.Current.AutomationId -ne '1148' -or $taskFileInput.Current.ClassName -ne 'Edit'){throw '请先将焦点移到原生文件框的文件名输入栏'}
$taskFileValue=$null
if(-not $taskFileInput.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$taskFileValue)){throw '文件名输入框不支持直接填写'}
$taskFileValue.SetValue($Path)
if($taskFileValue.Current.Value -ne $Path){throw '文件路径没有完整写入'}
Write-Output '文件名字段已完整填写，请核对界面后再提交'
