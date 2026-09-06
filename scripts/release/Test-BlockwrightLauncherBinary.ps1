[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Artifact,
    [Parameter(Mandatory = $true)][string]$Version,
    [ValidateSet("NotSigned", "Valid")][string]$ExpectedAuthenticodeStatus = "NotSigned",
    [string]$ExpectedThumbprint,
    [switch]$RequireTimestamp
)

$ErrorActionPreference = "Stop"
$builtInModuleRoot = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\Modules"
$securityModule = Join-Path $builtInModuleRoot "Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1"
$utilityModule = Join-Path $builtInModuleRoot "Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1"
foreach ($module in @($securityModule, $utilityModule)) {
    if (-not (Test-Path -LiteralPath $module -PathType Leaf)) { throw "A required built-in Windows PowerShell module is missing: $module" }
}
$previousModulePath = $env:PSModulePath
try {
    # npm is launched through cmd.exe on Windows and can pass PowerShell 7's
    # module roots into Windows PowerShell 5.1. Pinning the built-in module root
    # avoids loading incompatible duplicate type data during release checks.
    $env:PSModulePath = $builtInModuleRoot
    Import-Module $securityModule -ErrorAction Stop
    Import-Module $utilityModule -ErrorAction Stop
} finally {
    $env:PSModulePath = $previousModulePath
}
$artifactPath = [System.IO.Path]::GetFullPath($Artifact)
if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) { throw "Blockwright launcher is missing: $artifactPath" }
if ([System.IO.Path]::GetFileName($artifactPath) -cne "Blockwright.exe") { throw "The native launcher artifact must be named Blockwright.exe." }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Launcher version must be a stable major.minor.patch version." }

$bytes = [System.IO.File]::ReadAllBytes($artifactPath)
if ($bytes.Length -lt 512 -or $bytes[0] -ne 0x4d -or $bytes[1] -ne 0x5a) { throw "Blockwright.exe is not a valid PE image." }
$peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
if ($peOffset -lt 64 -or $peOffset -gt ($bytes.Length - 96) -or
    $bytes[$peOffset] -ne 0x50 -or $bytes[$peOffset + 1] -ne 0x45 -or $bytes[$peOffset + 2] -ne 0 -or $bytes[$peOffset + 3] -ne 0) {
    throw "Blockwright.exe has an invalid PE header."
}
$machine = [BitConverter]::ToUInt16($bytes, $peOffset + 4)
$subsystem = [BitConverter]::ToUInt16($bytes, $peOffset + 24 + 68)
if ($machine -ne 0x8664) { throw ("Blockwright.exe is not an x64 executable (PE machine 0x{0:x4})." -f $machine) }
if ($subsystem -ne 2) { throw "Blockwright.exe is not a Windows GUI (WinExe) application." }

$item = Get-Item -LiteralPath $artifactPath
$versionInfo = $item.VersionInfo
$expectedFileVersion = "$Version.0"
if ([string]$versionInfo.ProductName -cne "Blockwright") { throw "Blockwright.exe ProductName metadata is invalid." }
if ([string]$versionInfo.FileDescription -cne "Blockwright Windows Launcher") { throw "Blockwright.exe FileDescription metadata is invalid." }
if ([string]$versionInfo.CompanyName -cne "Blockwright Contributors") { throw "Blockwright.exe CompanyName metadata is invalid." }
if ([string]$versionInfo.FileVersion -cne $expectedFileVersion) { throw "Blockwright.exe FileVersion $($versionInfo.FileVersion) does not match $expectedFileVersion." }
if (-not ([string]$versionInfo.ProductVersion).StartsWith($Version, [StringComparison]::Ordinal)) { throw "Blockwright.exe ProductVersion $($versionInfo.ProductVersion) does not match $Version." }
$assemblyName = [System.Reflection.AssemblyName]::GetAssemblyName($artifactPath)
if ([string]$assemblyName.Name -cne "Blockwright") { throw "The launcher assembly identity is not Blockwright." }
if ([string]$assemblyName.Version -cne $expectedFileVersion) { throw "The launcher assembly version $($assemblyName.Version) does not match $expectedFileVersion." }

$signature = Get-AuthenticodeSignature -LiteralPath $artifactPath
if ([string]$signature.Status -cne $ExpectedAuthenticodeStatus) {
    throw "Blockwright.exe Authenticode status is $($signature.Status), expected $ExpectedAuthenticodeStatus."
}
$signerThumbprint = $null
$signerSubject = $null
$timestampCertificateSubject = $null
if ($ExpectedAuthenticodeStatus -eq "Valid") {
    if ($null -eq $signature.SignerCertificate) { throw "A valid Blockwright.exe signature did not expose a signer certificate." }
    $signerThumbprint = ([string]$signature.SignerCertificate.Thumbprint -replace '[^A-Fa-f0-9]', '').ToUpperInvariant()
    $signerSubject = [string]$signature.SignerCertificate.Subject
    if ([string]::IsNullOrWhiteSpace($ExpectedThumbprint)) { throw "Valid launcher verification requires an explicit expected publisher thumbprint." }
    $expected = ($ExpectedThumbprint -replace '[^A-Fa-f0-9]', '').ToUpperInvariant()
    if ($expected.Length -lt 40 -or $signerThumbprint -cne $expected) { throw "Blockwright.exe signer does not match the expected publisher thumbprint." }
    if ($null -ne $signature.TimeStamperCertificate) { $timestampCertificateSubject = [string]$signature.TimeStamperCertificate.Subject }
    if ($RequireTimestamp -and [string]::IsNullOrWhiteSpace($timestampCertificateSubject)) { throw "The valid Blockwright.exe signature is missing required timestamp-certificate proof." }
} elseif (-not [string]::IsNullOrWhiteSpace($ExpectedThumbprint)) {
    throw "An expected publisher thumbprint cannot be combined with an unsigned launcher expectation."
}

[pscustomobject][ordered]@{
    schemaVersion = 1
    file = "Blockwright.exe"
    sha256 = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
    sizeBytes = [long]$item.Length
    architecture = "x64"
    subsystem = "windows-gui"
    productName = [string]$versionInfo.ProductName
    fileDescription = [string]$versionInfo.FileDescription
    fileVersion = [string]$versionInfo.FileVersion
    productVersion = [string]$versionInfo.ProductVersion
    authenticode = if ($ExpectedAuthenticodeStatus -eq "Valid") { "valid" } else { "not-signed" }
    signerThumbprint = $signerThumbprint
    signerSubject = $signerSubject
    timestampCertificateSubject = $timestampCertificateSubject
} | ConvertTo-Json -Compress
