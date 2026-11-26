param(
    [ValidateSet('start', 'status')][string]$Action = 'start',
    [ValidateRange(1024, 65535)][int]$Port = 9391,
    [string]$ProfileDirectory = ''
)

$ErrorActionPreference = 'Stop'
if (-not $ProfileDirectory) { $ProfileDirectory = Join-Path $env:USERPROFILE '.codex\browser-profiles\github-research' }
$taskProfile = [IO.Path]::GetFullPath($ProfileDirectory)
$taskEndpoint = "http://127.0.0.1:$Port"
$taskChrome = Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'
if (-not (Test-Path -LiteralPath $taskChrome)) { throw '未找到本机 Google Chrome。' }

function Get-ResearchChrome {
    $taskListeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    if ($taskListeners.Count -eq 0) { return $null }
    if (@($taskListeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') }).Count -gt 0) {
        throw '调研端口存在非回环监听，停止连接。'
    }
    $taskOwner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $taskListeners[0].OwningProcess)
    if (-not $taskOwner -or -not [string]::Equals($taskOwner.ExecutablePath, $taskChrome, [System.StringComparison]::OrdinalIgnoreCase) -or $taskOwner.CommandLine.IndexOf($taskProfile, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw '端口已被其他进程占用，未连接其他会话。'
    }
    $taskVersion = Invoke-RestMethod -Uri "$taskEndpoint/json/version" -TimeoutSec 3
    if ($taskVersion.Browser -notmatch '^Chrome/') { throw '调研端口并非 Google Chrome。' }
    return @{ pid = $taskOwner.ProcessId; browser = $taskVersion.Browser; endpoint = $taskEndpoint; profile = $taskProfile; loopbackOnly = $true }
}

$taskSession = Get-ResearchChrome
if (-not $taskSession -and $Action -eq 'start') {
    # 单独配置目录避免改动用户日常浏览器；调研连接仅在本机开放。
    New-Item -ItemType Directory -Path $taskProfile -Force | Out-Null
    $taskArguments = @(
        ('--user-data-dir="' + $taskProfile + '"'),
        '--remote-debugging-address=127.0.0.1',
        ('--remote-debugging-port=' + $Port),
        '--no-first-run', '--no-default-browser-check',
        'https://github.com'
    )
    Start-Process -FilePath $taskChrome -ArgumentList $taskArguments -WindowStyle Hidden | Out-Null
    for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
        Start-Sleep -Milliseconds 300
        $taskSession = Get-ResearchChrome
        if ($taskSession) { break }
    }
    if (-not $taskSession) { throw 'Chrome 调研窗口未在限定时间内就绪。' }
}

@{ connected = [bool]$taskSession; session = $taskSession } | ConvertTo-Json -Depth 4
