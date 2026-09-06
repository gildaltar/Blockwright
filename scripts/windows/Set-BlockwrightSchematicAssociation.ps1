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
$launcher = Join-Path $resolvedInstallRoot "Blockwright.exe"
$openCommand = '"' + $launcher + '" --open-schematic "%1"'
$iconCommand = "$launcher,0"

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

function Test-AssociationMarker {
    param([object]$Marker)
    if (-not (Test-AssociationMarkerIdentity -Marker $Marker)) { return $false }
    return ([string]$Marker.command -ceq $openCommand) -and ([string]$Marker.icon -ceq $iconCommand)
}

function Test-AssociationMarkerIdentity {
    param([object]$Marker)
    if ($null -eq $Marker -or [int]$Marker.schemaVersion -ne 2 -or [string]$Marker.programId -cne $programId) { return $false }
    $properties = @($Marker.PSObject.Properties.Name)
    foreach ($requiredProperty in @("previousDefaultPresent", "previousProgramId", "extensionKeyCreated", "command", "icon", "installRoot")) {
        if ($properties -notcontains $requiredProperty) { return $false }
    }
    if ([string]::IsNullOrWhiteSpace([string]$Marker.installRoot)) { return $false }
    try {
        if (-not ([System.IO.Path]::GetFullPath([string]$Marker.installRoot)).Equals($resolvedInstallRoot, [StringComparison]::OrdinalIgnoreCase)) { return $false }
    } catch {
        return $false
    }
    return $true
}

function Write-AssociationMarker {
    param([Parameter(Mandatory = $true)][object]$Marker)
    $markerRoot = Split-Path -Parent $markerPath
    $null = New-Item -ItemType Directory -Path $markerRoot -Force
    $temporaryMarker = Join-Path $markerRoot (".{0}.{1}.tmp" -f ([System.IO.Path]::GetFileName($markerPath)), [guid]::NewGuid().ToString("N"))
    try {
        [System.IO.File]::WriteAllText($temporaryMarker, (($Marker | ConvertTo-Json -Depth 5) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temporaryMarker -Destination $markerPath -Force
    } finally {
        if (Test-Path -LiteralPath $temporaryMarker -PathType Leaf) { Remove-Item -LiteralPath $temporaryMarker -Force }
    }
}

function Restore-PreviousExtensionDefault {
    param([Parameter(Mandatory = $true)][object]$Previous)
    if ([bool]$Previous.ValueExists) {
        if (-not (Test-Path -LiteralPath $extensionKey)) { $null = New-Item -Path $extensionKey -Force }
        Set-Item -Path $extensionKey -Value ([string]$Previous.Value)
    } else {
        Remove-RegistryDefaultValue -Path $extensionKey
        if (-not [bool]$Previous.KeyExists) { Remove-RegistryKeyIfEmpty -Path $extensionKey }
    }
}

function Undo-PartialAssociation {
    param([Parameter(Mandatory = $true)][object]$Previous)
    $failures = New-Object 'System.Collections.Generic.List[string]'
    try {
        if (Test-Path -LiteralPath $programKey) { Remove-Item -LiteralPath $programKey -Recurse -Force }
    } catch {
        $failures.Add("owned ProgID cleanup failed: $($_.Exception.Message)")
    }
    try {
        Restore-PreviousExtensionDefault -Previous $Previous
    } catch {
        $failures.Add("prior extension default restoration failed: $($_.Exception.Message)")
    }
    try {
        if (Test-Path -LiteralPath $markerPath -PathType Leaf) { Remove-Item -LiteralPath $markerPath -Force }
    } catch {
        $failures.Add("partial ownership-marker cleanup failed: $($_.Exception.Message)")
    }
    return @($failures)
}

function Restore-OwnedAssociationForRetry {
    if (-not (Test-Path -LiteralPath $extensionKey)) { $null = New-Item -Path $extensionKey -Force }
    Set-Item -Path $extensionKey -Value $programId
    $null = New-Item -Path $iconKey -Force
    Set-Item -Path $iconKey -Value $iconCommand
    $null = New-Item -Path $commandKey -Force
    Set-Item -Path $commandKey -Value $openCommand
}

if ($Remove) {
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { if ($PassThru) { [pscustomobject]@{ Status = "NotOwned" } }; exit 0 }
    $marker = Get-Content -Raw -LiteralPath $markerPath | ConvertFrom-Json
    if (-not (Test-AssociationMarker -Marker $marker)) { throw "The Blockwright schematic-association ownership marker does not match this installation; no registry state was changed." }
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
        try {
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
            $restored = Get-RegistryDefaultValueState -Path $extensionKey
            if ($previousDefaultPresent) {
                if (-not $restored.ValueExists -or $restored.Value -cne [string]$marker.previousProgramId) { throw "The prior .schem default was not restored exactly." }
            } elseif ($restored.ValueExists) {
                throw "The .schem default still exists even though it was absent before Blockwright registration."
            }
            if (Test-Path -LiteralPath $programKey) { throw "The owned Blockwright schematic ProgID is still present after cleanup." }
            Remove-Item -LiteralPath $markerPath -Force
        } catch {
            $removalFailure = $_.Exception.Message
            try {
                Restore-OwnedAssociationForRetry
            } catch {
                throw "$removalFailure The association cleanup could not restore a retryable owned state: $($_.Exception.Message)"
            }
            throw "$removalFailure The Blockwright association and ownership marker were restored so cleanup can be retried."
        }
        if ($PassThru) { [pscustomobject]@{ Status = "Removed"; Restored = $marker.previousProgramId } }
    }
    exit 0
}

if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw "The native Blockwright schematic launcher is missing: $launcher" }
$previous = Get-RegistryDefaultValueState -Path $extensionKey
if ($previous.ValueExists -and $previous.Value -eq $programId -and (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
    $existingMarker = Get-Content -Raw -LiteralPath $markerPath | ConvertFrom-Json
    $existingCommand = Get-RegistryDefaultValueState -Path $commandKey
    $existingIcon = Get-RegistryDefaultValueState -Path $iconKey
    if (-not (Test-AssociationMarkerIdentity -Marker $existingMarker) -or -not $existingCommand.ValueExists -or
        $existingCommand.Value -cne [string]$existingMarker.command -or -not $existingIcon.ValueExists -or $existingIcon.Value -cne [string]$existingMarker.icon) {
        throw "The existing Blockwright .schem association or ownership marker does not match this installation and was left unchanged."
    }
    if (Test-AssociationMarker -Marker $existingMarker) {
        if ($PassThru) { [pscustomobject]@{ Status = "AlreadyAssociated" } }
        exit 0
    }
    if ($PSCmdlet.ShouldProcess(".schem", "Migrate the owned Blockwright association to Blockwright.exe")) {
        Set-Item -Path $iconKey -Value $iconCommand
        Set-Item -Path $commandKey -Value $openCommand
        $existingMarker.command = $openCommand
        $existingMarker.icon = $iconCommand
        Write-AssociationMarker -Marker $existingMarker
        if ($PassThru) { [pscustomobject]@{ Status = "Updated"; Marker = $markerPath } }
    }
    exit 0
}
if ($previous.ValueExists -and $previous.Value -eq $programId -and -not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
    throw "The .schem extension already names Blockwright's ProgID, but this installation has no ownership marker. It was not adopted."
}
if (Test-Path -LiteralPath $markerPath -PathType Leaf) { throw "A stale Blockwright schematic-association marker exists and was left unchanged." }
if (Test-Path -LiteralPath $markerPath) { throw "The Blockwright schematic-association marker path is not a file and was left unchanged: $markerPath" }
if (Test-Path -LiteralPath $programKey) { throw "The per-user ProgID $programId already exists and was left unchanged." }
if ($PSCmdlet.ShouldProcess(".schem", "Associate with Blockwright for the current user")) {
    try {
        if (-not $previous.KeyExists) { $null = New-Item -Path $extensionKey -Force }
        Set-Item -Path $extensionKey -Value $programId
        $null = New-Item -Path "$programKey\DefaultIcon" -Force
        Set-Item -Path $iconKey -Value $iconCommand
        $null = New-Item -Path $commandKey -Force
        Set-Item -Path $commandKey -Value $openCommand
        $marker = [ordered]@{ schemaVersion = 2; programId = $programId; previousDefaultPresent = $previous.ValueExists; previousProgramId = $previous.Value; extensionKeyCreated = (-not $previous.KeyExists); command = $openCommand; icon = $iconCommand; installRoot = $resolvedInstallRoot }
        Write-AssociationMarker -Marker $marker
        $persistedMarker = Get-Content -Raw -LiteralPath $markerPath | ConvertFrom-Json
        if (-not (Test-AssociationMarker -Marker $persistedMarker)) { throw "The schematic-association ownership marker did not persist its exact expected contents." }
    } catch {
        $associationFailure = $_.Exception.Message
        $rollbackFailures = @(Undo-PartialAssociation -Previous $previous)
        if ($rollbackFailures.Count -gt 0) {
            throw "$associationFailure Automatic registry rollback was incomplete: $($rollbackFailures -join '; ')"
        }
        throw "$associationFailure The prior .schem association was restored."
    }
    if ($PassThru) { [pscustomobject]@{ Status = "Associated"; Previous = $previous.Value; Marker = $markerPath } }
}
