@echo off
REM Start-GlobalPTT-Windows.bat -- double-click to run the Global PTT gateway.
REM
REM Keep this file next to ptt_windows_gateway.ps1. It opens the console in its
REM own browser window, captures that audio off VB-Cable, and streams it to the
REM server. Leave the window open; closing it stops the gateway.
REM
REM First time on this PC, run the setup instead:
REM     Start-GlobalPTT-Windows.bat -Setup

title Global PTT Gateway
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ptt_windows_gateway.ps1" %*

echo.
echo The gateway stopped. Press any key to close.
pause >nul
