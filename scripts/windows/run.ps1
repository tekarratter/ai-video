# Chạy AI Video Studio trên Windows bằng một lệnh (tự cài nếu chưa cài).
#   ai-video.bat                 → cài nếu cần, chạy server :3001 + giao diện :5180, mở trình duyệt
#   ai-video.bat -Setup          → cài lại phụ thuộc
#   ai-video.bat -Test           → chạy thử với dữ liệu mẫu (không đụng vào workspace\ thật)
#   ai-video.bat -NoBrowser      → không tự mở trình duyệt
#   ai-video.bat -Serve          → không theo dõi thay đổi code (node --watch tắt)
param([switch]$Setup, [switch]$Test, [switch]$NoBrowser, [switch]$Serve)
. "$PSScriptRoot\common.ps1"

if ($Setup -or -not (Test-SetupDone)) { & "$PSScriptRoot\setup.ps1" -Force:$Setup }
Initialize-AiVideoEnv
Set-Location $Root

if ($Test) { & "$PSScriptRoot\smoke-test.ps1"; exit $LASTEXITCODE }

$port = if ($env:PORT) { $env:PORT } else { '3001' }
$webPort = if ($env:WEB_PORT) { $env:WEB_PORT } else { '5180' }
$url = "http://localhost:$webPort"
Write-Step "AI Video Studio: $url   (Ctrl+C để dừng; log: logs\server.log)"
Write-Host 'Panel chat Claude cần tmux nên tắt trên Windows — dùng Claude Code trong thư mục workspace\ hoặc MCP (docs\MCP.md).' -ForegroundColor DarkGray

if (-not $NoBrowser) {
  # mở trình duyệt khi giao diện đã lên
  Start-Job -ArgumentList $url -ScriptBlock {
    param($u)
    for ($i = 0; $i -lt 60; $i++) {
      try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $u | Out-Null; Start-Process $u; return } catch { Start-Sleep 1 }
    }
  } | Out-Null
}

New-Item -ItemType Directory -Force (Join-Path $Root 'logs') | Out-Null
$script = if ($Serve) { 'serve' } else { 'dev' }
$log = Join-Path $Root 'logs\server.log'
# cmd gộp stderr vào stdout (PowerShell 5.1 biến stderr của lệnh ngoài thành lỗi); log ghi UTF-8 (Tee-Object của 5.1 ghi UTF-16)
$ErrorActionPreference = 'Continue'
$writer = New-Object System.IO.StreamWriter($log, $true, (New-Object System.Text.UTF8Encoding($false)))
$writer.AutoFlush = $true
try {
  cmd /c "npm run $script 2>&1" | ForEach-Object { Write-Host $_; $writer.WriteLine($_) }
} finally { $writer.Dispose() }
