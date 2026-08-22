#Requires -Version 5.1
<#
  tools/ptt_windows_gateway.ps1
  ---------------------------------------------------------------------------
  Runs the WHOLE Global PTT capture on a Windows PC -- the Windows counterpart
  of tools/ptt_linux_gateway.sh.

    Chromium browser (logged into dispatch.global-ptt.com, audio routed to
    VB-Cable) -> FFmpeg (captures "CABLE Output") -> POST /scanner/ingest on
    the streaming server -> app listeners.

  Global PTT has no API, so a browser has to play the console somewhere. On
  Linux that browser lives on the server behind Xvfb + a PulseAudio null sink.
  Windows has no null sink, so the equivalent is a virtual audio cable: the
  browser plays into "CABLE Input" and FFmpeg records "CABLE Output".

  ONE-TIME SETUP
    powershell -ExecutionPolicy Bypass -File .\tools\ptt_windows_gateway.ps1 -Setup

    It installs nothing behind your back; it checks the prerequisites, helps you
    route the browser's audio, stores the ingest key locally, and verifies that
    audio actually reaches the cable.

  EVERY DAY AFTER THAT
    Double-click tools\Start-GlobalPTT-Windows.bat   (or run this script)
    ...or install it as a logon task:   -InstallTask

  COMMON SWITCHES
    -ListDevices     show the audio capture devices FFmpeg can see
    -Probe           record 5s from the capture device and report the level
    -NoBrowser       do not launch a browser (use if the PTT desktop app or an
                     already-open browser is producing the audio)
    -KeepBrowser     leave the browser running when the gateway stops
    -Transport http  push with a plain HTTP POST instead of a WebSocket (only
                     works when nothing buffers the upload -- no CDN in front)
    -InstallTask     run automatically at logon;  -UninstallTask removes it

  CONFIG  (command line beats environment beats tools\ptt.local.env beats .env)
    PTT_SERVER   base URL of the streaming server
    PTT_KEY      must equal SCANNER_INGEST_KEY on the server
    PTT_INPUT    FFmpeg dshow capture device (auto-detected when unset)
    PTT_CHANNEL  channel id                          (default: global-ptt)
    PTT_BITRATE  MP3 bitrate                         (default: 32k)
    PTT_URL      console page the browser opens
    PTT_PROFILE  browser profile dir (keeps you logged in)
    PTT_BROWSER  full path to msedge.exe / chrome.exe
    PTT_FFMPEG   full path to ffmpeg.exe
#>

[CmdletBinding()]
param(
    [string] $Device,
    [string] $Server,
    [string] $Key,
    [string] $Channel,
    [string] $Bitrate,
    [string] $ConsoleUrl,
    [string] $BrowserProfile,
    [string] $Browser,
    [string] $FfmpegPath,
    [ValidateSet('ws','http')]
    [string] $Transport = 'ws',
    [int]    $BufferMs = 50,
    [int]    $ProbeSeconds = 5,
    [int]    $WaitForAudioSeconds = 180,
    [switch] $Setup,
    [switch] $ListDevices,
    [switch] $Probe,
    [switch] $NoBrowser,
    [switch] $KeepBrowser,
    [switch] $InstallTask,
    [switch] $UninstallTask
)

$ErrorActionPreference = 'Stop'

$ScriptPath = $MyInvocation.MyCommand.Path
$ToolsDir   = Split-Path $ScriptPath -Parent
$RepoRoot   = Split-Path $ToolsDir -Parent
$LocalEnv   = Join-Path $ToolsDir 'ptt.local.env'
$TaskName   = 'Vortex Global PTT Gateway'

function Say  ([string]$m) { Write-Host "[ptt] $m" }
function Ok   ([string]$m) { Write-Host "[ptt] $m" -ForegroundColor Green }
function Warn ([string]$m) { Write-Host "[ptt] $m" -ForegroundColor Yellow }
function Fail ([string]$m) { Write-Host "[ptt] $m" -ForegroundColor Red; exit 1 }

# --------------------------------------------------------------------------
# configuration
# --------------------------------------------------------------------------
function Read-EnvFile([string]$path) {
    $map = @{}
    if (-not (Test-Path -LiteralPath $path)) { return $map }
    foreach ($line in (Get-Content -LiteralPath $path)) {
        $t = $line.Trim()
        if ($t -eq '' -or $t.StartsWith('#')) { continue }
        $i = $t.IndexOf('=')
        if ($i -lt 1) { continue }
        $name = $t.Substring(0, $i).Trim()
        $val  = $t.Substring($i + 1).Trim()
        if ($val.Length -ge 2) {
            if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
                $val = $val.Substring(1, $val.Length - 2)
            }
        }
        $map[$name] = $val
    }
    return $map
}

$FileCfg = @{}
foreach ($f in @((Join-Path $RepoRoot '.env'), $LocalEnv)) {
    foreach ($kv in (Read-EnvFile $f).GetEnumerator()) { $FileCfg[$kv.Key] = $kv.Value }
}

function Get-Setting([string]$cliValue, [string[]]$names, [string]$fallback) {
    if ($cliValue) { return $cliValue }
    foreach ($n in $names) {
        $envVal = [Environment]::GetEnvironmentVariable($n)
        if ($envVal) { return $envVal }
    }
    foreach ($n in $names) {
        if ($FileCfg.ContainsKey($n) -and $FileCfg[$n]) { return $FileCfg[$n] }
    }
    return $fallback
}

$Server         = Get-Setting $Server         @('PTT_SERVER')  'https://radar.twistcasterlivemedia.com'
$Key            = Get-Setting $Key            @('PTT_KEY', 'SCANNER_INGEST_KEY') ''
$Channel        = Get-Setting $Channel        @('PTT_CHANNEL') 'global-ptt'
$Bitrate        = Get-Setting $Bitrate        @('PTT_BITRATE') '32k'
$ConsoleUrl     = Get-Setting $ConsoleUrl     @('PTT_URL')     'https://dispatch.global-ptt.com/#/intercom/map'
$BrowserProfile = Get-Setting $BrowserProfile @('PTT_PROFILE') (Join-Path $env:LOCALAPPDATA 'VortexPTT\browser-profile')
$Browser        = Get-Setting $Browser        @('PTT_BROWSER') ''
$FfmpegPath     = Get-Setting $FfmpegPath     @('PTT_FFMPEG')  ''
$Device         = Get-Setting $Device         @('PTT_INPUT')   ''
$Server         = $Server.TrimEnd('/')

# --------------------------------------------------------------------------
# prerequisites
# --------------------------------------------------------------------------
function Resolve-Ffmpeg {
    if ($FfmpegPath) {
        if (Test-Path -LiteralPath $FfmpegPath) { return (Resolve-Path -LiteralPath $FfmpegPath).Path }
        Fail "PTT_FFMPEG points at '$FfmpegPath', which does not exist."
    }
    $cmd = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\ffmpeg.exe'),
        'C:\ffmpeg\bin\ffmpeg.exe',
        (Join-Path $env:ProgramFiles 'ffmpeg\bin\ffmpeg.exe'),
        'C:\ProgramData\chocolatey\bin\ffmpeg.exe'
    )
    foreach ($c in $candidates) { if (Test-Path -LiteralPath $c) { return $c } }

    # unpacked release builds, e.g. %USERPROFILE%\ffmpeg\ffmpeg-8.1-essentials_build\bin
    foreach ($root in @((Join-Path $env:USERPROFILE 'ffmpeg'), (Join-Path $env:USERPROFILE 'Downloads'))) {
        if (Test-Path -LiteralPath $root) {
            $hit = Get-ChildItem -LiteralPath $root -Filter ffmpeg.exe -Recurse -ErrorAction SilentlyContinue |
                   Select-Object -First 1
            if ($hit) { return $hit.FullName }
        }
    }

    Write-Host ''
    Write-Host 'FFmpeg was not found. Install it with either of:' -ForegroundColor Yellow
    Write-Host '    winget install Gyan.FFmpeg'
    Write-Host '    (or download from https://ffmpeg.org and add its bin\ folder to PATH)'
    Write-Host 'Then open a NEW terminal and run this script again.'
    Write-Host ''
    Fail 'ffmpeg.exe is required.'
}

# When the server recycles the long POST, FFmpeg unwinds it as a wall of
# socket errors. That is routine, so collapse it instead of alarming anyone.
$script:DisconnectNoise = '10053|10054|Error submitting a packet|Error muxing a packet|Task finished with error|Terminating thread|Error writing trailer|URL read error|Error closing file|Broken pipe|Last message repeated'

# Start-Process joins -ArgumentList with spaces WITHOUT quoting, so anything
# containing a space (device names, profile paths) has to be quoted by hand.
function ConvertTo-ArgLine([string[]]$parts) {
    $out = @()
    foreach ($p in $parts) {
        if ($p -match '[\s"]') { $out += '"' + ($p -replace '"', '\"') + '"' }
        else                   { $out += $p }
    }
    return ($out -join ' ')
}

# Run FFmpeg to completion and return everything it wrote to stderr.
# Piping a native command's stderr through PowerShell wraps each line in an
# error record and can hard-wrap long lines, which mangles device names -- so
# redirect to a file instead and read it back verbatim.
function Invoke-FfmpegText([string]$ffmpeg, [string[]]$ffArgs) {
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        $p = Start-Process -FilePath $ffmpeg -ArgumentList (ConvertTo-ArgLine $ffArgs) -NoNewWindow -Wait -PassThru -RedirectStandardError $tmp
        $null = $p
        return (Get-Content -LiteralPath $tmp -Raw -ErrorAction SilentlyContinue)
    } finally {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
}

function Get-DshowAudioDevices([string]$ffmpeg) {
    # FFmpeg prints the device list on stderr and then exits non-zero. That is
    # expected -- do not let it look like a failure.
    $raw = Invoke-FfmpegText $ffmpeg @('-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy')
    if (-not $raw) { $raw = '' }

    $devices = @()
    $section = ''
    $last = $null
    foreach ($line in ($raw -split "`r?`n")) {
        if ($line -match 'DirectShow (video|audio) devices') { $section = $matches[1]; $last = $null; continue }
        if ($line -match 'Alternative name\s+"([^"]+)"') {
            if ($last) { $last.Alt = $matches[1] }
            continue
        }
        # ffmpeg >= 7: [in#0 @ ..] "Name" (audio)   |   older: [dshow @ ..]  "Name"
        if ($line -match '"([^"]+)"\s*\((audio|video)\)') {
            $last = [pscustomobject]@{ Name = $matches[1]; Kind = $matches[2]; Alt = '' }
            $devices += $last
            continue
        }
        if ($line -match '^\s*\[[^\]]+\]\s+"([^"]+)"\s*$') {
            $last = [pscustomobject]@{ Name = $matches[1]; Kind = $section; Alt = '' }
            $devices += $last
            continue
        }
    }
    return @($devices | Where-Object { $_.Kind -eq 'audio' })
}

function Select-CaptureDevice($audioDevices, [string]$wanted) {
    if ($audioDevices.Count -eq 0) {
        Fail 'FFmpeg reported no audio capture devices at all. Check your sound drivers.'
    }
    if ($wanted) {
        $exact = $audioDevices | Where-Object { $_.Name -eq $wanted } | Select-Object -First 1
        if ($exact) { return $exact }
        $part = $audioDevices | Where-Object { $_.Name -like "*$wanted*" } | Select-Object -First 1
        if ($part) {
            Warn "No device named exactly '$wanted'; using '$($part.Name)'."
            return $part
        }
        Warn "Configured device '$wanted' is not present right now -- falling back to auto-detect."
    }
    foreach ($pattern in @('CABLE Output*', '*VB-Audio*', '*VoiceMeeter Out*', 'Stereo Mix*')) {
        $hit = $audioDevices | Where-Object { $_.Name -like $pattern } | Select-Object -First 1
        if ($hit) { return $hit }
    }
    Write-Host 'Audio capture devices FFmpeg can see:'
    foreach ($d in $audioDevices) { Write-Host "    $($d.Name)" }
    Write-Host ''
    Write-Host 'None of them looks like a virtual cable. Install VB-Audio Virtual Cable'
    Write-Host '(https://vb-audio.com/Cable/), reboot, and run -Setup again -- or pass the'
    Write-Host 'device you want with:  -Device "exact name from the list above"'
    Fail 'No capture device selected.'
}

function Test-CableInstalled {
    $root = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render'
    if (-not (Test-Path $root)) { return $null }
    foreach ($k in (Get-ChildItem $root -ErrorAction SilentlyContinue)) {
        $props = Join-Path $k.PSPath 'Properties'
        $name = $null
        try { $name = (Get-ItemProperty -Path $props -ErrorAction Stop).'{a45c254e-df1c-4efd-8020-67d146a850e0},2' } catch { }
        if ($name -and $name -like 'CABLE In*') {
            $state = 0
            try { $state = (Get-ItemProperty -Path $k.PSPath -ErrorAction Stop).DeviceState } catch { }
            return [pscustomobject]@{ Name = $name; Enabled = ($state -eq 1) }
        }
    }
    return $null
}

# Record briefly and report the peak level, so "is audio actually arriving?"
# is answered by measurement instead of by guesswork.
function Measure-CaptureLevel([string]$ffmpeg, [string]$dev, [int]$seconds) {
    $raw = Invoke-FfmpegText $ffmpeg @(
        '-hide_banner', '-nostats', '-f', 'dshow', '-i', "audio=$dev",
        '-t', "$seconds", '-af', 'volumedetect', '-f', 'null', 'NUL'
    )
    if (-not $raw) { $raw = '' }
    if ($raw -match 'max_volume:\s*(-?[\d.]+) dB') { return [double]$matches[1] }
    if ($raw -match 'Could not (?:run|find|open)|I/O error|Error opening') {
        Warn "FFmpeg could not open '$dev'."
        foreach ($l in ($raw -split "`r?`n" | Where-Object { $_ -match 'error|Error' } | Select-Object -First 3)) { Write-Host "    $l" }
    }
    return $null
}

# Print one FFmpeg log line, quietly dropping routine disconnect noise, and
# return a verdict when the line means the server refused us outright.
function Show-FfmpegLine([string]$line) {
    $text = $line.TrimEnd()
    if (-not $text) { return $null }
    if ($text -match '\b401\b|Bad ingest key')  { return 'key' }
    if ($text -match '\b503\b')                 { return 'disabled' }
    if ($text -match '\b404\b|Unknown channel') { return 'channel' }
    if ($text -match $script:DisconnectNoise)   { return $null }
    Write-Host "[ffmpeg] $text" -ForegroundColor DarkGray
    return $null
}

function Resolve-Browser {
    if ($Browser) {
        if (Test-Path -LiteralPath $Browser) { return $Browser }
        Fail "PTT_BROWSER points at '$Browser', which does not exist."
    }
    $candidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )
    foreach ($c in $candidates) { if ($c -and (Test-Path -LiteralPath $c)) { return $c } }
    return $null
}

function Start-ConsoleBrowser([string]$exe) {
    if (-not (Test-Path -LiteralPath $BrowserProfile)) {
        New-Item -ItemType Directory -Path $BrowserProfile -Force | Out-Null
    }
    # The background-throttling flags matter here: without them Windows and
    # Chromium quiet a minimized/occluded window, which silently kills the feed.
    $browserArgs = @(
        "--user-data-dir=$BrowserProfile",
        '--no-first-run',
        '--no-default-browser-check',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=CalculateNativeWinOcclusion,Translate,MediaRouter',
        '--new-window',
        $ConsoleUrl
    )
    $p = Start-Process -FilePath $exe -ArgumentList (ConvertTo-ArgLine $browserArgs) -PassThru
    Say "browser started (profile: $BrowserProfile)"
    return $p
}

function Save-LocalSetting([string]$name, [string]$value) {
    $lines = @()
    if (Test-Path -LiteralPath $LocalEnv) {
        $lines = @(Get-Content -LiteralPath $LocalEnv | Where-Object { $_ -notmatch "^\s*$([regex]::Escape($name))\s*=" })
    } else {
        $lines = @(
            '# tools/ptt.local.env -- local Global PTT gateway settings.',
            '# Gitignored: it holds the ingest key. Do not commit or share it.'
        )
    }
    $lines += "$name=$value"
    Set-Content -LiteralPath $LocalEnv -Value $lines -Encoding utf8
}

# --------------------------------------------------------------------------
# task registration
# --------------------------------------------------------------------------
if ($InstallTask) {
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File "{0}"' -f $ScriptPath)
    $trigger  = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
    Ok "installed the logon task '$TaskName'. Remove it with -UninstallTask."
    exit 0
}
if ($UninstallTask) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Ok "removed the logon task '$TaskName'."
    exit 0
}

# --------------------------------------------------------------------------
# device modes
# --------------------------------------------------------------------------
$ffmpeg = Resolve-Ffmpeg
Say "ffmpeg: $ffmpeg"

if ($ListDevices) {
    $devs = Get-DshowAudioDevices $ffmpeg
    Write-Host ''
    Write-Host 'Audio capture devices FFmpeg can see:'
    foreach ($d in $devs) {
        Write-Host ("    {0}" -f $d.Name)
        if ($d.Alt) { Write-Host ("        alt: {0}" -f $d.Alt) -ForegroundColor DarkGray }
    }
    Write-Host ''
    exit 0
}

$audioDevices = Get-DshowAudioDevices $ffmpeg
$selected = Select-CaptureDevice $audioDevices $Device
$Device = $selected.Name
Say "capture device: $Device"

if ($Probe) {
    Say "recording $ProbeSeconds s to measure the level -- make some audio now..."
    $db = Measure-CaptureLevel $ffmpeg $Device $ProbeSeconds
    if ($null -eq $db) { Fail 'Could not measure the device.' }
    if ($db -le -60) { Warn ("peak {0} dB -- that is silence. The audio is not reaching '{1}'." -f $db, $Device) }
    else             { Ok   ("peak {0} dB -- audio is reaching the capture device." -f $db) }
    exit 0
}

# --------------------------------------------------------------------------
# one-time setup
# --------------------------------------------------------------------------
if ($Setup) {
    Write-Host ''
    Write-Host '=== Global PTT gateway setup (Windows) ===' -ForegroundColor Cyan
    Write-Host ''

    $cable = Test-CableInstalled
    if ($cable) {
        if ($cable.Enabled) { Ok "virtual cable found: '$($cable.Name)' (playback side)" }
        else { Warn "'$($cable.Name)' exists but is disabled -- enable it in Sound settings." }
    } else {
        Warn 'No VB-Audio virtual cable playback device found.'
        Write-Host '    Install VB-Audio Virtual Cable (free): https://vb-audio.com/Cable/'
        Write-Host '    Run its installer as administrator, reboot, then run -Setup again.'
    }

    if (-not $Key) {
        Write-Host ''
        Write-Host 'Enter the ingest key (the SCANNER_INGEST_KEY value from the server .env).'
        $entered = Read-Host 'Ingest key'
        if ($entered) {
            Save-LocalSetting 'PTT_KEY' $entered.Trim()
            $Key = $entered.Trim()
            Ok "saved to $LocalEnv (gitignored)."
        }
    } else {
        Ok 'ingest key is configured.'
    }

    Write-Host ''
    Write-Host 'Route the console audio into the cable:' -ForegroundColor Cyan
    Write-Host '  1. Leave this window open; the gateway will open the console in its own'
    Write-Host '     browser window (dedicated profile, so your normal browser is untouched).'
    Write-Host '  2. Log into the console once and open the intercom so audio is playing.'
    Write-Host '  3. In Settings > System > Sound > Volume mixer, find that browser and set'
    Write-Host '     its Output to "CABLE Input (VB-Audio Virtual Cable)".'
    Write-Host '     Windows remembers this per app, so it is genuinely a one-time step.'
    Write-Host ''
    Write-Host 'Opening the volume mixer now...'
    Start-Process 'ms-settings:apps-volume' -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Host 'When that is done, run the gateway:  .\tools\Start-GlobalPTT-Windows.bat'
    Write-Host 'Verify audio any time with:          -Probe'
    Write-Host ''
    exit 0
}

# --------------------------------------------------------------------------
# run
# --------------------------------------------------------------------------
if (-not $Key) {
    Write-Host ''
    Write-Host 'No ingest key configured.' -ForegroundColor Yellow
    Write-Host 'It must match SCANNER_INGEST_KEY on the server. Set it once with:'
    Write-Host '    powershell -ExecutionPolicy Bypass -File .\tools\ptt_windows_gateway.ps1 -Setup'
    Write-Host 'or set $env:PTT_KEY before running this script.'
    Fail 'PTT_KEY is required.'
}

$ingestUrl = "$Server/scanner/ingest/$([uri]::EscapeDataString($Channel))"
$browserProc = $null
$script:FfmpegProc = $null

try {
    if (-not $NoBrowser) {
        $exe = Resolve-Browser
        if ($exe) { $browserProc = Start-ConsoleBrowser $exe }
        else { Warn 'No Edge/Chrome found -- skipping browser launch. Open the console yourself, or pass -NoBrowser.' }

        if ($browserProc) {
            Say 'giving the console 10s to load...'
            Start-Sleep -Seconds 10
        }
    }

    # Wait for the audio routing instead of assuming it. The browser only shows
    # up in the per-app volume mixer once it is actually playing something, so
    # this is the point where the routing can be set -- and the only step
    # Windows cannot do for us.
    $db = Measure-CaptureLevel $ffmpeg $Device 3
    if ($null -ne $db -and $db -le -60 -and $WaitForAudioSeconds -gt 0) {
        Write-Host ''
        Warn ("nothing is reaching '{0}' yet (peak {1} dB)." -f $Device, $db)
        Write-Host ''
        Write-Host '  In the Volume mixer that just opened:' -ForegroundColor Cyan
        Write-Host '    1. Log into the console in the browser window and open the intercom,'
        Write-Host '       so it starts playing (that is what makes it appear in the mixer).'
        Write-Host '    2. Find that browser in the list.'
        Write-Host '    3. Set its Output device to "CABLE Input (VB-Audio Virtual Cable)".'
        Write-Host '  Windows remembers this per app -- you only ever do it once.'
        Write-Host ''
        Start-Process 'ms-settings:apps-volume' -ErrorAction SilentlyContinue

        $deadline = (Get-Date).AddSeconds($WaitForAudioSeconds)
        Say 'waiting for audio on the cable... (Ctrl+C to stop, or just wait it out)'
        while ((Get-Date) -lt $deadline) {
            $db = Measure-CaptureLevel $ffmpeg $Device 3
            if ($null -ne $db -and $db -gt -60) { break }
            $left = [int]($deadline - (Get-Date)).TotalSeconds
            Write-Host ("  still silent, retrying ({0}s left)..." -f $left) -ForegroundColor DarkGray
            Start-Sleep -Seconds 2
        }
    }

    if ($null -ne $db -and $db -gt -60) {
        Ok ("audio present on the capture device (peak {0} dB)." -f $db)
    } elseif ($null -ne $db) {
        Warn 'still no audio on the cable -- streaming anyway.'
        Warn 'Listeners will hear silence until the browser output is set to CABLE Input.'
    }


    # Transport: 'ws' pushes over a WebSocket, which is what survives a CDN.
    # A CDN in front of the origin (Cloudflare and most others) buffers a
    # request body and only forwards it once the upload finishes -- and a live
    # feed never finishes, so the plain POST below never reaches the origin.
    # Use -Transport http only when pushing straight at the origin.
    if ($Transport -eq 'ws') {
        $node = Get-Command node.exe -ErrorAction SilentlyContinue
        if (-not $node) {
            Warn 'Node.js is needed for the WebSocket transport but was not found.'
            Warn 'Install it from https://nodejs.org, or run with -Transport http.'
            Fail 'node.exe is required for -Transport ws.'
        }
        $pusher = Join-Path $ToolsDir 'ptt_ws_source.js'
        if (-not (Test-Path -LiteralPath $pusher)) { Fail "missing $pusher" }

        $env:PTT_SERVER  = $Server
        $env:PTT_KEY     = $Key
        $env:PTT_INPUT   = $Device
        $env:PTT_CHANNEL = $Channel
        $env:PTT_BITRATE = $Bitrate
        $env:PTT_FFMPEG  = $ffmpeg
        $env:PTT_BUFFER_MS = "$BufferMs"

        Say "streaming '$Device' -> $Server [$Channel] over WebSocket  [$Bitrate mono mp3]"
        Say 'Ctrl+C stops the gateway.'
        & $node.Source $pusher
        $code = $LASTEXITCODE
        if ($code -eq 3) {
            Warn 'falling back to the plain HTTP POST transport for this run.'
            Warn 'That only works if nothing buffers the upload between here and the origin.'
            $Transport = 'http'
        } else {
            return
        }
    }

    Say "streaming '$Device' -> $ingestUrl  [$Bitrate mono mp3]"
    Say 'Ctrl+C stops the gateway.'
    # The server accepts the key as ?key= or as an x-ingest-key header; the URL
    # form is what the Linux gateway and ptt_source.js already use.
    $target = $ingestUrl + '?key=' + [uri]::EscapeDataString($Key)
    $logFile = Join-Path ([System.IO.Path]::GetTempPath()) 'vortex-ptt-ffmpeg.log'

    while ($true) {
        $ffArgs = @('-hide_banner', '-loglevel', 'warning', '-f', 'dshow')
        if ($BufferMs -gt 0) { $ffArgs += @('-audio_buffer_size', "$BufferMs") }
        $ffArgs += @(
            '-i', "audio=$Device",
            '-ac', '1', '-ar', '44100',
            '-c:a', 'libmp3lame', '-b:a', $Bitrate,
            # No ID3/Xing headers: this is an endless stream, and on every
            # reconnect those would land in the middle of what listeners hear.
            '-f', 'mp3', '-id3v2_version', '0', '-write_xing', '0',
            '-content_type', 'audio/mpeg', '-method', 'POST',
            $target
        )

        Remove-Item -LiteralPath $logFile -Force -ErrorAction SilentlyContinue
        $ffProc = Start-Process -FilePath $ffmpeg -ArgumentList (ConvertTo-ArgLine $ffArgs) -NoNewWindow -PassThru -RedirectStandardError $logFile
        $script:FfmpegProc = $ffProc

        # Tail FFmpeg's log while it runs, so problems show up as they happen.
        $shown = 0
        $fatal = $null
        while (-not $ffProc.HasExited) {
            Start-Sleep -Milliseconds 700
            $lines = @(Get-Content -LiteralPath $logFile -ErrorAction SilentlyContinue)
            for ($i = $shown; $i -lt $lines.Count; $i++) {
                $verdict = Show-FfmpegLine $lines[$i]
                if ($verdict) { $fatal = $verdict }
            }
            $shown = $lines.Count
        }
        $script:FfmpegProc = $null

        $lines = @(Get-Content -LiteralPath $logFile -ErrorAction SilentlyContinue)
        for ($i = $shown; $i -lt $lines.Count; $i++) {
            $verdict = Show-FfmpegLine $lines[$i]
            if ($verdict) { $fatal = $verdict }
        }

        switch ($fatal) {
            'key'      { Fail 'the server rejected the ingest key (401). Make PTT_KEY match SCANNER_INGEST_KEY on the server.' }
            'disabled' { Fail 'the server has ingest disabled (503). Set SCANNER_INGEST_KEY in the server .env and restart it.' }
            'channel'  { Fail "the server does not have a channel called '$Channel' (404)." }
        }

        # The server recycles the long POST periodically; reconnecting is normal.
        Say 'ingest connection ended -- reconnecting in 3s...'
        Start-Sleep -Seconds 3
    }
}
finally {
    if ($script:FfmpegProc) {
        try { Stop-Process -Id $script:FfmpegProc.Id -Force -ErrorAction SilentlyContinue } catch { }
    }
    if ($browserProc -and -not $KeepBrowser) {
        Say 'closing the console browser...'
        try { Stop-Process -Id $browserProc.Id -Force -ErrorAction SilentlyContinue } catch { }
    }
    Say 'gateway stopped.'
}
