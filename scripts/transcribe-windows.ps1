param([Parameter(Mandatory=$true)][string]$Audio,[Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Speech
$recognizer=New-Object System.Speech.Recognition.SpeechRecognitionEngine([System.Globalization.CultureInfo]::GetCultureInfo('zh-CN'))
$records=New-Object System.Collections.Generic.List[object]
$started=Get-Date
try{
  $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $recognizer.SetInputToWaveFile((Resolve-Path -LiteralPath $Audio).Path)
  while($true){
    $result=$recognizer.Recognize()
    if($null -eq $result){break}
    $records.Add(@{start=$result.Audio.AudioPosition.TotalSeconds;duration=$result.Audio.Duration.TotalSeconds;text=$result.Text;confidence=$result.Confidence;alternates=@($result.Alternates | Select-Object -First 3 | ForEach-Object { @{text=$_.Text;confidence=$_.Confidence} })})
    @{engine='Windows System.Speech zh-CN';status='running';segments=$records.ToArray();note='自动识别结果，未经人工逐句校正，不代表完整准确转录'} | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $Output -Encoding UTF8
  }
  @{engine='Windows System.Speech zh-CN';status='completed';elapsedSeconds=((Get-Date)-$started).TotalSeconds;segments=$records.ToArray();note='自动识别结果，未经人工逐句校正，不代表完整准确转录'} | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $Output -Encoding UTF8
}finally{$recognizer.Dispose()}
Write-Output ('识别结束，片段数：'+$records.Count)
