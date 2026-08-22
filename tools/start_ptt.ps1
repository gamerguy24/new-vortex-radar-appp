# start_ptt.ps1 — run the Global PTT audio gateway on this Windows PC.
# Double-click won't work (PowerShell scripts are blocked by default); run it from
# a PowerShell window:   powershell -ExecutionPolicy Bypass -File .\tools\start_ptt.ps1
#
# It keeps the audio push alive and restarts automatically if it drops.

# ── settings ──────────────────────────────────────────────────────────────────
$env:PTT_SERVER  = "https://radar.twistcasterlivemedia.com"
# Same value as SCANNER_INGEST_KEY in the server's .env (already matched):
$env:PTT_KEY     = "46f05bbe5c877b9b2d61f95bcab1ba4fcd8d40cca6d25d4b50b95cb4ec06b6f2"
# 👇 EDIT THIS to your audio device. List devices with:
#     ffmpeg -list_devices true -f dshow -i dummy
$env:PTT_INPUT   = "CABLE Output (VB-Audio Virtual Cable)"
$env:PTT_CHANNEL = "global-ptt"
# $env:PTT_BITRATE = "48k"   # optional, default 32k
# ──────────────────────────────────────────────────────────────────────────────

# Run from the folder that contains this script's parent (the AtticRadar root).
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host "Global PTT gateway → $($env:PTT_SERVER)  [$($env:PTT_CHANNEL)]  device: $($env:PTT_INPUT)"
while ($true) {
    node tools/ptt_source.js
    Write-Host "[start_ptt] ptt_source exited; restarting in 3s… (Ctrl+C to stop)"
    Start-Sleep -Seconds 3
}
