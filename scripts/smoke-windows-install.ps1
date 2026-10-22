# Native installed journey only: diagnostics helper has no device capabilities.
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Binary)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = Split-Path $PSScriptRoot -Parent
$binaryPath = (Resolve-Path -LiteralPath $Binary).Path
$version = (Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('keyloom space ' + [char]0x00e9 + '-' + [Guid]::NewGuid().ToString('N'))
$saved = @{}
foreach ($name in @('LOCALAPPDATA', 'KEYLOOM_INSTALL_DIR', 'KEYLOOM_DOWNLOAD_BASE', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'PATH')) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$parents = @()
$userPathBefore = [Environment]::GetEnvironmentVariable('Path', 'User')
function Invoke-Keyloom([string[]]$CliArgs, [int]$Expected = 0) {
    $output = & $script:installed @CliArgs 2>&1 | Out-String
    if ($LASTEXITCODE -ne $Expected) { throw "exit $LASTEXITCODE expected $Expected for $CliArgs`: $output" }
    return $output
}
try {
    [IO.Directory]::CreateDirectory($scratch) | Out-Null
    $env:LOCALAPPDATA = $scratch
    $env:ANTHROPIC_API_KEY = ''
    $env:OPENROUTER_API_KEY = ''
    $env:KEYLOOM_INSTALL_DIR = Join-Path $scratch 'Programs\keyloom'
    $mirror = Join-Path $scratch "mirror\download\v$version"
    [IO.Directory]::CreateDirectory($mirror) | Out-Null
    $asset = 'keyloom-windows-x64.exe'
    Copy-Item -LiteralPath $binaryPath -Destination (Join-Path $mirror $asset)
    $sums = Join-Path $mirror 'SHA256SUMS'
    Set-Content -LiteralPath $sums -Value ((Get-FileHash -LiteralPath $binaryPath -Algorithm SHA256).Hash + "  $asset") -Encoding Ascii
    $env:KEYLOOM_DOWNLOAD_BASE = ([Uri]((Join-Path $scratch 'mirror') + '\')).AbsoluteUri.TrimEnd('/')
    $installer = Join-Path $repo 'install.ps1'
    # A child process contains the installer's explicit failure exit.
    $shell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    & $shell -NoProfile -File $installer -Version "v$version"
    if ($LASTEXITCODE -ne 0) { throw 'installer failed' }
    $script:installed = Join-Path $env:KEYLOOM_INSTALL_DIR 'keyloom.exe'
    if ([Environment]::GetEnvironmentVariable('Path', 'User') -cne $userPathBefore) { throw 'installer changed PATH without -AddToPath' }
    $lock = [IO.File]::Open($script:installed, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        $locked = & $shell -NoProfile -File $installer -Version "v$version" 2>&1 | Out-String
        if ($LASTEXITCODE -eq 0 -or $locked -notmatch 'Close running keyloom processes') { throw 'locked executable was not refused clearly' }
    } finally { $lock.Dispose() }
    & $shell -NoProfile -File $installer -Version "v$version"
    if ($LASTEXITCODE -ne 0) { throw 'update after releasing exe lock failed' }
    # No Bun, Rust, WSL or Docker on the runtime path, and nothing read from the checkout: fixtures are copied into scratch.
    $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot\System32\WindowsPowerShell\v1.0"
    Copy-Item -LiteralPath (Join-Path $repo 'test\fixtures\oryx\synchronized') -Destination (Join-Path $scratch 'layout') -Recurse
    Copy-Item -LiteralPath (Join-Path $repo 'test\fixtures\windows\set-key-6-f17.json') -Destination (Join-Path $scratch 'set-key-6-f17.json')
    Push-Location -LiteralPath $scratch
    # stdout only: anything on stderr is reported, not compared.
    $versionErr = Join-Path $scratch 'version.err'
    $versionOut = Join-Path $scratch 'version.out'
    $viaFile = Start-Process -FilePath $script:installed -ArgumentList '--version' -NoNewWindow -Wait -PassThru -RedirectStandardOutput $versionOut -RedirectStandardError $versionErr
    $viaCmd = (& cmd.exe /d /c "`"$script:installed`" --version" 2>&1 | Out-String).Trim()
    Write-Output "version via file: exit $($viaFile.ExitCode) stdout '$((Get-Content -LiteralPath $versionOut -Raw))' stderr '$((Get-Content -LiteralPath $versionErr -Raw))'; via cmd: '$viaCmd'"
    $printed = (& $script:installed --version 2> $versionErr | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $printed -ne $version) { throw "wrong version: stdout '$printed', stderr '$((Get-Content -LiteralPath $versionErr -Raw))', exit $LASTEXITCODE" }
    $data = Join-Path $scratch 'data'
    for ($i = 0; $i -lt 8; $i++) {
        $stdout = Join-Path $scratch "cold-$i.json"
        $stderr = Join-Path $scratch "cold-$i.err"
        $child = Start-Process -FilePath $script:installed -ArgumentList @('--data-dir', ('"{0}"' -f $data), 'doctor', '--device-helper-only', '--format', 'json') -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        $parents += @{ child = $child; stdout = $stdout; stderr = $stderr }
    }
    foreach ($parent in $parents) {
        if (-not $parent.child.WaitForExit(60000)) { $parent.child.Kill(); throw 'concurrent doctor timed out' }
        $cold = Get-Content -LiteralPath $parent.stdout -Raw | ConvertFrom-Json
        if ($parent.child.ExitCode -ne 0 -or -not $cold.ok -or $cold.checks[0].deviceHelper.capabilities.Count -ne 0) { throw "concurrent extraction failed: $(Get-Content -LiteralPath $parent.stderr -Raw)" }
    }
    $doctor = Invoke-Keyloom @('--data-dir', $data, 'doctor', '--device-helper-only', '--format', 'json') | ConvertFrom-Json
    $info = $doctor.checks[0].deviceHelper
    if (-not $doctor.ok -or -not $info.available -or $info.capabilities.Count -ne 0 -or $info.target -ne 'x86_64-pc-windows-msvc' -or $doctor.checks.Count -ne 1) { throw 'invalid diagnostics-only pair' }
    Write-Output ($doctor | ConvertTo-Json -Depth 10)
    $full = Invoke-Keyloom @('--data-dir', $data, 'doctor', '--format', 'json') | ConvertFrom-Json
    if (-not $full.ok -or -not ($full.checks.detail -match 'not available on Windows yet')) { throw 'doctor did not report unsupported components' }
    $import = Invoke-Keyloom @('--data-dir', $data, 'import', '--board', 'zsa/moonlander', (Join-Path $scratch 'layout'), '--format', 'json') | ConvertFrom-Json
    Invoke-Keyloom @('--data-dir', $data, 'layout', 'show', $import.layout_id) | Out-Null
    Invoke-Keyloom @('--data-dir', $data, 'boards', 'list') | Out-Null
    # The editing loop on Windows: check, propose, apply, then read the changed key back.
    $ops = Join-Path $scratch 'set-key-6-f17.json'
    Invoke-Keyloom @('--data-dir', $data, 'change', 'check', $import.layout_id, '--ops', $ops) | Out-Null
    $proposed = Invoke-Keyloom @('--data-dir', $data, 'change', 'propose', $import.layout_id, '--ops', $ops, '--explain', 'F17 on key 6', '--format', 'json') | ConvertFrom-Json
    Invoke-Keyloom @('--data-dir', $data, 'change', 'apply', $proposed.change_set_id, '--format', 'json') | Out-Null
    $shown = Invoke-Keyloom @('--data-dir', $data, 'layout', 'show', $import.layout_id, '--layer', 'layer-0', '--format', 'json') | ConvertFrom-Json
    $key = $shown.layout.layers[0].bindings[6]
    if ($key.kind -ne 'key' -or $key.code -ne 'F17') { throw "applied change did not read back: $($key | ConvertTo-Json -Compress)" }
    Invoke-Keyloom @('--data-dir', $data, 'change', 'list', $import.layout_id) | Out-Null
    $unsupported = Invoke-Keyloom @('--data-dir', $data, 'build', $import.layout_id, '--format', 'json') 6
    if ($unsupported -notmatch 'not available on Windows yet' -or $unsupported -notmatch 'keyloom build' -or $unsupported -notmatch 'rung-24f') { throw "bad unsupported diagnostic: $unsupported" }
    # Reinstall must refuse a bad checksum and preserve the installed executable.
    $before = (Get-FileHash -LiteralPath $script:installed -Algorithm SHA256).Hash
    Set-Content -LiteralPath $sums -Value (('0' * 64) + "  $asset") -Encoding Ascii
    $failure = & $shell -NoProfile -File $installer -Version "v$version" 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0 -or $failure -notmatch 'Checksum mismatch' -or (Get-FileHash -LiteralPath $script:installed -Algorithm SHA256).Hash -ne $before) { throw 'checksum mismatch was not refused safely' }
    Set-Content -LiteralPath $sums -Value ((Get-FileHash -LiteralPath $binaryPath -Algorithm SHA256).Hash + "  $asset") -Encoding Ascii
    for ($i = 0; $i -lt 2; $i++) {
        & $shell -NoProfile -File $installer -Version "v$version" -AddToPath
        if ($LASTEXITCODE -ne 0) { throw 'explicit PATH installation failed' }
    }
    $pathAfter = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (@($pathAfter -split ';' | Where-Object { $_ -ieq $env:KEYLOOM_INSTALL_DIR }).Count -ne 1) { throw 'PATH entry missing or duplicated' }
    foreach ($entry in @($userPathBefore -split ';' | Where-Object { $_ })) {
        if (@($pathAfter -split ';') -notcontains $entry) { throw 'installer lost an existing PATH entry' }
    }
    # Corrupt cached bytes must fail on the next spawn while layout editing still works.
    $helper = Join-Path $scratch "keyloom\device-helper\$version\$($info.target)\$($info.helperSha256)\keyloom-device.exe"
    [IO.File]::WriteAllText($helper, 'corrupt isolated helper')
    $refused = Invoke-Keyloom @('--data-dir', $data, 'doctor', '--device-helper-only', '--format', 'json') 1 | ConvertFrom-Json
    if ($refused.checks[0].deviceHelper.code -ne 'integrity_error') { throw 'helper corruption was not refused' }
    Invoke-Keyloom @('--data-dir', $data, 'layout', 'show', $import.layout_id) | Out-Null
    Write-Output 'Windows installed diagnostics, import/layout/boards, change check/propose/apply with read-back, unsupported workflow, checksum and cache corruption checks passed.'
} finally {
    if ((Get-Location).Path -eq $scratch) { Pop-Location }
    foreach ($parent in $parents) {
        if (-not $parent.child.HasExited) { $parent.child.Kill(); $parent.child.WaitForExit() }
        $parent.child.Dispose()
    }
    [Environment]::SetEnvironmentVariable('Path', $userPathBefore, 'User')
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
    Remove-Item -LiteralPath $scratch -Recurse -Force
}
