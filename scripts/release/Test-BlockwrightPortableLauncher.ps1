[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PortableZip,
    [Parameter(Mandatory = $true)][string]$Version,
    [ValidateSet("NotSigned", "Valid")][string]$ExpectedAuthenticodeStatus = "NotSigned",
    [string]$ExpectedThumbprint,
    [switch]$RequireTimestamp
)

$ErrorActionPreference = "Stop"
$portablePath = [System.IO.Path]::GetFullPath($PortableZip)
if (-not (Test-Path -LiteralPath $portablePath -PathType Leaf) -or [System.IO.Path]::GetExtension($portablePath) -cne ".zip") {
    throw "Portable launcher verification requires an existing .zip artifact."
}
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("Blockwright Portable Launcher " + [guid]::NewGuid().ToString("N"))
$launcherPath = Join-Path $testRoot "Blockwright.exe"
$archive = $null
$input = $null
$output = $null
try {
    $null = New-Item -ItemType Directory -Path $testRoot
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($portablePath)
    $entries = @($archive.Entries | Where-Object { ([string]$_.FullName).Replace('\', '/') -ceq "Blockwright/Blockwright.exe" })
    if ($entries.Count -ne 1) { throw "Portable ZIP must contain exactly one Blockwright/Blockwright.exe entry." }
    $entry = $entries[0]
    if ([long]$entry.Length -lt 512 -or [long]$entry.Length -gt 16777216) { throw "Packaged Blockwright.exe is outside the 512-byte to 16-MiB launcher bound." }
    $input = $entry.Open()
    $output = [System.IO.File]::Open($launcherPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    $input.CopyTo($output)
    $output.Dispose(); $output = $null
    $input.Dispose(); $input = $null
    $archive.Dispose(); $archive = $null

    $arguments = @(
        "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
        (Join-Path $PSScriptRoot "Test-BlockwrightLauncherBinary.ps1"),
        "-Artifact", $launcherPath,
        "-Version", $Version,
        "-ExpectedAuthenticodeStatus", $ExpectedAuthenticodeStatus
    )
    if (-not [string]::IsNullOrWhiteSpace($ExpectedThumbprint)) { $arguments += @("-ExpectedThumbprint", $ExpectedThumbprint) }
    if ($RequireTimestamp) { $arguments += "-RequireTimestamp" }
    $powershell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $evidenceText = & $powershell $arguments
    if ($LASTEXITCODE -ne 0) { throw "Packaged native launcher validation failed with exit code $LASTEXITCODE." }
    $evidence = $evidenceText | ConvertFrom-Json
    [pscustomobject][ordered]@{
        schemaVersion = 1
        container = [System.IO.Path]::GetFileName($portablePath)
        entry = "Blockwright/Blockwright.exe"
        sha256 = [string]$evidence.sha256
        sizeBytes = [long]$evidence.sizeBytes
        fileVersion = [string]$evidence.fileVersion
        authenticode = [string]$evidence.authenticode
        signerThumbprint = $evidence.signerThumbprint
        timestampCertificateSubject = $evidence.timestampCertificateSubject
    } | ConvertTo-Json -Compress
} finally {
    if ($null -ne $output) { $output.Dispose() }
    if ($null -ne $input) { $input.Dispose() }
    if ($null -ne $archive) { $archive.Dispose() }
    if (Test-Path -LiteralPath $launcherPath -PathType Leaf) { Remove-Item -LiteralPath $launcherPath -Force }
    if (Test-Path -LiteralPath $testRoot -PathType Container) { Remove-Item -LiteralPath $testRoot -Force }
}
