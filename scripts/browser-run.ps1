param([Parameter(Mandatory=$true)][string]$Script,[string]$Session='ip-app')
$taskScript = Get-Content -LiteralPath $Script -Raw -Encoding UTF8
$taskCode = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($taskScript))
$taskWrapper = "async page => { const code = Buffer.from('$taskCode','base64').toString('utf8'); await (eval(code))(page); }"
& npx --yes --package '@playwright/cli' playwright-cli "-s=$Session" run-code $taskWrapper
exit $LASTEXITCODE
