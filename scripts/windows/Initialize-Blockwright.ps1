[CmdletBinding()]
param(
    [string]$InstallRoot,
    [string]$StateRoot,
    [ValidateRange(1024, 65535)][int]$Port = 32147,
    [ValidateSet("auto", "per-user", "portable")][string]$StateMode = "auto",
    [string]$UpdateMetadataUri,
    [string]$TrustedPublisherThumbprint,
    [switch]$InstallerMode,
    [switch]$PreserveExistingConfiguration,
    [switch]$PassThru
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "Blockwright-Paths.psm1") -Force
$resolvedInstallRoot = Resolve-BlockwrightInstallRoot -InstallRoot $InstallRoot
$resolvedStateRoot = Get-BlockwrightStateRoot -InstallRoot $resolvedInstallRoot -StateRoot $StateRoot
$configurationPath = Join-Path $resolvedStateRoot "config.json"
if ($InstallerMode -and -not (Test-BlockwrightInstalledStateRoot -Candidate $resolvedStateRoot)) {
    throw "Installer initialization refused a state root outside the exact per-user or disposable lifecycle-test location: $resolvedStateRoot"
}
$packagedDefaults = Get-BlockwrightConfiguration -InstallRoot $resolvedInstallRoot -StateRoot $resolvedStateRoot
$preserveConfiguration = $PreserveExistingConfiguration -and (Test-Path -LiteralPath $configurationPath -PathType Leaf)
if ($preserveConfiguration) {
    $Port = [int]$packagedDefaults.port
    $UpdateMetadataUri = [string]$packagedDefaults.updateMetadataUri
    $TrustedPublisherThumbprint = [string]$packagedDefaults.trustedPublisherThumbprint
} else {
    if ([string]::IsNullOrWhiteSpace($UpdateMetadataUri)) { $UpdateMetadataUri = [string]$packagedDefaults.updateMetadataUri }
    if ([string]::IsNullOrWhiteSpace($TrustedPublisherThumbprint)) { $TrustedPublisherThumbprint = [string]$packagedDefaults.trustedPublisherThumbprint }
}

if ($StateMode -eq "portable" -and -not (Test-Path -LiteralPath (Join-Path $resolvedInstallRoot "portable.flag") -PathType Leaf)) {
    throw "Portable state was requested, but portable.flag is not present in the package root."
}
if ($StateMode -eq "per-user" -and (Test-Path -LiteralPath (Join-Path $resolvedInstallRoot "portable.flag") -PathType Leaf)) {
    throw "This portable package keeps its state beside the application and cannot be initialized as per-user."
}
if (-not [string]::IsNullOrWhiteSpace($UpdateMetadataUri)) {
    $metadataUri = $null
    if (-not [uri]::TryCreate($UpdateMetadataUri, [UriKind]::Absolute, [ref]$metadataUri) -or $metadataUri.Scheme -ne "https") {
        throw "Update metadata must use an absolute HTTPS URL."
    }
}
if (-not [string]::IsNullOrWhiteSpace($TrustedPublisherThumbprint)) {
    $TrustedPublisherThumbprint = ($TrustedPublisherThumbprint -replace '[^A-Fa-f0-9]', '').ToUpperInvariant()
    if ($TrustedPublisherThumbprint.Length -lt 40) { throw "The trusted publisher thumbprint is invalid." }
}

if (-not $preserveConfiguration) {
    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
    } catch {
        throw "Port $Port is already in use. Choose another loopback port before completing setup."
    } finally {
        if ($null -ne $listener) { try { $listener.Stop() } catch {} }
    }
}

if (-not (Test-Path -LiteralPath $resolvedStateRoot -PathType Container)) { $null = New-Item -ItemType Directory -Path $resolvedStateRoot -Force }
foreach ($directory in @("cache", "crashes", "integration", "logs", "run", "updates", "projects", "exports")) {
    $null = New-Item -ItemType Directory -Path (Join-Path $resolvedStateRoot $directory) -Force
}
if ($preserveConfiguration) {
    $configuration = $packagedDefaults
} else {
    $configuration = [ordered]@{
        schemaVersion = 1
        port = $Port
        bindAddress = "127.0.0.1"
        updateMetadataUri = if ([string]::IsNullOrWhiteSpace($UpdateMetadataUri)) { $null } else { $UpdateMetadataUri }
        trustedPublisherThumbprint = if ([string]::IsNullOrWhiteSpace($TrustedPublisherThumbprint)) { $null } else { $TrustedPublisherThumbprint }
        stateMode = if (Test-Path -LiteralPath (Join-Path $resolvedInstallRoot "portable.flag") -PathType Leaf) { "portable" } else { "per-user" }
    }
    [System.IO.File]::WriteAllText($configurationPath, (($configuration | ConvertTo-Json -Depth 5) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
}
$installState = [ordered]@{
    schemaVersion = 1
    installRoot = $resolvedInstallRoot
    initializedAt = [datetimeoffset]::UtcNow.ToString("o")
    ownedState = @("config.json", "cache", "crashes", "integration", "logs", "run", "updates")
    preservedUserState = @("projects", "exports", "palettes.json")
}
[System.IO.File]::WriteAllText((Join-Path $resolvedStateRoot "install-state.json"), (($installState | ConvertTo-Json -Depth 5) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
$result = [pscustomobject]@{ InstallRoot = $resolvedInstallRoot; StateRoot = $resolvedStateRoot; Configuration = $configurationPath; Port = $Port; StateMode = $configuration.stateMode }
if ($PassThru) { $result } else { Write-Output "Initialized Blockwright $($configuration.stateMode) state at $resolvedStateRoot on loopback port $Port." }
