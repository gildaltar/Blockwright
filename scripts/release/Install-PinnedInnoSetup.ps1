[CmdletBinding()]
param(
    [string]$DestinationRoot,
    [string]$InstallerPath,
    [switch]$PassThru
)

$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") { throw "Pinned Inno Setup acquisition requires Windows." }
$resolvedConfigPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "windows-release.json"))
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

function Test-StrictChildPath {
    param([Parameter(Mandatory = $true)][string]$Parent, [Parameter(Mandatory = $true)][string]$Candidate)
    $parentPath = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    $candidatePath = [System.IO.Path]::GetFullPath($Candidate)
    return $candidatePath.StartsWith($parentPath, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-PublisherSignature {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)]$Expected)
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ([string]$signature.Status -ne "Valid" -or $null -eq $signature.SignerCertificate) {
        throw "Pinned Inno Setup installer Authenticode signature is not valid: $($signature.Status)."
    }
    $actualThumbprint = (($signature.SignerCertificate.Thumbprint -replace '[^A-Fa-f0-9]', '')).ToUpperInvariant()
    $expectedThumbprint = (([string]$Expected.publisherThumbprint -replace '[^A-Fa-f0-9]', '')).ToUpperInvariant()
    if ($actualThumbprint -ne $expectedThumbprint) { throw "Pinned Inno Setup installer signer thumbprint mismatch." }
    if (-not [string]::Equals($signature.SignerCertificate.Subject, [string]$Expected.publisherSubject, [StringComparison]::Ordinal)) {
        throw "Pinned Inno Setup installer publisher subject mismatch."
    }
    if ([bool]$Expected.requireTimestamp -and $null -eq $signature.TimeStamperCertificate) {
        throw "Pinned Inno Setup installer is missing the required Authenticode timestamp."
    }
    return $signature
}

function Assert-PinnedInstaller {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)]$Expected)
    $resolvedPath = [System.IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $resolvedPath -PathType Leaf)) { throw "Pinned Inno Setup installer is missing: $resolvedPath" }
    $item = Get-Item -LiteralPath $resolvedPath
    if ($item.Length -ne [long]$Expected.sizeBytes) {
        throw "Pinned Inno Setup installer byte size mismatch. Expected $($Expected.sizeBytes); received $($item.Length)."
    }
    $actualHash = Get-Sha256Hex -Path $resolvedPath
    $expectedHash = ([string]$Expected.sha256).ToLowerInvariant()
    if ($actualHash -ne $expectedHash) { throw "Pinned Inno Setup installer SHA-256 mismatch. Expected $expectedHash; received $actualHash." }
    $productVersion = (Get-Item -LiteralPath $resolvedPath).VersionInfo.ProductVersion.Trim()
    if ($productVersion -ne [string]$Expected.productVersion) {
        throw "Pinned Inno Setup installer ProductVersion mismatch. Expected $($Expected.productVersion); received $productVersion."
    }
    $signature = Assert-PublisherSignature -Path $resolvedPath -Expected $Expected
    return [pscustomobject]@{ Path = $resolvedPath; Bytes = [long]$item.Length; Sha256 = $actualHash; Signature = $signature }
}

function Receive-BoundedHttpsFile {
    param(
        [Parameter(Mandatory = $true)][uri]$Uri,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][long]$ExpectedBytes,
        [Parameter(Mandatory = $true)][long]$MaximumBytes,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )
    if ($Uri.Scheme -ne "https") { throw "Pinned Inno Setup acquisition requires HTTPS." }
    Add-Type -AssemblyName System.Net.Http
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [System.Threading.Timeout]::InfiniteTimeSpan
    $cancellation = [System.Threading.CancellationTokenSource]::new()
    $cancellation.CancelAfter([TimeSpan]::FromSeconds($TimeoutSeconds))
    $response = $null
    $contentStream = $null
    $fileStream = $null
    try {
        $current = $Uri
        for ($redirectCount = 0; $true; $redirectCount++) {
            if ($current.Scheme -ne "https") { throw "Pinned Inno Setup redirect left HTTPS." }
            $response = $client.GetAsync($current, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead, $cancellation.Token).GetAwaiter().GetResult()
            $statusCode = [int]$response.StatusCode
            if ($statusCode -ge 300 -and $statusCode -lt 400) {
                if ($redirectCount -ge 4 -or $null -eq $response.Headers.Location) { throw "Pinned Inno Setup download exceeded the HTTPS redirect limit." }
                $next = if ($response.Headers.Location.IsAbsoluteUri) { $response.Headers.Location } else { [uri]::new($current, $response.Headers.Location) }
                $response.Dispose()
                $response = $null
                $current = $next
                continue
            }
            break
        }
        if (-not $response.IsSuccessStatusCode) { throw "Pinned Inno Setup download failed with HTTP $([int]$response.StatusCode)." }
        if ($response.Content.Headers.ContentEncoding.Count -gt 0) { throw "Pinned Inno Setup download must not use compressed HTTP content encoding." }
        if ($null -ne $response.Content.Headers.ContentLength) {
            $contentLength = [long]$response.Content.Headers.ContentLength
            if ($contentLength -ne $ExpectedBytes -or $contentLength -gt $MaximumBytes) {
                throw "Pinned Inno Setup Content-Length $contentLength does not match the expected $ExpectedBytes bytes."
            }
        }
        $contentStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $fileStream = [System.IO.File]::Open($Destination, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        $buffer = New-Object byte[] 81920
        [long]$received = 0
        while (($read = $contentStream.ReadAsync($buffer, 0, $buffer.Length, $cancellation.Token).GetAwaiter().GetResult()) -gt 0) {
            $received += $read
            if ($received -gt $MaximumBytes) { throw "Pinned Inno Setup download exceeded $MaximumBytes bytes." }
            $fileStream.Write($buffer, 0, $read)
        }
        $fileStream.Flush()
        if ($received -ne $ExpectedBytes) { throw "Pinned Inno Setup byte size mismatch. Expected $ExpectedBytes; received $received." }
    } finally {
        if ($null -ne $fileStream) { $fileStream.Dispose() }
        if ($null -ne $contentStream) { $contentStream.Dispose() }
        if ($null -ne $response) { $response.Dispose() }
        $cancellation.Dispose()
        $client.Dispose()
        $handler.Dispose()
    }
}

$temporaryParent = if (-not [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) { [System.IO.Path]::GetFullPath($env:RUNNER_TEMP) } else { [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()) }
if ([string]::IsNullOrWhiteSpace($DestinationRoot)) {
    $DestinationRoot = Join-Path $temporaryParent ("blockwright-inno-{0}-{1}" -f $toolchain.version, [guid]::NewGuid().ToString("N"))
}
$resolvedDestinationRoot = [System.IO.Path]::GetFullPath($DestinationRoot)
$allowedParents = @($temporaryParent, [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())) | Select-Object -Unique
if (-not @($allowedParents | Where-Object { Test-StrictChildPath -Parent $_ -Candidate $resolvedDestinationRoot }).Count) {
    throw "Pinned Inno Setup must be acquired beneath RUNNER_TEMP or the current user's temporary directory: $resolvedDestinationRoot"
}
if (Test-Path -LiteralPath $resolvedDestinationRoot) { throw "Pinned Inno Setup destination must be a fresh path: $resolvedDestinationRoot" }
$null = New-Item -ItemType Directory -Path $resolvedDestinationRoot

$downloadedInstaller = $false
if ([string]::IsNullOrWhiteSpace($InstallerPath)) {
    $InstallerPath = Join-Path $resolvedDestinationRoot ([string]$toolchain.installer)
    Receive-BoundedHttpsFile -Uri ([uri]$toolchain.url) -Destination $InstallerPath -ExpectedBytes ([long]$toolchain.sizeBytes) -MaximumBytes ([long]$toolchain.maxSizeBytes) -TimeoutSeconds ([int]$toolchain.timeoutSeconds)
    $downloadedInstaller = $true
}
$verifiedInstaller = Assert-PinnedInstaller -Path $InstallerPath -Expected $toolchain

$compilerRoot = Join-Path $resolvedDestinationRoot "compiler"
$arguments = '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CURRENTUSER /DIR="' + $compilerRoot + '"'
$process = Start-Process -FilePath $verifiedInstaller.Path -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
if ($process.ExitCode -ne 0) { throw "Pinned Inno Setup installer exited with code $($process.ExitCode)." }
$compilerPath = [System.IO.Path]::GetFullPath((Join-Path $resolvedDestinationRoot ([string]$toolchain.compilerRelativePath)))
if (-not (Test-StrictChildPath -Parent $resolvedDestinationRoot -Candidate $compilerPath)) { throw "Pinned Inno Setup compiler path escaped its fresh acquisition root." }
$verifiedCompiler = & (Join-Path $PSScriptRoot "Test-PinnedInnoSetup.ps1") -CompilerPath $compilerPath -PassThru

$result = [pscustomobject]@{
    Valid = $true
    Version = [string]$toolchain.version
    AcquisitionRoot = $resolvedDestinationRoot
    InstallerPath = $verifiedInstaller.Path
    InstallerWasDownloaded = $downloadedInstaller
    InstallerSha256 = $verifiedInstaller.Sha256
    CompilerPath = $verifiedCompiler.CompilerPath
    CompilerSha256 = $verifiedCompiler.Sha256
    PublisherSubject = $verifiedCompiler.PublisherSubject
    PublisherThumbprint = $verifiedCompiler.PublisherThumbprint
}
if ($PassThru) { $result } else { $result | ConvertTo-Json -Compress }
