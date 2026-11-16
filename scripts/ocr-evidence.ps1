param([Parameter(Mandatory=$true)][string]$Directory,[string]$Output,[switch]$Recurse)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null=[Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrResult,Windows.Foundation,ContentType=WindowsRuntime]
$awaitMethod=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await-WinRT($Operation,[Type]$ResultType){$task=$awaitMethod.MakeGenericMethod($ResultType).Invoke($null,@($Operation));$task.Wait();return $task.Result}
$engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if(-not $engine){throw '本机未提供可用OCR语言'}
$records=New-Object System.Collections.Generic.List[object]
$files=Get-ChildItem -LiteralPath $Directory -Filter '*.png' -File -Recurse:$Recurse | Sort-Object FullName
foreach($file in $files){
  $storageFile=Await-WinRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync($file.FullName)) ([Windows.Storage.StorageFile])
  $stream=Await-WinRT ($storageFile.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  try{
    $decoder=Await-WinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap=Await-WinRT ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    try{$result=Await-WinRT ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult]);$lines=@($result.Lines | ForEach-Object { $_.Text });$records.Add(@{file=$file.FullName;lines=$lines;text=$result.Text})}finally{$bitmap.Dispose()}
  }finally{$stream.Dispose()}
}
if(-not $Output){$Output=Join-Path $Directory 'ocr.json'}
@($records.ToArray()) | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $Output -Encoding UTF8
Write-Output ('已识别 '+$records.Count+' 张画面，输出：'+$Output)
