$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$taskPrincipal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $taskPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  @{ launchedViaExplorer = $false } | ConvertTo-Json -Compress
  exit
}

# 管理员父进程不能直接启动工作台，否则普通桌面无法向窗口拖放文件。
# 从已有 Explorer 桌面取得 ShellExecute，使用 Explorer 自己的用户令牌启动。
$taskShell = New-Object -ComObject Shell.Application
$taskDesktopHandle = 0
$taskDesktop = $taskShell.Windows().FindWindowSW([ref]0, [ref]0, 8, [ref]$taskDesktopHandle, 1)
if (-not $taskDesktop) { throw '无法取得普通权限桌面，请从桌面快捷方式启动工作台' }
$taskExecutable = $env:STUDIO_NORMAL_EXE
$taskArguments = $env:STUDIO_NORMAL_ARGS | ConvertFrom-Json
$taskDirectory = $env:STUDIO_NORMAL_CWD
if (-not [IO.Path]::IsPathRooted($taskExecutable) -or -not (Test-Path -LiteralPath $taskExecutable -PathType Leaf)) { throw '工作台启动文件无效' }
if ($taskArguments | Where-Object { $_ -match '"|[\r\n]' }) { throw '工作台启动参数包含无效字符' }
$taskCommandLine = ($taskArguments | ForEach-Object { '"' + ([string]$_).TrimEnd('\') + '"' }) -join ' '
$taskStartedAt = Get-Date
$taskDesktop.Document.Application.ShellExecute($taskExecutable, $taskCommandLine, $taskDirectory, 'open', 1)
for ($taskAttempt = 0; $taskAttempt -lt 100; $taskAttempt++) {
  $taskMatches = @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object {
    $_.CreationDate -ge $taskStartedAt.AddSeconds(-1) -and
    [string]::Equals($_.ExecutablePath, $taskExecutable, [StringComparison]::OrdinalIgnoreCase) -and
    $_.CommandLine.Contains([string]$taskArguments[0]) -and
    $_.CommandLine.Contains([string]$taskArguments[1]) -and
    -not $_.CommandLine.Contains('--type=')
  })
  if ($taskMatches.Count -eq 1) {
    @{ launchedViaExplorer = $true; pid = [int]$taskMatches[0].ProcessId; commandLine = $taskMatches[0].CommandLine } | ConvertTo-Json -Compress
    exit
  }
  if ($taskMatches.Count -gt 1) { throw '发现多个工作台启动进程，未选择其中任意一个' }
  Start-Sleep -Milliseconds 100
}
throw '普通权限工作台未在等待时间内启动'
