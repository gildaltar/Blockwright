[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$InstallRoot,
    [string]$StateRoot,
    [ValidatePattern('^HKCU:\\Software\\[^"\r\n]+$')][string]$RegistryClassesRoot = "HKCU:\Software\Classes",
    [switch]$Remove,
    [switch]$PassThru
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "Blockwright-Paths.psm1") -Force
$resolvedInstallRoot = Resolve-BlockwrightInstallRoot -InstallRoot $InstallRoot
$resolvedStateRoot = Get-BlockwrightStateRoot -InstallRoot $resolvedInstallRoot -StateRoot $StateRoot
$markerPath = Join-Path $resolvedStateRoot "integration\schem-association.json"
$RegistryClassesRoot = $RegistryClassesRoot.TrimEnd('\')
$extensionKey = "$RegistryClassesRoot\.schem"
$programId = "Blockwright.Schematic.1"
$programKey = "$RegistryClassesRoot\$programId"
$openScript = Join-Path $resolvedInstallRoot "scripts\windows\Open-BlockwrightSchematic.ps1"
$powershell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$openCommand = '"' + $powershell + '" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + $openScript + '" -Path "%1" -InstallRoot "' + $resolvedInstallRoot + '"'
$iconCommand = "$powershell,0"

function Get-RegistryDefaultValueState {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return [pscustomobject]@{ KeyExists = $false; ValueExists = $false; Value = $null } }
    $key = Get-Item -LiteralPath $Path
    try {
        $valueExists = @($key.GetValueNames()) -contains ""
        $value = if ($valueExists) { [string]$key.GetValue("", $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { $null }
        return [pscustomobject]@{ KeyExists = $true; ValueExists = $valueExists; Value = $value }
    } finally {
        $key.Dispose()
    }
}

function Remove-RegistryDefaultValue {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    if (-not $Path.StartsWith("HKCU:\", [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing a non-HKCU registry path: $Path" }
    $relativePath = $Path.Substring("HKCU:\".Length)
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($relativePath, $true)
    if ($null -eq $key) { throw "Could not open the per-user registry key for scoped cleanup: $Path" }
    try { $key.DeleteValue("", $false) } finally { $key.Dispose() }
}

function Remove-RegistryKeyIfEmpty {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $key = Get-Item -LiteralPath $Path
    try { $empty = ($key.SubKeyCount -eq 0 -and $key.ValueCount -eq 0) } finally { $key.Dispose() }
    if ($empty) { Remove-Item -LiteralPath $Path -Force }
}

$commandKey = "$programKey\shell\open\command"
$iconKey = "$programKey\DefaultIcon"

if ($Remove) {
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { if ($PassThru) { [pscustomobject]@{ Status = "NotOwned" } }; exit 0 }
    $marker = Get-Content -Raw -LiteralPath $markerPath | ConvertFrom-Json
    $current = Get-RegistryDefaultValueState -Path $extensionKey
    if (-not $current.ValueExists -or $current.Value -ne $programId) { throw "The current .schem association is no longer owned by Blockwright and was left unchanged." }
    $currentCommand = Get-RegistryDefaultValueState -Path $commandKey
    $currentIcon = Get-RegistryDefaultValueState -Path $iconKey
    if (-not $currentCommand.ValueExists -or $currentCommand.Value -ne [string]$marker.command -or -not $currentIcon.ValueExists -or $currentIcon.Value -ne $iconCommand) {
        throw "The Blockwright schematic ProgID was modified after registration and was left unchanged."
    }
    $markerProperties = @($marker.PSObject.Properties.Name)
    $previousDefaultPresent = if ($markerProperties -contains "previousDefaultPresent") { [bool]$marker.previousDefaultPresent } else { -not [string]::IsNullOrWhiteSpace([string]$marker.previousProgramId) }
    $extensionKeyCreated = if ($markerProperties -contains "extensionKeyCreated") { [bool]$marker.extensionKeyCreated } else { $false }
    if ($PSCmdlet.ShouldProcess(".schem", "Remove Blockwright association and restore the prior per-user association")) {
        Remove-RegistryDefaultValue -Path $commandKey
        Remove-RegistryKeyIfEmpty -Path $commandKey
        Remove-RegistryKeyIfEmpty -Path "$programKey\shell\open"
        Remove-RegistryKeyIfEmpty -Path "$programKey\shell"
        Remove-RegistryDefaultValue -Path $iconKey
        Remove-RegistryKeyIfEmpty -Path $iconKey
        Remove-RegistryKeyIfEmpty -Path $programKey
        if ($previousDefaultPresent) {
            Set-Item -Path $extensionKey -Value ([string]$marker.previousProgramId)
        } else {
            Remove-RegistryDefaultValue -Path $extensionKey
            if ($extensionKeyCreated) { Remove-RegistryKeyIfEmpty -Path $extensionKey }
        }
        Remove-Item -LiteralPath $markerPath -Force
        if ($PassThru) { [pscustomobject]@{ Status = "Removed"; Restored = $marker.previousProgramId } }
    }
    exit 0
}

if (-not (Test-Path -LiteralPath $openScript -PathType Leaf)) { throw "The Blockwright schematic launcher is missing: $openScript" }
$previous = Get-RegistryDefaultValueState -Path $extensionKey
if ($previous.ValueExists -and $previous.Value -eq $programId -and (Test-Path -LiteralPath $markerPath -PathType Leaf)) { if ($PassThru) { [pscustomobject]@{ Status = "AlreadyAssociated" } }; exit 0 }
if (Test-Path -LiteralPath $markerPath -PathType Leaf) { throw "A stale Blockwright schematic-association marker exists and was left unchanged." }
if (Test-Path -LiteralPath $programKey) { throw "The per-user ProgID $programId already exists and was left unchanged." }
if ($PSCmdlet.ShouldProcess(".schem", "Associate with Blockwright for the current user")) {
    if (-not $previous.KeyExists) { $null = New-Item -Path $extensionKey -Force }
    Set-Item -Path $extensionKey -Value $programId
    $null = New-Item -Path "$programKey\DefaultIcon" -Force
    Set-Item -Path $iconKey -Value $iconCommand
    $null = New-Item -Path $commandKey -Force
    Set-Item -Path $commandKey -Value $openCommand
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $markerPath) -Force
    $marker = [ordered]@{ schemaVersion = 2; programId = $programId; previousDefaultPresent = $previous.ValueExists; previousProgramId = $previous.Value; extensionKeyCreated = (-not $previous.KeyExists); command = $openCommand; icon = $iconCommand; installRoot = $resolvedInstallRoot }
    [System.IO.File]::WriteAllText($markerPath, (($marker | ConvertTo-Json -Depth 5) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
    if ($PassThru) { [pscustomobject]@{ Status = "Associated"; Previous = $previous.Value; Marker = $markerPath } }
}
