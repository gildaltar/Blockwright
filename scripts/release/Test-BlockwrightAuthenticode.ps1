[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Artifact,
    [Parameter(Mandatory = $true)][string]$ExpectedThumbprint,
    [Parameter(Mandatory = $true)][string]$ProofPath,
    [Parameter(Mandatory = $true)][string]$StatusPath,
    [Parameter(Mandatory = $true)][string]$Version
)

$ErrorActionPreference = "Stop"
$artifactPath = [System.IO.Path]::GetFullPath($Artifact)
if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf) -or [System.IO.Path]::GetExtension($artifactPath) -ne ".exe") { throw "Authenticode artifact must be an existing .exe file." }
$expected = ($ExpectedThumbprint -replace '[^A-Fa-f0-9]', '').ToUpperInvariant()
if ($expected.Length -lt 40) { throw "Expected publisher thumbprint is invalid." }
$signature = Get-AuthenticodeSignature -LiteralPath $artifactPath
if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or $null -eq $signature.SignerCertificate) { throw "Authenticode status is $($signature.Status), not Valid." }
$timestampCertificateSubject = if ($null -eq $signature.TimeStamperCertificate) { "" } else { [string]$signature.TimeStamperCertificate.Subject }
if ([string]::IsNullOrWhiteSpace($timestampCertificateSubject)) { throw "The valid Authenticode signature is missing required timestamp-certificate proof." }
$actual = ([string]$signature.SignerCertificate.Thumbprint -replace '[^A-Fa-f0-9]', '').ToUpperInvariant()
if ($actual -ne $expected) { throw "Valid Authenticode signature does not match the configured publisher thumbprint." }
$hash = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
$proof = [ordered]@{ schemaVersion = 1; file = [System.IO.Path]::GetFileName($artifactPath); sha256 = $hash; status = "Valid"; signerThumbprint = $actual; signerSubject = [string]$signature.SignerCertificate.Subject; timestampCertificateSubject = $timestampCertificateSubject }
$status = [ordered]@{ schemaVersion = 1; version = $Version; generatedAt = [datetimeoffset]::UtcNow.ToString("o"); status = "signed"; satisfiesSignedReleaseGate = $true; artifacts = @([ordered]@{ file = [System.IO.Path]::GetFileName($artifactPath); sha256 = $hash; authenticode = "valid"; signerThumbprint = $actual }) }
[System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($ProofPath), (($proof | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
[System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($StatusPath), (($status | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
Write-Output "Verified trusted Authenticode signature and wrote release proof without exposing certificate secrets."
