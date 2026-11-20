@echo off
rem AI Video Studio on Windows - one command: install if needed, then run.
rem   ai-video.bat            run (http://localhost:5180)
rem   ai-video.bat -Test      smoke test with sample data
rem   ai-video.bat -Setup     reinstall dependencies
chcp 65001 >nul
set PYTHONUTF8=1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\run.ps1" %*
exit /b %ERRORLEVEL%
