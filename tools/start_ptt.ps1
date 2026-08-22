# start_ptt.ps1 -- run just the audio push (FFmpeg -> /scanner/ingest) on this PC.
#
# Run it from a PowerShell window:
#     powershell -ExecutionPolicy Bypass -File .\tools\start_ptt.ps1
#
# This is the minimal gateway: it assumes the Global PTT console is ALREADY
# playing somewhere on this PC and its audio is already routed into VB-Cable.
# For the all-in-one version -- opens the console in its own browser, checks the
# prerequisites, and verifies that audio is really arriving -- use instead:
#     powershell -ExecutionPolicy Bypass -File .\tools\ptt_windows_gateway.ps1
#
# The ingest key is a secret, so it is NOT stored in this file. Put it in
# tools\ptt.local.env (gitignored) as:
#     PTT_KEY=the-same-value-as-SCANNER_INGEST_KEY-on-the-server
# ...or set $env:PTT_KEY before running this script.

$ErrorActionPreference = 'Stop'
$toolsDir = $PSScriptRoot
$repoRoot = Split-Path $toolsDir -Parent

# ---- settings ---------------------------------------------------------------
if (-not $env:PTT_SERVER)  { $env:PTT_SERVER  = 'https://radar.twistcasterlivemedia.com' }
if (-not $env:PTT_CHANNEL) { $env:PTT_CHANNEL = 'global-ptt' }
# The capture device. List the options with:
#     ffmpeg -list_devices true -f dshow -i dummy
if (-not $env:PTT_INPUT)   { $env:PTT_INPUT   = 'CABLE Output (VB-Audio Virtual Cable)' }
# $env:PTT_BITRATE = '48k'   # optional, default 32k
# -----------------------------------------------------------------------------

# Pull the key from tools\ptt.local.env (or the repo .env) when it is not
# already in the environment.
if (-not $env:PTT_KEY) {
    foreach ($file in @((Join-Path $toolsDir 'ptt.local.env'), (Join-Path $repoRoot '.env'))) {
        if (-not (Test-Path -LiteralPath $file)) { continue }
        foreach ($line in (Get-Content -LiteralPath $file)) {
            if ($line -match '^\s*(PTT_KEY|SCANNER_INGEST_KEY)\s*=\s*(.+?)\s*$') {
                $env:PTT_KEY = $matches[2].Trim('"').Trim("'")
                break
            }
        }
        if ($env:PTT_KEY) { break }
    }
}

if (-not $env:PTT_KEY) {
    Write-Host 'No ingest key found.' -ForegroundColor Red
    Write-Host 'Put it in tools\ptt.local.env as   PTT_KEY=<the SCANNER_INGEST_KEY value>'
    Write-Host 'or set $env:PTT_KEY before running this script.'
    exit 1
}

Set-Location $repoRoot

Write-Host "Global PTT gateway -> $($env:PTT_SERVER)  [$($env:PTT_CHANNEL)]  device: $($env:PTT_INPUT)"
while ($true) {
    node tools/ptt_source.js
    Write-Host '[start_ptt] ptt_source exited; restarting in 3s... (Ctrl+C to stop)'
    Start-Sleep -Seconds 3
}
