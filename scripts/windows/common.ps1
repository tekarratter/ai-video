# Môi trường dùng chung cho các script Windows của AI Video Studio (dot-source: . "$PSScriptRoot\common.ps1").
# UTF-8 toàn bộ, ffmpeg trong PATH, venv Python, giới hạn luồng CPU theo cấu hình máy.

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Venv = Join-Path $Root '.venv'
$VenvPython = Join-Path $Venv 'Scripts\python.exe'

function Write-Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Warn([string]$msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }

function Set-DefaultEnv([string]$name, [string]$value) {
  if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) { Set-Item "env:$name" $value }
}

function Find-Ffmpeg {
  $cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if ($cmd) { return Split-Path $cmd.Source }
  $candidates = @(
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\*FFmpeg*\*\bin",
    "$env:ProgramFiles\ffmpeg\bin",
    "C:\ffmpeg\bin",
    "$env:USERPROFILE\scoop\shims",
    "$env:ProgramData\chocolatey\bin"
  )
  foreach ($c in $candidates) {
    foreach ($d in (Get-Item $c -ErrorAction SilentlyContinue)) {
      if (Test-Path (Join-Path $d.FullName 'ffmpeg.exe')) { return $d.FullName }
    }
  }
  return $null
}

function Initialize-AiVideoEnv {
  # --- UTF-8: console, PowerShell pipes, Python, Node ---
  chcp 65001 > $null
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [Console]::OutputEncoding = $utf8
  [Console]::InputEncoding = $utf8
  $global:OutputEncoding = $utf8
  $env:PYTHONUTF8 = '1'
  $env:PYTHONIOENCODING = 'utf-8'
  $env:LANG = 'C.UTF-8'

  # --- ffmpeg / ffprobe ---
  $ff = Find-Ffmpeg
  if (-not $ff) {
    throw "Không tìm thấy ffmpeg. Cài bằng lệnh:  winget install --id Gyan.FFmpeg -e   rồi mở lại cửa sổ và chạy lại."
  }
  if (-not (($env:PATH -split ';') -contains $ff)) { $env:PATH = "$ff;$env:PATH" }

  # --- Python venv của repo (faster-whisper, Pillow, yt-dlp) ---
  if (Test-Path $VenvPython) {
    $env:PATH = "$(Join-Path $Venv 'Scripts');$env:PATH"
    $env:AI_VIDEO_PYTHON = $VenvPython
  }
  $env:HF_HUB_DISABLE_PROGRESS_BARS = '1'
  $env:HF_HUB_DISABLE_SYMLINKS_WARNING = '1'   # Windows không tạo symlink cho cache HuggingFace

  # --- Giới hạn luồng CPU (máy chỉ có CPU) ---
  $logical = [Environment]::ProcessorCount
  $physical = $logical
  try { $physical = [int](Get-CimInstance Win32_Processor | Measure-Object NumberOfCores -Sum).Sum } catch { }
  if ($physical -lt 1) { $physical = [Math]::Max(1, [int]($logical / 2)) }
  $ramGB = 8
  try { $ramGB = [Math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB) } catch { }

  # Whisper/CTranslate2 và các thư viện OpenMP: mỗi lõi vật lý một luồng
  Set-DefaultEnv 'WHISPER_THREADS' "$physical"
  Set-DefaultEnv 'OMP_NUM_THREADS' "$physical"
  Set-DefaultEnv 'MKL_NUM_THREADS' "$physical"
  # Remotion: số tab Chrome render song song (mỗi tab ~1-1.5 GB RAM)
  $renderConc = [Math]::Max(1, [Math]::Min([int]($logical / 4), [int](($ramGB - 4) / 3)))
  Set-DefaultEnv 'RENDER_CONCURRENCY' "$renderConc"
  # ffmpeg tạo proxy xem trước: một nửa số luồng, để giao diện vẫn mượt
  Set-DefaultEnv 'PROXY_THREADS' "$([Math]::Max(1, [int]($logical / 2)))"
  Set-DefaultEnv 'WHISPER_MODEL' 'small'

  Write-Host ("CPU: {0} lõi / {1} luồng, RAM ~{2} GB  →  WHISPER_THREADS={3}, RENDER_CONCURRENCY={4}, PROXY_THREADS={5}" -f `
    $physical, $logical, $ramGB, $env:WHISPER_THREADS, $env:RENDER_CONCURRENCY, $env:PROXY_THREADS) -ForegroundColor DarkGray
}

function Test-SetupDone {
  $stamp = Join-Path $Venv '.setup-ok'
  if (-not (Test-Path $stamp) -or -not (Test-Path (Join-Path $Root 'node_modules'))) { return $false }
  $lock = Get-Item (Join-Path $Root 'package-lock.json')
  $req = Get-Item (Join-Path $Root 'requirements-windows.txt')
  $t = (Get-Item $stamp).LastWriteTime
  return ($lock.LastWriteTime -le $t -and $req.LastWriteTime -le $t)
}
