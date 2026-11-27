# Cài AI Video Studio trên Windows: npm, venv Python (bản CPU), Chrome headless cho Remotion.
#   powershell -ExecutionPolicy Bypass -File scripts\windows\setup.ps1
param([switch]$Force)
. "$PSScriptRoot\common.ps1"
Initialize-AiVideoEnv
Set-Location $Root
# lệnh ngoài (npm, pip) in cảnh báo ra stderr: kiểm tra bằng $LASTEXITCODE thay vì để PowerShell 5.1 dừng
$ErrorActionPreference = 'Continue'

if (-not $Force -and (Test-SetupDone)) { Write-Step 'Đã cài đặt (dùng -Force để cài lại).'; return }

# --- Node ---
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Chưa có Node.js (>= 20). Cài: winget install OpenJS.NodeJS.LTS' }
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) { throw "Node $(node --version) quá cũ, cần >= 20." }
Write-Step "Node $(node --version), ffmpeg: $((Get-Command ffmpeg).Source)"

# --- npm ---
Write-Step 'Cài gói npm (npm ci)…'
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm ci lỗi' }

# --- Claude Code CLI (panel chat Claude) ---
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Step 'Cài Claude Code CLI cho panel chat (npm install -g @anthropic-ai/claude-code)…'
  npm install -g @anthropic-ai/claude-code --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Write-Warning 'Không cài được Claude Code CLI: panel chat sẽ không chạy. Cài tay: npm install -g @anthropic-ai/claude-code' }
}

# --- Python venv ---
if (-not (Test-Path $VenvPython)) {
  $py = $null
  foreach ($c in @(@('py', '-3.12'), @('py', '-3'), @('python'))) {
    try { & $c[0] @($c[1..9] + @('-c', 'import sys; assert sys.version_info >= (3, 9)')) 2>$null; if ($LASTEXITCODE -eq 0) { $py = $c; break } } catch { }
  }
  if (-not $py) { throw 'Chưa có Python >= 3.9. Cài: winget install Python.Python.3.12' }
  Write-Step "Tạo venv bằng: $($py -join ' ')"
  & $py[0] @($py[1..9] + @('-m', 'venv', $Venv))
  if ($LASTEXITCODE -ne 0) { throw 'Tạo venv lỗi' }
}
Write-Step 'Cài gói Python (faster-whisper bản CPU, Pillow, yt-dlp)…'
& $VenvPython -m pip install -q --upgrade pip
& $VenvPython -m pip install -q -r (Join-Path $Root 'requirements-windows.txt')
if ($LASTEXITCODE -ne 0) { throw 'pip install lỗi' }
& $VenvPython -c "import faster_whisper, ctranslate2, PIL; print('faster-whisper', faster_whisper.__version__, '| CUDA devices:', ctranslate2.get_cuda_device_count())"

# --- Chrome headless cho Remotion (tải một lần) ---
Write-Step 'Tải Chrome headless shell cho Remotion (nếu chưa có)…'
npx --no-install remotion browser ensure
if ($LASTEXITCODE -ne 0) { Write-Warn 'Chưa tải được Chrome headless; lần render đầu Remotion sẽ tự tải.' }

New-Item -ItemType Directory -Force (Join-Path $Root 'logs') | Out-Null
Set-Content -Path (Join-Path $Venv '.setup-ok') -Value (Get-Date -Format o) -Encoding ascii
Write-Step 'Cài đặt xong.'
