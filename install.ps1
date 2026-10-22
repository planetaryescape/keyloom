# Per-user Windows x64 installation. No elevation or execution-policy changes.
[CmdletBinding()]
param(
    [ValidatePattern('^v[0-9]+\.[0-9]+\.[0-9]+$')][string]$Version,
    [switch]$AddToPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-ReleaseFile([string]$Url, [string]$Destination) {
    $uri = [Uri]$Url
    if ($uri.IsFile) {
        Copy-Item -LiteralPath $uri.LocalPath -Destination $Destination
    } else {
        if ($uri.Scheme -ne 'https') { throw 'Release downloads require HTTPS (or file:// for a local mirror).' }
        Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $Destination
    }
}

$staging = $null
$previous = $null
try {
    if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
        throw 'keyloom releases support Windows x64 only.'
    }
    $base = if ($env:KEYLOOM_DOWNLOAD_BASE) { $env:KEYLOOM_DOWNLOAD_BASE.TrimEnd('/') } else { 'https://github.com/planetaryescape/keyloom/releases' }
    $installDir = if ($env:KEYLOOM_INSTALL_DIR) { $env:KEYLOOM_INSTALL_DIR } else {
        if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is not set; specify KEYLOOM_INSTALL_DIR.' }
        Join-Path $env:LOCALAPPDATA 'Programs\keyloom'
    }
    $installDir = [IO.Path]::GetFullPath($installDir)
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    if (-not $Version) {
        if (([Uri]$base).Scheme -ne 'https') { throw 'Use -Version vX.Y.Z with a local release mirror.' }
        # Resolve latest once so the executable and its checksum belong to the same tag.
        $request = [Net.WebRequest]::Create("$base/latest")
        $response = $request.GetResponse()
        try { $Version = $response.ResponseUri.Segments[-1] } finally { $response.Close() }
        if ($Version -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+$') { throw "Unexpected latest release tag: $Version" }
    }
    [IO.Directory]::CreateDirectory($installDir) | Out-Null
    # Stage on the destination filesystem so publication uses rename, including paths with spaces/Unicode.
    $staging = Join-Path $installDir ('.install-' + [Guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($staging) | Out-Null
    $asset = 'keyloom-windows-x64.exe'
    $download = Join-Path $staging $asset
    $sums = Join-Path $staging 'SHA256SUMS'
    Get-ReleaseFile "$base/download/$Version/$asset" $download
    Get-ReleaseFile "$base/download/$Version/SHA256SUMS" $sums
    $hashes = @(Get-Content -LiteralPath $sums | ForEach-Object {
        if ($_ -match '^([a-fA-F0-9]{64})\s+\*?keyloom-windows-x64\.exe$') { $Matches[1] }
    })
    if ($hashes.Count -ne 1) { throw "SHA256SUMS must contain exactly one checksum for $asset. Nothing was installed." }
    $actual = (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash
    if ($actual -ne $hashes[0]) { throw "Checksum mismatch for $asset. Nothing was installed." }
    $destination = Join-Path $installDir 'keyloom.exe'
    if (Test-Path -LiteralPath $destination) {
        $previous = Join-Path $installDir ('keyloom.previous-' + [Guid]::NewGuid().ToString('N') + '.exe')
        try { [IO.File]::Move($destination, $previous) } catch {
            throw "Cannot replace $destination. Close running keyloom processes and retry, or set KEYLOOM_INSTALL_DIR to another directory. $($_.Exception.Message)"
        }
    }
    try { [IO.File]::Move($download, $destination) } catch {
        if ($previous -and -not (Test-Path -LiteralPath $destination)) { [IO.File]::Move($previous, $destination); $previous = $null }
        throw "Cannot install $destination. Close running keyloom processes and retry. $($_.Exception.Message)"
    }
    if ($previous) {
        try { Remove-Item -LiteralPath $previous } catch {
            Write-Warning "The previous executable is still in use at $previous. Remove it after keyloom exits."
        }
    }
    if ($AddToPath) {
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        $entries = @($userPath -split ';' | Where-Object { $_ })
        if (-not ($entries | Where-Object { $_.TrimEnd('\') -ieq $installDir.TrimEnd('\') })) {
            [Environment]::SetEnvironmentVariable('Path', (($entries + $installDir) -join ';'), 'User')
        }
        Write-Output 'User PATH updated. Open a new terminal to use keyloom.'
    } else {
        Write-Output "To add keyloom to your user PATH, rerun install.ps1 -Version $Version -AddToPath, or add this directory in Environment Variables: $installDir"
    }
    Write-Output "Installed keyloom $Version to $destination"
    Write-Output 'Windows executables are unsigned; SmartScreen or antivirus may warn or block them. Keep Windows protections enabled.'
} catch {
    Write-Error -ErrorAction Continue "install.ps1: $($_.Exception.Message)"
    exit 1
} finally {
    if ($staging -and (Test-Path -LiteralPath $staging)) { Remove-Item -LiteralPath $staging -Recurse -Force }
}
