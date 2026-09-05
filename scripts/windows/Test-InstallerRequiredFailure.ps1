[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$CurrentInstaller
)

$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") { throw "Installer failure-contract tests require Windows." }

$resolvedInstaller = [System.IO.Path]::GetFullPath($CurrentInstaller)
if (-not (Test-Path -LiteralPath $resolvedInstaller -PathType Leaf)) { throw "Installer was not found: $resolvedInstaller" }

$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
$testRoot = Join-Path $temporaryRoot ("Blockwright Installer Lifecycle " + [guid]::NewGuid().ToString("N"))
$installRoot = Join-Path $testRoot "installed app"
$stateRoot = Join-Path $testRoot "state"
$roamingRoot = Join-Path $testRoot "roaming"
$logRoot = Join-Path $testRoot "logs"
$setupLog = Join-Path $logRoot "required-failure-setup.log"
$uninstallLog = Join-Path $logRoot "required-failure-uninstall.log"
$uninstallRegistrationKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{2D75D5A7-BC78-4BBE-B0BC-5B8D0366C4B4}_is1"
$previousStateRoot = $env:BLOCKWRIGHT_STATE_ROOT
$previousAppData = $env:APPDATA
$previousInstallerTestStateRoot = $env:BLOCKWRIGHT_INSTALLER_TEST_STATE_ROOT
$previousInstallerTestRoamingRoot = $env:BLOCKWRIGHT_INSTALLER_TEST_ROAMING_ROOT
$listener = $null
$testSucceeded = $false

function Invoke-FixtureUninstaller {
    param([Parameter(Mandatory = $true)][string]$LogPath)
    $uninstaller = Join-Path $installRoot "unins000.exe"
    if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw "Partial installer did not leave a recovery uninstaller: $uninstaller" }
    $arguments = '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="' + $LogPath + '"'
    $process = Start-Process -FilePath $uninstaller -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw "Recovery uninstaller exited with code $($process.ExitCode)." }
    for ($attempt = 0; $attempt -lt 50 -and (Test-Path -LiteralPath $installRoot); $attempt++) { Start-Sleep -Milliseconds 100 }
    if (Test-Path -LiteralPath $installRoot) { throw "Recovery uninstaller left the partial application directory behind: $installRoot" }
}

if (Test-Path -LiteralPath $uninstallRegistrationKey) {
    $existingRegistration = Get-ItemProperty -LiteralPath $uninstallRegistrationKey
    throw "Installer failure-contract tests require no existing Blockwright AppId registration. Existing install location: $($existingRegistration.InstallLocation)"
}

try {
    $null = New-Item -ItemType Directory -Path $logRoot -Force
    $null = New-Item -ItemType Directory -Path $roamingRoot -Force
    $env:BLOCKWRIGHT_STATE_ROOT = $stateRoot
    $env:APPDATA = $roamingRoot
    $env:BLOCKWRIGHT_INSTALLER_TEST_STATE_ROOT = $stateRoot
    $env:BLOCKWRIGHT_INSTALLER_TEST_ROAMING_ROOT = $roamingRoot

    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 32147)
        $listener.Start()
    } catch {
        $listener = $null
    }

    $arguments = '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR="' + $installRoot + '" /LOG="' + $setupLog + '"'
    $setup = Start-Process -FilePath $resolvedInstaller -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
    if ($setup.ExitCode -ne 100) { throw "Required post-install failure returned $($setup.ExitCode), expected custom setup exit code 100." }
    if (Test-Path -LiteralPath (Join-Path $stateRoot "config.json") -PathType Leaf) { throw "Required-failure fixture unexpectedly created config.json." }
    if (Test-Path -LiteralPath (Join-Path $stateRoot "integration\installer-status.txt") -PathType Leaf) { throw "Required-failure fixture continued into optional integration status processing." }
    if (-not (Test-Path -LiteralPath $uninstallRegistrationKey)) { throw "Required-failure fixture did not leave the expected repair/uninstall registration." }

    if ($null -ne $listener) {
        $listener.Stop()
        $listener = $null
    }
    Invoke-FixtureUninstaller -LogPath $uninstallLog
    if (Test-Path -LiteralPath $uninstallRegistrationKey) { throw "Recovery uninstall left the stable AppId registration behind." }
    $testSucceeded = $true
    [pscustomobject]@{
        valid = $true
        requiredPostInstallFailureExitCode = 100
        falseSuccessPrevented = "pass"
        recoveryUninstall = "pass"
    } | ConvertTo-Json -Compress
} finally {
    if ($null -ne $listener) { try { $listener.Stop() } catch {} }
    if ((Test-Path -LiteralPath $uninstallRegistrationKey) -and (Test-Path -LiteralPath (Join-Path $installRoot "unins000.exe") -PathType Leaf)) {
        try { Invoke-FixtureUninstaller -LogPath $uninstallLog } catch { Write-Warning "Required-failure fixture recovery failed. $($_.Exception.Message)" }
    }
    $env:BLOCKWRIGHT_STATE_ROOT = $previousStateRoot
    $env:APPDATA = $previousAppData
    $env:BLOCKWRIGHT_INSTALLER_TEST_STATE_ROOT = $previousInstallerTestStateRoot
    $env:BLOCKWRIGHT_INSTALLER_TEST_ROAMING_ROOT = $previousInstallerTestRoamingRoot

    $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
    $resolvedTestParent = [System.IO.Path]::GetFullPath((Split-Path -Parent $resolvedTestRoot)).TrimEnd('\')
    $testLeaf = [System.IO.Path]::GetFileName($resolvedTestRoot)
    $safeGeneratedRoot = $resolvedTestParent.Equals($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -and
        ($testLeaf -match '^Blockwright Installer Lifecycle [a-f0-9]{32}$')
    if ($testSucceeded -and -not (Test-Path -LiteralPath $uninstallRegistrationKey) -and $safeGeneratedRoot -and (Test-Path -LiteralPath $resolvedTestRoot -PathType Container)) {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    } elseif (-not $testSucceeded) {
        Write-Warning "Required-failure fixture evidence was retained at $resolvedTestRoot."
    }
}
