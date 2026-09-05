[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$CompilerPath,
    [string]$ConfigPath,
    [switch]$PassThru
)

$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") { throw "Pinned Inno Setup verification requires Windows Authenticode support." }
if ([string]::IsNullOrWhiteSpace($ConfigPath)) { $ConfigPath = Join-Path $PSScriptRoot "windows-release.json" }
$resolvedConfigPath = [System.IO.Path]::GetFullPath($ConfigPath)
if (-not (Test-Path -LiteralPath $resolvedConfigPath -PathType Leaf)) { throw "Windows release configuration is missing: $resolvedConfigPath" }
$config = [System.IO.File]::ReadAllText($resolvedConfigPath) | ConvertFrom-Json
$toolchain = $config.innoSetup
if ($null -eq $toolchain) { throw "The Windows release configuration does not define a pinned Inno Setup toolchain." }
$securityModule = Join-Path $PSHOME "Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1"
Import-Module $securityModule -ErrorAction Stop

function Get-Sha256Hex {
    param([Parameter(Mandatory = $true)][string]$Path)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace("-", "").ToLowerInvariant() } finally { $stream.Dispose(); $algorithm.Dispose() }
}

$resolvedCompiler = [System.IO.Path]::GetFullPath($CompilerPath)
if (-not (Test-Path -LiteralPath $resolvedCompiler -PathType Leaf)) { throw "Pinned Inno Setup compiler is missing: $resolvedCompiler" }
$compiler = Get-Item -LiteralPath $resolvedCompiler
if ($compiler.Length -ne [long]$toolchain.compilerSizeBytes) {
    throw "Pinned Inno Setup compiler byte size mismatch. Expected $($toolchain.compilerSizeBytes); received $($compiler.Length)."
}
$actualHash = Get-Sha256Hex -Path $resolvedCompiler
$expectedHash = ([string]$toolchain.compilerSha256).ToLowerInvariant()
if ($actualHash -ne $expectedHash) { throw "Pinned Inno Setup compiler SHA-256 mismatch. Expected $expectedHash; received $actualHash." }

$signature = Get-AuthenticodeSignature -LiteralPath $resolvedCompiler
if ([string]$signature.Status -ne "Valid" -or $null -eq $signature.SignerCertificate) {
    throw "Pinned Inno Setup compiler Authenticode signature is not valid: $($signature.Status)."
}
$actualThumbprint = (($signature.SignerCertificate.Thumbprint -replace '[^A-Fa-f0-9]', '')).ToUpperInvariant()
$expectedThumbprint = (([string]$toolchain.publisherThumbprint -replace '[^A-Fa-f0-9]', '')).ToUpperInvariant()
if ($actualThumbprint -ne $expectedThumbprint) {
    throw "Pinned Inno Setup compiler signer thumbprint mismatch. Expected $expectedThumbprint; received $actualThumbprint."
}
if (-not [string]::Equals($signature.SignerCertificate.Subject, [string]$toolchain.publisherSubject, [StringComparison]::Ordinal)) {
    throw "Pinned Inno Setup compiler publisher subject mismatch."
}
if ([bool]$toolchain.requireTimestamp -and $null -eq $signature.TimeStamperCertificate) {
    throw "Pinned Inno Setup compiler is missing the required Authenticode timestamp."
}

$result = [pscustomobject]@{
    Valid = $true
    Version = [string]$toolchain.version
    CompilerPath = $resolvedCompiler
    Bytes = [long]$compiler.Length
    Sha256 = $actualHash
    PublisherSubject = $signature.SignerCertificate.Subject
    PublisherThumbprint = $actualThumbprint
    TimestampSubject = if ($null -ne $signature.TimeStamperCertificate) { $signature.TimeStamperCertificate.Subject } else { $null }
}
if ($PassThru) { $result } else { $result | ConvertTo-Json -Compress }
