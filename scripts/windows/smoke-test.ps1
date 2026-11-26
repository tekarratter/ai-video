# Chạy thử AI Video Studio với dữ liệu mẫu nhỏ trong một workspace tạm có tên tiếng Việt
# (không đụng vào workspace\ thật). Kiểm tra: server, nhập ảnh/âm thanh tên có dấu, ffmpeg (khung hình,
# bảng khung hình có chữ), faster-whisper trên CPU, render Remotion ra MP4, sao lưu .zip.
#   ai-video.bat -Test        (hoặc: powershell -ExecutionPolicy Bypass -File scripts\windows\smoke-test.ps1)
param([string]$WhisperModel = 'tiny', [int]$Port = 3011)
. "$PSScriptRoot\common.ps1"
Initialize-AiVideoEnv
Set-Location $Root
$ErrorActionPreference = 'Continue'

# phải nằm ngay trong thư mục repo: component trong custom\ import '../../remotion/…'
$ws = Join-Path $Root '.smoke-thử nghiệm'
$results = [ordered]@{}
function Check([string]$name, [bool]$ok, [string]$detail = '') {
  $results[$name] = $ok
  $mark = if ($ok) { '[OK]  ' } else { '[LỖI]' }
  $color = if ($ok) { 'Green' } else { 'Red' }
  Write-Host ("{0} {1} {2}" -f $mark, $name, $detail) -ForegroundColor $color
}
function Vedit { & node (Join-Path $Root 'tools\vedit.mjs') @args 2>&1 | ForEach-Object { "$_" } }

Write-Step "Workspace tạm: $ws"
$tmp = Join-Path $env:TEMP 'ai-video thử nghiệm'
foreach ($d in @($ws, $tmp)) { if (Test-Path $d) { Remove-Item -Recurse -Force $d } }
New-Item -ItemType Directory -Force $ws | Out-Null
Copy-Item -Recurse (Join-Path $Root 'workspace\custom') (Join-Path $ws 'custom')
Copy-Item (Join-Path $Root 'workspace\CLAUDE.md') $ws
$inbox = Join-Path $tmp 'dữ liệu mẫu'
New-Item -ItemType Directory -Force $inbox | Out-Null
$img = Join-Path $inbox 'đèn lồng Hội An.jpg'
$voice = Join-Path $inbox 'giọng đọc tiếng Việt.m4a'
$clip = Join-Path $inbox 'phim ngắn.mp4'
Copy-Item (Join-Path $Root 'demos\news-short\media\lantern1.jpg') $img
Copy-Item (Get-ChildItem (Join-Path $Root 'demos\news-short\media\v_*.m4a') | Select-Object -First 1).FullName $voice
Copy-Item (Join-Path $Root 'demos\movie-short\media\bbb.mp4') $clip

$env:AI_VIDEO_WORKSPACE = $ws
$env:PORT = "$Port"
$env:AI_VIDEO_SERVER = "http://localhost:$Port"
$env:CLAUDE_AUTOSTART = '0'
$log = Join-Path $tmp 'server.log'

Write-Step "Khởi động server ở cổng $Port…"
$server = Start-Process -FilePath node -ArgumentList @('server/index.mjs') -WorkingDirectory $Root -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput $log -RedirectStandardError "$log.err"
$up = $false
for ($i = 0; $i -lt 60 -and -not $up; $i++) {
  Start-Sleep 1
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://localhost:$Port/api/jobs" | Out-Null; $up = $true } catch { }
}
Check 'Server chạy' $up "http://localhost:$Port"

try {
  if ($up) {
    Write-Step 'Nhập ảnh, giọng đọc và video có tên tiếng Việt…'
    $out = Vedit import $img $voice $clip --add
    $out | Write-Host
    $assets = @($out | Where-Object { $_ -match '^\S+\s+(image|audio|video)\s' } | ForEach-Object { ($_ -split '\s+')[0] })
    Check 'Nhập 3 tệp tên có dấu' ($assets.Count -eq 3) ($assets -join ', ')

    Vedit info | Write-Host

    $frame = (Vedit frame $assets[2] 1.0 | Select-Object -Last 1)
    Check 'ffmpeg: lấy 1 khung hình' ((Test-Path $frame) -and (Get-Item $frame).Length -gt 1000) $frame

    $sheet = (Vedit frames $assets[2] --count 4 | Where-Object { $_ -match '\.jpg$' } | Select-Object -First 1)
    Check 'ffmpeg: bảng khung hình có chữ (drawtext, font Windows)' ([bool]$sheet -and (Test-Path $sheet)) $sheet

    Write-Step "Nhận dạng giọng nói (faster-whisper '$WhisperModel', CPU, $env:WHISPER_THREADS luồng)…"
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $tr = Vedit transcribe $assets[1] --lang vi --model $WhisperModel
    $sw.Stop()
    $tr | Select-Object -Last 8 | Write-Host
    Check 'Whisper trên CPU' ([bool]($tr -match 'language=vi')) ("{0:N1}s" -f $sw.Elapsed.TotalSeconds)

    Write-Step 'Render nháp bằng Remotion (lần đầu phải đóng gói webpack, hơi lâu)…'
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $r = Vedit render --draft --range 0-4
    $sw.Stop()
    $mp4 = ($r | Where-Object { $_ -match '\.mp4$' } | Select-Object -Last 1)
    $ok = [bool]$mp4 -and (Test-Path $mp4)
    if ($ok) {
      $dur = & ffprobe -v error -show_entries format=duration -of csv=p=0 $mp4
      Check 'Render MP4' $true ("{0}  ({1}s video, mất {2:N0}s)" -f $mp4, $dur, $sw.Elapsed.TotalSeconds)
    } else { $r | Select-Object -Last 15 | Write-Host; Check 'Render MP4' $false }

    Write-Step 'Sao lưu dự án (.zip, tên tệp tiếng Việt)…'
    $list = Invoke-RestMethod "http://localhost:$Port/api/projects"
    $pid0 = $list.active
    $zip = Join-Path $tmp 'sao lưu.zip'
    try {
      Invoke-WebRequest -UseBasicParsing "http://localhost:$Port/api/projects/$pid0/backup?exports=0" -OutFile $zip
      $names = & $VenvPython -c "import sys, zipfile; print('\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))" $zip
      Check 'Sao lưu .zip giữ tên tiếng Việt' ([bool]($names -match 'đèn_lồng_Hội_An')) ("{0} tệp" -f @($names).Count)
    } catch { Check 'Sao lưu .zip giữ tên tiếng Việt' $false $_.Exception.Message }
  }
} finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force; Get-CimInstance Win32_Process -Filter "ParentProcessId=$($server.Id)" -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }
}

$failed = @($results.Keys | Where-Object { -not $results[$_] })
Write-Host ''
if ($failed.Count) {
  Write-Host "KẾT QUẢ: $($failed.Count)/$($results.Count) bước lỗi: $($failed -join '; ')   (log server: $log)" -ForegroundColor Red
  exit 1
}
Write-Host "KẾT QUẢ: cả $($results.Count) bước đều chạy được. Xoá khi không cần: $ws và $tmp" -ForegroundColor Green
exit 0
