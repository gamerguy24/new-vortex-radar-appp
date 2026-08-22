@echo off
REM Start-GlobalPTT.bat — double-click to start the Global PTT audio gateway.
REM Keep this file in the SAME folder as GlobalPTT-Gateway.js.
REM Needs Node.js and FFmpeg installed on this PC.

title Global PTT Gateway
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org then run this again.
  pause
  exit /b 1
)

echo Starting Global PTT gateway... leave this window open.
echo (Close this window or press Ctrl+C to stop.)
echo.
node "%~dp0GlobalPTT-Gateway.js"

echo.
echo The gateway stopped. Press any key to close.
pause >nul
