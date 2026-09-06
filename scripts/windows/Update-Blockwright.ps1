[CmdletBinding()]
param(
    [string]$InstallRoot,
    [string]$StateRoot,
    [string]$MetadataUri,
    [string]$TrustedPublisherThumbprint,
    [switch]$CheckOnly,
    [switch]$AllowDowngrade,
    [switch]$SelfTest,
    [switch]$NoRelaunch,
    [switch]$PassThru
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0
Import-Module (Join-Path $PSScriptRoot "Blockwright-Paths.psm1") -Force
$resolvedInstallRoot = Resolve-BlockwrightInstallRoot -InstallRoot $InstallRoot
$resolvedStateRoot = Get-BlockwrightStateRoot -InstallRoot $resolvedInstallRoot -StateRoot $StateRoot

function ConvertTo-BlockwrightSemanticVersion {
    param([Parameter(Mandatory = $true)][string]$Value, [string]$Label = "version")
    $match = [regex]::Match($Value.Trim(), '^v?(\d+)\.(\d+)\.(\d+)$')
    if (-not $match.Success) { throw "$Label must be a stable semantic version in major.minor.patch form; received '$Value'." }
    $canonical = "{0}.{1}.{2}" -f [int]$match.Groups[1].Value, [int]$match.Groups[2].Value, [int]$match.Groups[3].Value
    return [pscustomobject]@{ Canonical = $canonical; Value = [version]$canonical }
}

function Get-InstalledBlockwrightVersion {
    foreach ($path in @((Join-Path $resolvedInstallRoot "release-manifest.json"), (Join-Path $resolvedInstallRoot "app\package.json"))) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
        try {
            $document = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
            if (-not [string]::IsNullOrWhiteSpace([string]$document.version)) { return [string]$document.version }
        } catch { throw "Installed version metadata is unreadable: $path" }
    }
    throw "Installed Blockwright version could not be established, so downgrade protection cannot be enforced."
}

function Assert-InstallerProductVersion {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$ExpectedVersion)
    $expected = ConvertTo-BlockwrightSemanticVersion -Value $ExpectedVersion -Label "metadata version"
    $productVersion = [string](Get-Item -LiteralPath $Path).VersionInfo.ProductVersion
    $match = [regex]::Match($productVersion, '^(\d+)\.(\d+)\.(\d+)(?:\.\d+)?(?:\D|$)')
    if (-not $match.Success) { throw "Downloaded installer does not expose a usable ProductVersion." }
    $actual = "{0}.{1}.{2}" -f [int]$match.Groups[1].Value, [int]$match.Groups[2].Value, [int]$match.Groups[3].Value
    if ($actual -ne $expected.Canonical) { throw "Downloaded installer ProductVersion $actual does not match update metadata $($expected.Canonical)." }
    return $actual
}

function Copy-BlockwrightBoundedStream {
    param(
        [Parameter(Mandatory = $true)][System.IO.Stream]$InputStream,
        [Parameter(Mandatory = $true)][System.IO.Stream]$OutputStream,
        [Parameter(Mandatory = $true)][ValidateRange(1, [long]::MaxValue)][long]$MaxBytes,
        [Parameter(Mandatory = $true)][System.Threading.CancellationToken]$CancellationToken
    )
    $buffer = New-Object byte[] 65536
    [long]$total = 0
    while ($true) {
        $read = $InputStream.ReadAsync($buffer, 0, $buffer.Length, $CancellationToken).GetAwaiter().GetResult()
        if ($read -eq 0) { break }
        if ($total -gt ($MaxBytes - $read)) { throw "Download exceeded the maximum allowed size of $MaxBytes bytes." }
        $OutputStream.Write($buffer, 0, $read)
        $total += $read
    }
    return $total
}

function Save-BlockwrightHttpsResource {
    param(
        [Parameter(Mandatory = $true)][uri]$Uri,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][ValidateRange(1, [long]::MaxValue)][long]$MaxBytes,
        [Parameter(Mandatory = $true)][ValidateRange(1, 3600)][int]$TimeoutSeconds,
        [long]$ExpectedBytes = 0,
        [ValidateRange(0, 5)][int]$MaxRedirects = 4
    )
    if ($Uri.Scheme -ne "https") { throw "Blockwright downloads require HTTPS." }
    if ($ExpectedBytes -lt 0 -or $ExpectedBytes -gt $MaxBytes) { throw "Published artifact size is outside the updater's allowed range." }
    $destinationPath = [System.IO.Path]::GetFullPath($Destination)
    $partialPath = "$destinationPath.partial"
    if ((Test-Path -LiteralPath $destinationPath) -or (Test-Path -LiteralPath $partialPath)) { throw "Refusing to overwrite an existing update download: $destinationPath" }

    Add-Type -AssemblyName System.Net.Http
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $handler.AutomaticDecompression = [System.Net.DecompressionMethods]::None
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [System.Threading.Timeout]::InfiniteTimeSpan
    $deadline = [System.Threading.CancellationTokenSource]::new()
    $deadline.CancelAfter([TimeSpan]::FromSeconds($TimeoutSeconds))
    $currentUri = $Uri
    try {
        for ($redirect = 0; $redirect -le $MaxRedirects; $redirect++) {
            $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $currentUri)
            $request.Headers.UserAgent.ParseAdd("Blockwright-Updater/0.6")
            $response = $null
            try {
                $response = $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead, $deadline.Token).GetAwaiter().GetResult()
                $statusCode = [int]$response.StatusCode
                if ($statusCode -in @(301, 302, 303, 307, 308)) {
                    if ($redirect -ge $MaxRedirects -or $null -eq $response.Headers.Location) { throw "Update download exceeded the allowed HTTPS redirect count." }
                    $nextUri = [System.Uri]::new($currentUri, $response.Headers.Location)
                    if ($nextUri.Scheme -ne "https") { throw "Update download redirect attempted to leave HTTPS." }
                    $currentUri = $nextUri
                    continue
                }
                if ($statusCode -ne 200) { throw "Update download failed with HTTP $statusCode." }
                if ($response.Content.Headers.ContentEncoding.Count -gt 0) { throw "Compressed HTTP content encoding is not accepted for update artifacts." }
                $contentLength = $response.Content.Headers.ContentLength
                if ($null -ne $contentLength -and [long]$contentLength -gt $MaxBytes) { throw "Download Content-Length exceeds the maximum allowed size of $MaxBytes bytes." }
                if ($ExpectedBytes -gt 0 -and $null -ne $contentLength -and [long]$contentLength -ne $ExpectedBytes) { throw "Download Content-Length does not match the published artifact size." }

                $inputStream = $null
                $outputStream = $null
                try {
                    $inputStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
                    $outputStream = [System.IO.FileStream]::new($partialPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
                    [long]$written = Copy-BlockwrightBoundedStream -InputStream $inputStream -OutputStream $outputStream -MaxBytes $MaxBytes -CancellationToken $deadline.Token
                    $outputStream.Flush($true)
                } finally {
                    if ($null -ne $outputStream) { $outputStream.Dispose() }
                    if ($null -ne $inputStream) { $inputStream.Dispose() }
                }
                if ($ExpectedBytes -gt 0 -and $written -ne $ExpectedBytes) { throw "Downloaded byte count does not match the published artifact size." }
                [System.IO.File]::Move($partialPath, $destinationPath)
                return [pscustomobject]@{ Path = $destinationPath; Bytes = $written; FinalUri = $currentUri.AbsoluteUri; Redirects = $redirect }
            } finally {
                if ($null -ne $response) { $response.Dispose() }
                $request.Dispose()
            }
        }
        throw "Update download exceeded the allowed HTTPS redirect count."
    } catch [System.OperationCanceledException] {
        throw "Update download exceeded its $TimeoutSeconds second deadline."
    } finally {
        $deadline.Dispose()
        $client.Dispose()
        $handler.Dispose()
        if (Test-Path -LiteralPath $partialPath -PathType Leaf) { Remove-Item -LiteralPath $partialPath -Force }
    }
}

function Get-BlockwrightPreviousInstallPreservation {
    param([Parameter(Mandatory = $true)][bool]$InstallerStarted)
    if ($InstallerStarted) { return "not-guaranteed" }
    return "confirmed"
}

if ($SelfTest) {
    $older = ConvertTo-BlockwrightSemanticVersion -Value "0.5.9"
    $current = ConvertTo-BlockwrightSemanticVersion -Value "0.6.0"
    if ($older.Value -ge $current.Value) { throw "Semantic downgrade comparison self-test failed." }
    $invalidRejected = $false
    try { $null = ConvertTo-BlockwrightSemanticVersion -Value "latest" } catch { $invalidRejected = $true }
    if (-not $invalidRejected) { throw "Invalid semantic version self-test failed." }
    $productMismatchRejected = $false
    try { $null = Assert-InstallerProductVersion -Path (Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe") -ExpectedVersion "0.6.0" } catch { $productMismatchRejected = $true }
    if (-not $productMismatchRejected) { throw "Installer ProductVersion binding self-test failed." }
    $oversizeRejected = $false
    $input = New-Object System.IO.MemoryStream(, (New-Object byte[] 9))
    $output = New-Object System.IO.MemoryStream
    try {
        try { $null = Copy-BlockwrightBoundedStream -InputStream $input -OutputStream $output -MaxBytes 8 -CancellationToken ([System.Threading.CancellationToken]::None) } catch { $oversizeRejected = $_.Exception.Message -match "maximum allowed size" }
    } finally {
        $output.Dispose()
        $input.Dispose()
    }
    if (-not $oversizeRejected) { throw "Bounded download self-test failed." }
    $preservedBeforeExecution = Get-BlockwrightPreviousInstallPreservation -InstallerStarted $false
    $preservedAfterExecutionStarted = Get-BlockwrightPreviousInstallPreservation -InstallerStarted $true
    if ($preservedBeforeExecution -ne "confirmed" -or $preservedAfterExecutionStarted -ne "not-guaranteed") { throw "Installer execution-state reporting self-test failed." }
    [pscustomobject]@{ Valid = $true; DowngradeRejected = $true; InvalidVersionRejected = $true; ProductVersionMismatchRejected = $true; OversizeDownloadRejected = $true; PreservationStateTransitions = $true } | ConvertTo-Json -Compress
    exit 0
}

$configuration = Get-BlockwrightConfiguration -InstallRoot $resolvedInstallRoot -StateRoot $resolvedStateRoot
if ([string]::IsNullOrWhiteSpace($MetadataUri)) { $MetadataUri = [string]$configuration.updateMetadataUri }
if ([string]::IsNullOrWhiteSpace($TrustedPublisherThumbprint)) { $TrustedPublisherThumbprint = [string]$configuration.trustedPublisherThumbprint }
if ([string]::IsNullOrWhiteSpace($MetadataUri)) { throw "No update metadata URL is configured. Blockwright will not guess an update source." }
$metadataAddress = $null
if (-not [uri]::TryCreate($MetadataUri, [UriKind]::Absolute, [ref]$metadataAddress) -or $metadataAddress.Scheme -ne "https") { throw "Update metadata must use an absolute HTTPS URL." }
$trustedThumbprint = ($TrustedPublisherThumbprint -replace '[^A-Fa-f0-9]', '').ToUpperInvariant()
if ($trustedThumbprint.Length -lt 40) { throw "A trusted Authenticode publisher thumbprint must be configured before updates can run." }

$updatesRoot = [System.IO.Path]::GetFullPath((Join-Path $resolvedStateRoot "updates"))
$operationRoot = [System.IO.Path]::GetFullPath((Join-Path $updatesRoot ([guid]::NewGuid().ToString("N"))))
if (-not (Test-BlockwrightChildPath -Parent $updatesRoot -Candidate $operationRoot)) { throw "Refusing an unsafe update work path: $operationRoot" }
$null = New-Item -ItemType Directory -Path $operationRoot -Force
$failurePath = Join-Path $updatesRoot "last-failure.json"
$successPath = Join-Path $updatesRoot "last-success.json"
$checkPath = Join-Path $updatesRoot "last-check.json"
$stage = "metadata"
$downloadedInstaller = $null
$installedVersion = $null
$targetVersion = $null
$installerStarted = $false
$installationCommitted = $false

function Write-UpdateReport {
    param([string]$Status, [string]$Message, [string]$Path)
    $preservation = Get-BlockwrightPreviousInstallPreservation -InstallerStarted $installerStarted
    $report = [ordered]@{
        schemaVersion = 1
        status = $Status
        stage = $stage
        recordedAt = [datetimeoffset]::UtcNow.ToString("o")
        metadataUri = $MetadataUri
        installer = if ($null -eq $downloadedInstaller) { $null } else { [System.IO.Path]::GetFileName($downloadedInstaller) }
        message = $Message
        previousInstallPreserved = ($preservation -eq "confirmed")
        previousInstallPreservation = $preservation
        installerStarted = $installerStarted
        installationSucceeded = $installationCommitted
        installedVersion = if ($null -eq $installedVersion) { $null } else { $installedVersion.Canonical }
        targetVersion = if ($null -eq $targetVersion) { $null } else { $targetVersion.Canonical }
        downgradeOverride = [bool]$AllowDowngrade
    }
    [System.IO.File]::WriteAllText($Path, (($report | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
}

try {
    $installedVersionText = Get-InstalledBlockwrightVersion
    $installedVersion = ConvertTo-BlockwrightSemanticVersion -Value $installedVersionText -Label "installed Blockwright version"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    [long]$maximumMetadataBytes = 262144
    [long]$maximumInstallerBytes = 536870912
    [int]$metadataTimeoutSeconds = 30
    [int]$installerTimeoutSeconds = 900
    $metadataPath = Join-Path $operationRoot "latest.json"
    $null = Save-BlockwrightHttpsResource -Uri $metadataAddress -Destination $metadataPath -MaxBytes $maximumMetadataBytes -TimeoutSeconds $metadataTimeoutSeconds
    $metadata = Get-Content -Raw -LiteralPath $metadataPath | ConvertFrom-Json
    if ([int]$metadata.schemaVersion -ne 1 -or [string]$metadata.product -ne "Blockwright" -or [string]::IsNullOrWhiteSpace([string]$metadata.version)) {
        throw "Update metadata schema, product, or version is invalid."
    }
    $targetVersion = ConvertTo-BlockwrightSemanticVersion -Value ([string]$metadata.version) -Label "update metadata version"
    if ($targetVersion.Value -lt $installedVersion.Value -and -not $AllowDowngrade) {
        throw "Refusing to downgrade Blockwright from $($installedVersion.Canonical) to $($targetVersion.Canonical). Use -AllowDowngrade only for an explicit, trusted recovery operation."
    }
    $artifactAddress = $null
    if (-not [uri]::TryCreate([string]$metadata.artifact.url, [UriKind]::Absolute, [ref]$artifactAddress) -or $artifactAddress.Scheme -ne "https") {
        throw "Update artifact URL must use absolute HTTPS."
    }
    $expectedHash = ([string]$metadata.artifact.sha256).Trim().ToLowerInvariant()
    if ($expectedHash -notmatch '^[a-f0-9]{64}$') { throw "Update metadata does not contain a valid published SHA-256 checksum." }
    [long]$publishedSize = 0
    if (-not [long]::TryParse([string]$metadata.artifact.sizeBytes, [ref]$publishedSize) -or $publishedSize -lt 1 -or $publishedSize -gt $maximumInstallerBytes) {
        throw "Update metadata artifact size is missing or exceeds the updater's $maximumInstallerBytes byte limit."
    }
    if ($metadata.artifact.signature.required -ne $true -or [string]$metadata.artifact.signature.status -ne "signed") {
        throw "Update metadata does not require and attest a signed installer. Unsigned artifacts are refused."
    }
    $metadataThumbprint = ([string]$metadata.artifact.signature.signerThumbprint -replace '[^A-Fa-f0-9]', '').ToUpperInvariant()
    if ($metadataThumbprint -ne $trustedThumbprint) { throw "Update metadata publisher thumbprint is not the configured trusted publisher." }
    $artifactName = [System.IO.Path]::GetFileName($artifactAddress.AbsolutePath)
    if ([string]::IsNullOrWhiteSpace($artifactName) -or [System.IO.Path]::GetExtension($artifactName) -ne ".exe") { throw "Updater accepts only a signed .exe installer artifact." }

    $stage = "download"
    $downloadedInstaller = Join-Path $operationRoot $artifactName
    $null = Save-BlockwrightHttpsResource -Uri $artifactAddress -Destination $downloadedInstaller -MaxBytes $maximumInstallerBytes -ExpectedBytes $publishedSize -TimeoutSeconds $installerTimeoutSeconds
    $actualHash = (Get-FileHash -LiteralPath $downloadedInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) { throw "Downloaded installer SHA-256 does not match published metadata." }

    $stage = "signature"
    $signature = Get-AuthenticodeSignature -LiteralPath $downloadedInstaller
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or $null -eq $signature.SignerCertificate) {
        throw "Downloaded installer Authenticode signature is not valid (status: $($signature.Status))."
    }
    $actualThumbprint = ([string]$signature.SignerCertificate.Thumbprint -replace '[^A-Fa-f0-9]', '').ToUpperInvariant()
    if ($actualThumbprint -ne $trustedThumbprint) { throw "Downloaded installer signature is valid but belongs to an untrusted publisher." }

    $stage = "artifact-version"
    $null = Assert-InstallerProductVersion -Path $downloadedInstaller -ExpectedVersion $targetVersion.Canonical

    $verified = [pscustomobject]@{ Status = "Verified"; Version = $targetVersion.Canonical; InstalledVersion = $installedVersion.Canonical; DowngradeOverride = [bool]$AllowDowngrade; Installer = $downloadedInstaller; Sha256 = $actualHash; SignerThumbprint = $actualThumbprint }
    if ($CheckOnly) {
        $stage = "check-complete"
        $checkReport = [ordered]@{
            schemaVersion = 1
            status = "verified"
            checkedAt = [datetimeoffset]::UtcNow.ToString("o")
            installedVersion = $installedVersion.Canonical
            targetVersion = $targetVersion.Canonical
            updateAvailable = ($targetVersion.Value -gt $installedVersion.Value)
            downgrade = ($targetVersion.Value -lt $installedVersion.Value)
            sha256 = $actualHash
            signerThumbprint = $actualThumbprint
        }
        [System.IO.File]::WriteAllText($checkPath, (($checkReport | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
        if (Test-Path -LiteralPath $failurePath -PathType Leaf) { Remove-Item -LiteralPath $failurePath -Force }
        if ($PassThru) { $verified } else { Write-Output "Verified trusted Blockwright $($metadata.version) installer without executing it." }
        exit 0
    }

    $stage = "stop-managed-server"
    $stopResult = Stop-BlockwrightManagedProcess -InstallRoot $resolvedInstallRoot -StateRoot $resolvedStateRoot -Confirm:$false

    $stage = "install"
    $installerArguments = '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS /DIR="' + $resolvedInstallRoot + '"'
    $process = Start-Process -FilePath $downloadedInstaller -ArgumentList $installerArguments -PassThru -WindowStyle Hidden
    $installerStarted = $true
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "Verified installer exited with code $($process.ExitCode). The prior installation may have been modified; run the signed installer repair path before retrying." }
    $installationCommitted = $true

    $stage = "relaunch"
    if (-not $NoRelaunch) {
        $launcher = Join-Path $resolvedInstallRoot "Blockwright.exe"
        if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw "Update installed, but the native Blockwright launcher is missing: $launcher" }
        Start-Process -FilePath $launcher -WindowStyle Hidden
    }
    $stage = "complete"
    Write-UpdateReport -Status "success" -Message "Installed Blockwright $($metadata.version) after checksum and trusted Authenticode verification." -Path $successPath
    if (Test-Path -LiteralPath $failurePath -PathType Leaf) { Remove-Item -LiteralPath $failurePath -Force }
    if ($PassThru) { [pscustomobject]@{ Status = "Installed"; Version = [string]$metadata.version; StopResult = $stopResult.Status; Relaunched = (-not $NoRelaunch) } } else { Write-Output "Updated Blockwright to $($metadata.version)." }
} catch {
    Write-UpdateReport -Status "failed" -Message $_.Exception.Message -Path $failurePath
    throw
} finally {
    if ($stage -eq "complete" -or $CheckOnly) {
        if ((Test-BlockwrightChildPath -Parent $updatesRoot -Candidate $operationRoot) -and (Test-Path -LiteralPath $operationRoot -PathType Container)) {
            Remove-Item -LiteralPath $operationRoot -Recurse -Force
        }
    } else {
        Write-Warning "Update evidence was retained for recovery at $operationRoot. The existing installation was not recursively removed."
    }
}
