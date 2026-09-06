[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "High")]
param(
    [string]$InstallRoot,
    [string]$StateRoot,
    [string]$LegacyRoamingRoot,
    [switch]$RemoveUserProjectsAndExports,
    [switch]$InstalledUninstall,
    [switch]$Unattended,
    [switch]$PassThru
)

$ErrorActionPreference = "Stop"
if ($Unattended) { $ConfirmPreference = "None" }
Import-Module (Join-Path $PSScriptRoot "Blockwright-Paths.psm1") -Force
$resolvedInstallRoot = Resolve-BlockwrightInstallRoot -InstallRoot $InstallRoot
$resolvedStateRoot = Get-BlockwrightStateRoot -InstallRoot $resolvedInstallRoot -StateRoot $StateRoot
$installedRootAllowed = Test-BlockwrightInstalledStateRoot -Candidate $resolvedStateRoot
if ($InstalledUninstall -and -not $installedRootAllowed) {
    throw "Installed uninstall refused a state root outside the exact per-user or disposable lifecycle-test location: $resolvedStateRoot"
}
$portableRoot = [System.IO.Path]::GetFullPath((Join-Path $resolvedInstallRoot "data\state"))
$perUserRoot = if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { $null } else { [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Blockwright")) }
$allowedRoot = if ($InstalledUninstall) {
    $installedRootAllowed
} else {
    $resolvedStateRoot.Equals($portableRoot, [StringComparison]::OrdinalIgnoreCase) -or ($null -ne $perUserRoot -and $resolvedStateRoot.Equals($perUserRoot, [StringComparison]::OrdinalIgnoreCase)) -or (-not [string]::IsNullOrWhiteSpace($env:BLOCKWRIGHT_STATE_ROOT) -and $resolvedStateRoot.Equals([System.IO.Path]::GetFullPath($env:BLOCKWRIGHT_STATE_ROOT), [StringComparison]::OrdinalIgnoreCase))
}
if (-not $allowedRoot) { throw "Refusing cleanup outside the exact Blockwright state roots: $resolvedStateRoot" }

$stopResult = Stop-BlockwrightManagedProcess -InstallRoot $resolvedInstallRoot -StateRoot $resolvedStateRoot -Confirm:$false
$ownedEntries = @("config.json", "install-state.json", "cache", "crashes", "integration", "logs", "npm-cache", "run", "support-work", "tasks", "updates")
$userEntries = @("projects", "exports", "palettes.json")
$removed = New-Object 'System.Collections.Generic.List[string]'
$preserved = New-Object 'System.Collections.Generic.List[string]'
foreach ($entry in $ownedEntries) {
    $target = [System.IO.Path]::GetFullPath((Join-Path $resolvedStateRoot $entry))
    if (-not (Test-BlockwrightChildPath -Parent $resolvedStateRoot -Candidate $target)) { throw "Refusing unsafe owned-state target: $target" }
    if (Test-Path -LiteralPath $target) {
        if ($PSCmdlet.ShouldProcess($target, "Remove installer-owned Blockwright state")) { Remove-Item -LiteralPath $target -Recurse -Force; $removed.Add($entry) }
    }
}
foreach ($entry in $userEntries) {
    $target = [System.IO.Path]::GetFullPath((Join-Path $resolvedStateRoot $entry))
    if (-not (Test-Path -LiteralPath $target)) { continue }
    if ($RemoveUserProjectsAndExports) {
        if ($PSCmdlet.ShouldProcess($target, "Explicitly remove user-created Blockwright content")) { Remove-Item -LiteralPath $target -Recurse -Force; $removed.Add($entry) }
    } else {
        $preserved.Add($entry)
    }
}
if ($RemoveUserProjectsAndExports) {
    if ([string]::IsNullOrWhiteSpace($LegacyRoamingRoot)) { $LegacyRoamingRoot = $env:APPDATA }
    if ([string]::IsNullOrWhiteSpace($LegacyRoamingRoot)) { throw "The roaming AppData root is unavailable; legacy palette cleanup was refused." }
    $resolvedLegacyRoamingRoot = [System.IO.Path]::GetFullPath($LegacyRoamingRoot)
    if ($InstalledUninstall -and -not (Test-BlockwrightInstalledRoamingRoot -Candidate $resolvedLegacyRoamingRoot)) {
        throw "Installed uninstall refused a roaming root outside the exact per-user or disposable lifecycle-test location: $resolvedLegacyRoamingRoot"
    }
    $legacyRoot = [System.IO.Path]::GetFullPath((Join-Path $resolvedLegacyRoamingRoot "Blockwright"))
    $legacyPalette = [System.IO.Path]::GetFullPath((Join-Path $legacyRoot "palettes.json"))
    $expectedLegacyPalette = Join-Path $legacyRoot "palettes.json"
    if (-not $legacyPalette.Equals($expectedLegacyPalette, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing an unexpected legacy palette path: $legacyPalette" }
    if (Test-Path -LiteralPath $legacyPalette -PathType Leaf) {
        if ($PSCmdlet.ShouldProcess($legacyPalette, "Explicitly remove the exact legacy Blockwright palette file")) { Remove-Item -LiteralPath $legacyPalette -Force; $removed.Add("legacy:%APPDATA%\Blockwright\palettes.json") }
    }
    if ((Test-Path -LiteralPath $legacyRoot -PathType Container) -and @(Get-ChildItem -LiteralPath $legacyRoot -Force).Count -eq 0) {
        if ($PSCmdlet.ShouldProcess($legacyRoot, "Remove the now-empty exact legacy Blockwright directory")) { Remove-Item -LiteralPath $legacyRoot -Force }
    }
}
if ((Test-Path -LiteralPath $resolvedStateRoot -PathType Container) -and @(Get-ChildItem -LiteralPath $resolvedStateRoot -Force).Count -eq 0) {
    if ($PSCmdlet.ShouldProcess($resolvedStateRoot, "Remove empty Blockwright state directory")) { Remove-Item -LiteralPath $resolvedStateRoot -Force }
}
$result = [pscustomobject]@{ StateRoot = $resolvedStateRoot; StopStatus = $stopResult.Status; Removed = @($removed); Preserved = @($preserved); UserContentRemoved = [bool]$RemoveUserProjectsAndExports }
if ($PassThru) { $result } else { $result | ConvertTo-Json -Depth 5 }
