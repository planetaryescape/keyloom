# Install the explicit candidate. Real native helper: doctor only. Synthetic helper: installed CLI journey.
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Binary, [switch]$Synthetic)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = Split-Path $PSScriptRoot -Parent
$binaryPath = (Resolve-Path -LiteralPath $Binary).Path
$version = (Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('keyloom native space ' + [char]0x00e9 + '-' + [Guid]::NewGuid().ToString('N'))
$saved = @{}
foreach ($name in @('LOCALAPPDATA', 'KEYLOOM_INSTALL_DIR', 'KEYLOOM_DOWNLOAD_BASE', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'PATH')) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
function Invoke-Keyloom([string[]]$CliArgs, [int]$Expected = 0) {
    $errorPath = Join-Path $scratch 'command.err'
    $output = & $script:installed @CliArgs 2> $errorPath | Out-String
    $errors = Get-Content -LiteralPath $errorPath -Raw
    if ($LASTEXITCODE -ne $Expected) { throw "exit $LASTEXITCODE expected $Expected for $CliArgs`: $output $errors" }
    if ($Expected -ne 0) { return "$output $errors" }
    return $output
}
try {
    [IO.Directory]::CreateDirectory($scratch) | Out-Null
    $env:LOCALAPPDATA = $scratch
    $env:KEYLOOM_INSTALL_DIR = Join-Path $scratch 'Programs\keyloom'
    $env:ANTHROPIC_API_KEY = ''; $env:OPENROUTER_API_KEY = ''
    $mirror = Join-Path $scratch "mirror\download\v$version"
    [IO.Directory]::CreateDirectory($mirror) | Out-Null
    Copy-Item -LiteralPath $binaryPath -Destination (Join-Path $mirror 'keyloom-windows-x64.exe')
    Set-Content -LiteralPath (Join-Path $mirror 'SHA256SUMS') -Encoding Ascii -Value ((Get-FileHash -LiteralPath $binaryPath -Algorithm SHA256).Hash + '  keyloom-windows-x64.exe')
    $env:KEYLOOM_DOWNLOAD_BASE = ([Uri]((Join-Path $scratch 'mirror') + '\')).AbsoluteUri.TrimEnd('/')
    $shell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    & $shell -NoProfile -File (Join-Path $repo 'install.ps1') -Version "v$version"
    if ($LASTEXITCODE -ne 0) { throw 'candidate installer failed' }
    $script:installed = Join-Path $env:KEYLOOM_INSTALL_DIR 'keyloom.exe'
    $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot\System32\WindowsPowerShell\v1.0"
    $data = Join-Path $scratch 'data'
    $doctor = Invoke-Keyloom @('--data-dir', $data, 'doctor', '--device-helper-only', '--format', 'json') | ConvertFrom-Json
    $expected = @('hid.list', 'hid.open', 'hid.write', 'serial.list', 'serial.open', 'serial.touch.1200', 'serial.touch.1201')
    if (-not $doctor.ok -or $doctor.checks.Count -ne 1 -or -not $doctor.checks[0].deviceHelper.available -or (($doctor.checks[0].deviceHelper.capabilities -join ',') -cne ($expected -join ',')) -or $doctor.checks[0].detail -notmatch 'native Windows candidate; hardware acceptance pending') { throw 'invalid candidate doctor' }
    Write-Output ($doctor | ConvertTo-Json -Depth 10)
    $refused = Invoke-Keyloom @('--data-dir', $data, 'build', 'missing-layout') 6
    if ($refused -notmatch 'platform_unavailable') { throw 'candidate admitted Docker build' }
    if ($Synthetic) {
        Copy-Item -LiteralPath (Join-Path $repo 'test\fixtures\oryx\synchronized') -Destination (Join-Path $scratch 'moonlander') -Recurse
        Copy-Item -LiteralPath (Join-Path $repo 'test\fixtures\zmk\glove80-template\glove80.keymap') -Destination (Join-Path $scratch 'glove80.keymap')
        $ids = @()
        foreach ($board in @('zsa/moonlander', 'moergo/glove80')) {
            $fixture = if ($board -eq 'zsa/moonlander') { Join-Path $scratch 'moonlander' } else { Join-Path $scratch 'glove80.keymap' }
            $imported = Invoke-Keyloom @('--synthetic-windows-command', '--data-dir', $data, 'import', '--board', $board, $fixture) | ConvertFrom-Json
            for ($i = 0; $i -lt 2; $i++) {
                $recorded = Invoke-Keyloom @('--synthetic-windows-command', '--data-dir', $data, 'lab', 'start', $imported.layout_id, '--text', 'a')
                # The real command prints its passage before its final JSON response.
                $result = $recorded.Substring($recorded.IndexOf('{')) | ConvertFrom-Json
                if ($result.key_events -ne 2 -or ($result.warnings -match 'Recording incomplete:')) { throw 'synthetic recording lost events' }
                $ids += $result.session_id
            }
        }
        $sessions = Invoke-Keyloom @('--data-dir', $data, 'lab', 'sessions') | ConvertFrom-Json
        if ($sessions.sessions.Count -ne 4 -or ($ids | Select-Object -Unique).Count -ne 4 -or ($sessions.sessions.incomplete -contains $true)) { throw 'stop/reopen did not persist all sessions' }
        $touch = Invoke-Keyloom @('--synthetic-windows-touch') | ConvertFrom-Json
        if (-not $touch.syntheticOnly -or ($touch.touchBauds -join ',') -ne '1200,1201') { throw 'synthetic touch failed' }
        Invoke-Keyloom @('--synthetic-windows-command', '--data-dir', $data, 'flash', '--reboot-only', '--board', 'zsa/moonlander') | Out-Null
        foreach ($half in @('left', 'right')) {
            $restart = Invoke-Keyloom @('--synthetic-windows-command', '--data-dir', $data, 'flash', '--reboot-only', '--board', 'moergo/glove80', '--half', $half) | ConvertFrom-Json
            if (-not $restart.transport_only) { throw 'ZMK restart claimed firmware confirmation' }
        }
        Write-Output '{"syntheticOnly":true,"terminalInput":"scripted","savedSessions":4,"rebootOnly":true}'

    }
} finally {
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
    if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force }
}
# Every check above passed. The last native command was the deliberate exit-6 refusal, and pwsh -Command would
# otherwise report that as this script's failure.
exit 0
