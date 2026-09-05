[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$CurrentInstaller,
    [string]$PreviousInstaller,
    [string]$TestRoot,
    [ValidateRange(20, 180)][int]$SmokeTestSeconds = 60
)

$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") { throw "Installer lifecycle tests require Windows." }
$deleteTestRoot = [string]::IsNullOrWhiteSpace($TestRoot)
if ($deleteTestRoot) { $TestRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("Blockwright Installer Lifecycle " + [guid]::NewGuid().ToString("N")) }
$resolvedTestRoot = [System.IO.Path]::GetFullPath($TestRoot)
$installRoot = Join-Path $resolvedTestRoot "installed app"
$stateRoot = Join-Path $resolvedTestRoot "state"
$uninstallRegistrationKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{2D75D5A7-BC78-4BBE-B0BC-5B8D0366C4B4}_is1"
$previousStateRoot = $env:BLOCKWRIGHT_STATE_ROOT
$previousAppData = $env:APPDATA
$previousInstallerTestStateRoot = $env:BLOCKWRIGHT_INSTALLER_TEST_STATE_ROOT
$previousInstallerTestRoamingRoot = $env:BLOCKWRIGHT_INSTALLER_TEST_ROAMING_ROOT

function Invoke-Installer {
    param([string]$Path)
    $arguments = '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR="' + $installRoot + '"'
    $process = Start-Process -FilePath ([System.IO.Path]::GetFullPath($Path)) -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw "Installer $Path exited with code $($process.ExitCode)." }
}

function Invoke-Uninstaller {
    param([switch]$RemoveUserData)
    $uninstaller = Join-Path $installRoot "unins000.exe"
    if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw "Inno uninstaller is missing: $uninstaller" }
    $arguments = "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART"
    if ($RemoveUserData) { $arguments += " /REMOVEUSERDATA" }
    $process = Start-Process -FilePath $uninstaller -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw "Uninstaller exited with code $($process.ExitCode)." }
    for ($attempt = 0; $attempt -lt 50 -and (Test-Path -LiteralPath $installRoot); $attempt++) { Start-Sleep -Milliseconds 100 }
}

function Get-FreePort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try { $listener.Start(); return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() }
}

function Set-ConfigurationPreservationProbe {
    $configurationPath = Join-Path $stateRoot "config.json"
    $configuration = [System.IO.File]::ReadAllText($configurationPath) | ConvertFrom-Json
    $configuration.port = Get-FreePort
    $configuration.updateMetadataUri = "https://example.invalid/blockwright-test/latest.json"
    $configuration.trustedPublisherThumbprint = "ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    [System.IO.File]::WriteAllText($configurationPath, (($configuration | ConvertTo-Json -Depth 10) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    return [pscustomobject]@{ Port = [int]$configuration.port; MetadataUri = [string]$configuration.updateMetadataUri; Thumbprint = [string]$configuration.trustedPublisherThumbprint }
}

function Assert-ConfigurationPreserved {
    param([Parameter(Mandatory = $true)]$Expected, [Parameter(Mandatory = $true)][string]$Operation)
    $actual = [System.IO.File]::ReadAllText((Join-Path $stateRoot "config.json")) | ConvertFrom-Json
    if ([int]$actual.port -ne $Expected.Port -or [string]$actual.updateMetadataUri -ne $Expected.MetadataUri -or [string]$actual.trustedPublisherThumbprint -ne $Expected.Thumbprint) {
        throw "$Operation reset or rewrote the user's existing Blockwright configuration."
    }
}

if (Test-Path -LiteralPath $uninstallRegistrationKey) {
    $existingRegistration = Get-ItemProperty -LiteralPath $uninstallRegistrationKey
    throw "Installer lifecycle tests require a disposable Windows profile with no existing Blockwright AppId registration. Existing install location: $($existingRegistration.InstallLocation)"
}

try {
    $null = New-Item -ItemType Directory -Path $resolvedTestRoot -Force
    $env:BLOCKWRIGHT_STATE_ROOT = $stateRoot
    $env:APPDATA = Join-Path $resolvedTestRoot "roaming"
    $env:BLOCKWRIGHT_INSTALLER_TEST_STATE_ROOT = $stateRoot
    $env:BLOCKWRIGHT_INSTALLER_TEST_ROAMING_ROOT = $env:APPDATA
    $configurationProbe = $null
    if (-not [string]::IsNullOrWhiteSpace($PreviousInstaller)) {
        Invoke-Installer -Path $PreviousInstaller
        foreach ($requiredStateEntry in @("config.json", "install-state.json")) {
            if (-not (Test-Path -LiteralPath (Join-Path $stateRoot $requiredStateEntry) -PathType Leaf)) { throw "Previous installer did not initialize fixture state at the validated lifecycle root: $requiredStateEntry" }
        }
        $configurationProbe = Set-ConfigurationPreservationProbe
    }
    Invoke-Installer -Path $CurrentInstaller
    if (-not (Test-Path -LiteralPath $uninstallRegistrationKey)) { throw "Current installer did not create the expected per-user AppId registration." }
    $fixtureRegistration = Get-ItemProperty -LiteralPath $uninstallRegistrationKey
    if (-not ([System.IO.Path]::GetFullPath([string]$fixtureRegistration.InstallLocation)).TrimEnd('\').Equals($installRoot.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) { throw "Installer lifecycle fixture registered an unexpected install location." }
    foreach ($requiredStateEntry in @("config.json", "install-state.json")) {
        if (-not (Test-Path -LiteralPath (Join-Path $stateRoot $requiredStateEntry) -PathType Leaf)) { throw "Current installer did not initialize fixture state at the validated lifecycle root: $requiredStateEntry" }
    }
    if ($null -ne $configurationProbe) { Assert-ConfigurationPreserved -Expected $configurationProbe -Operation "Upgrade" }
    if ($null -eq $configurationProbe) { $configurationProbe = Set-ConfigurationPreservationProbe }
    Invoke-Installer -Path $CurrentInstaller
    Assert-ConfigurationPreserved -Expected $configurationProbe -Operation "Same-version repair"
    foreach ($required in @("runtime\node\node.exe", "runtime\node\npm.cmd", "app\dist\server.js", "scripts\windows\Blockwright-ControlCenter.ps1", "release-manifest.json")) {
        if (-not (Test-Path -LiteralPath (Join-Path $installRoot $required))) { throw "Installed payload is missing $required." }
    }
    $updaterSelfTest = @(& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installRoot "scripts\windows\Update-Blockwright.ps1") -InstallRoot $installRoot -StateRoot $stateRoot -SelfTest 2>&1)
    $updaterSelfTestResult = ($updaterSelfTest -join "`n") | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or -not $updaterSelfTestResult.DowngradeRejected -or -not $updaterSelfTestResult.OversizeDownloadRejected -or -not $updaterSelfTestResult.PreservationStateTransitions) { throw "Installed updater downgrade/ProductVersion/bounded-download/execution-state self-test failed: $($updaterSelfTest -join ' ')" }
    $smokeScript = Join-Path $installRoot "scripts\windows\Blockwright-ControlCenter.ps1"
    $smokeOutput = @(& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $smokeScript -PluginRoot $installRoot -SmokeTest -SmokeTestSeconds $SmokeTestSeconds -Json 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "Installed private-runtime smoke test failed: $($smokeOutput -join [Environment]::NewLine)" }
    $smoke = ($smokeOutput -join [Environment]::NewLine) | ConvertFrom-Json
    if (-not $smoke.healthy) { throw "Installed server did not become ready." }

    $null = New-Item -ItemType Directory -Path (Join-Path $stateRoot "projects") -Force
    $null = New-Item -ItemType Directory -Path (Join-Path $stateRoot "exports") -Force
    [System.IO.File]::WriteAllText((Join-Path $stateRoot "projects\preserve.blockwright"), "preserve")
    [System.IO.File]::WriteAllText((Join-Path $stateRoot "exports\preserve.schem"), "preserve")
    [System.IO.File]::WriteAllText((Join-Path $stateRoot "palettes.json"), "preserve")
    $legacyPaletteRoot = Join-Path $env:APPDATA "Blockwright"
    $null = New-Item -ItemType Directory -Path $legacyPaletteRoot -Force
    [System.IO.File]::WriteAllText((Join-Path $legacyPaletteRoot "palettes.json"), "preserve")
    Invoke-Uninstaller
    if (Test-Path -LiteralPath $installRoot) { throw "Default uninstall left the installer-owned application directory behind." }
    if (-not (Test-Path -LiteralPath (Join-Path $stateRoot "projects\preserve.blockwright"))) { throw "Default uninstall removed a user project." }
    if (-not (Test-Path -LiteralPath (Join-Path $stateRoot "exports\preserve.schem"))) { throw "Default uninstall removed a user export." }
    if (-not (Test-Path -LiteralPath (Join-Path $stateRoot "palettes.json"))) { throw "Default uninstall removed user palettes." }
    if (-not (Test-Path -LiteralPath (Join-Path $legacyPaletteRoot "palettes.json"))) { throw "Default uninstall removed the legacy user palette file." }

    Invoke-Installer -Path $CurrentInstaller
    Invoke-Uninstaller -RemoveUserData
    if (Test-Path -LiteralPath $installRoot) { throw "Explicit-cleanup uninstall left the application directory behind." }
    if (Test-Path -LiteralPath $stateRoot) { throw "Explicit-cleanup uninstall left Blockwright state behind." }
    if (Test-Path -LiteralPath $legacyPaletteRoot) { throw "Explicit-cleanup uninstall left the exact legacy palette directory behind." }
    if (Test-Path -LiteralPath $uninstallRegistrationKey) { throw "Explicit-cleanup uninstall left the stable AppId registration behind." }
    [pscustomobject]@{ valid = $true; install = "pass"; upgrade = if ($PreviousInstaller) { "pass" } else { "not-exercised" }; repair = "pass"; configurationPreserved = "pass"; readiness = "pass"; stop = "pass"; updaterVersionGuards = "pass"; uninstallPreservesUserContent = "pass"; explicitCleanup = "pass" } | ConvertTo-Json -Compress
} finally {
    $fallbackUninstaller = Join-Path $installRoot "unins000.exe"
    if ((Test-Path -LiteralPath $uninstallRegistrationKey) -and (Test-Path -LiteralPath $fallbackUninstaller -PathType Leaf)) {
        try {
            $fallbackProcess = Start-Process -FilePath $fallbackUninstaller -ArgumentList "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART" -Wait -PassThru -WindowStyle Hidden
            if ($fallbackProcess.ExitCode -ne 0) { Write-Warning "Fixture uninstaller recovery exited with code $($fallbackProcess.ExitCode); the fixture directory will be preserved." }
        } catch {
            Write-Warning "Fixture uninstaller recovery failed; the fixture directory will be preserved. $($_.Exception.Message)"
        }
    }
    $env:BLOCKWRIGHT_STATE_ROOT = $previousStateRoot
    $env:APPDATA = $previousAppData
    $env:BLOCKWRIGHT_INSTALLER_TEST_STATE_ROOT = $previousInstallerTestStateRoot
    $env:BLOCKWRIGHT_INSTALLER_TEST_ROAMING_ROOT = $previousInstallerTestRoamingRoot
    if ($deleteTestRoot -and -not (Test-Path -LiteralPath $uninstallRegistrationKey) -and (Test-Path -LiteralPath $resolvedTestRoot -PathType Container) -and $resolvedTestRoot.StartsWith([System.IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    } elseif ($deleteTestRoot -and (Test-Path -LiteralPath $uninstallRegistrationKey)) {
        Write-Warning "Lifecycle fixture was retained at $resolvedTestRoot because its stable AppId registration still exists. Repair/uninstall it before deleting those files."
    }
}
