[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$Remove,
    [switch]$BackupExisting,
    [string]$ShortcutDirectory,
    [switch]$PassThru
)

$ErrorActionPreference = "Stop"
$ShortcutName = "Blockwright Control Center.lnk"
$ShortcutDescription = "Blockwright Windows Control Center"
if ([string]::IsNullOrWhiteSpace($ShortcutDirectory)) {
    $ShortcutDirectory = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
}
$ProgramsDirectory = [System.IO.Path]::GetFullPath($ShortcutDirectory)
$ShortcutPath = [System.IO.Path]::GetFullPath((Join-Path $ProgramsDirectory $ShortcutName))
$ExpectedShortcutPath = Join-Path $ProgramsDirectory $ShortcutName

if (-not $ShortcutPath.Equals($ExpectedShortcutPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify an unexpected shortcut path: $ShortcutPath"
}

$launcherPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "Launch-Blockwright-ControlCenter.vbs"))
$wscriptPath = [System.IO.Path]::GetFullPath((Join-Path $env:SystemRoot "System32\wscript.exe"))
$windowsPowerShellPath = [System.IO.Path]::GetFullPath((Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"))
$expectedArguments = '//nologo "' + $launcherPath + '"'
$shell = New-Object -ComObject WScript.Shell

function Test-OwnedShortcut {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    try {
        $existingShortcut = $shell.CreateShortcut($Path)
        $existingTargetPath = [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables([string]$existingShortcut.TargetPath))
        $targetMatches = $existingTargetPath.Equals($wscriptPath, [System.StringComparison]::OrdinalIgnoreCase)
        $argumentsMatch = ([string]$existingShortcut.Arguments).Equals($expectedArguments, [System.StringComparison]::Ordinal)
        return $existingShortcut.Description -eq $ShortcutDescription -and $targetMatches -and $argumentsMatch
    } catch {
        return $false
    }
}

if ($Remove) {
    if (-not (Test-Path -LiteralPath $ShortcutPath -PathType Leaf)) {
        Write-Output "The Blockwright Start Menu shortcut is not installed."
        if ($PassThru) { [pscustomobject]@{ Status = "NotFound"; Path = $ShortcutPath } }
        exit 0
    }
    if (-not (Test-OwnedShortcut -Path $ShortcutPath)) {
        throw "A shortcut with the same name exists, but its description, target, or launcher arguments do not match this Blockwright package. It was left unchanged."
    }
    if ($PSCmdlet.ShouldProcess($ShortcutPath, "Remove exact Blockwright Start Menu shortcut")) {
        Remove-Item -LiteralPath $ShortcutPath -Force
        Write-Output "Removed the Blockwright Start Menu shortcut."
        if ($PassThru) { [pscustomobject]@{ Status = "Removed"; Path = $ShortcutPath } }
    }
    exit 0
}

if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
    throw "The stable Blockwright launcher is missing: $launcherPath"
}
if (-not (Test-Path -LiteralPath $wscriptPath -PathType Leaf)) {
    throw "Windows Script Host was not found: $wscriptPath"
}
if (-not (Test-Path -LiteralPath $windowsPowerShellPath -PathType Leaf)) {
    throw "Windows PowerShell was not found: $windowsPowerShellPath"
}

$existingOwned = Test-OwnedShortcut -Path $ShortcutPath
$backupPath = $null
if ((Test-Path -LiteralPath $ShortcutPath -PathType Leaf) -and -not $existingOwned) {
    if (-not $BackupExisting) {
        throw "A same-name shortcut is already present but is not owned by this Blockwright package. It was left unchanged. Re-run with -BackupExisting to preserve it beside the new shortcut."
    }
    $backupName = "Blockwright Control Center.unowned-{0}.lnk" -f (Get-Date -Format "yyyyMMdd-HHmmssfff")
    $backupPath = [System.IO.Path]::GetFullPath((Join-Path $ProgramsDirectory $backupName))
    if ($PSCmdlet.ShouldProcess($ShortcutPath, "Back up unowned same-name shortcut to $backupPath")) {
        if (-not (Test-Path -LiteralPath $ProgramsDirectory -PathType Container)) {
            $null = New-Item -ItemType Directory -Path $ProgramsDirectory -Force
        }
        Move-Item -LiteralPath $ShortcutPath -Destination $backupPath
        Write-Output "Backed up the unowned same-name shortcut to $backupPath"
    } else {
        exit 0
    }
}

if ($PSCmdlet.ShouldProcess($ShortcutPath, "Create or update Blockwright Start Menu shortcut")) {
    if (-not (Test-Path -LiteralPath $ProgramsDirectory -PathType Container)) {
        $null = New-Item -ItemType Directory -Path $ProgramsDirectory -Force
    }
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = $wscriptPath
    $shortcut.Arguments = $expectedArguments
    $shortcut.WorkingDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
    $shortcut.Description = $ShortcutDescription
    $shortcut.IconLocation = "$windowsPowerShellPath,0"
    $shortcut.Save()
    $status = if ($existingOwned) { "Updated" } elseif ($null -ne $backupPath) { "ReplacedWithBackup" } else { "Installed" }
    Write-Output "$status the Blockwright Start Menu shortcut."
    if ($PassThru) { [pscustomobject]@{ Status = $status; Path = $ShortcutPath; Launcher = $launcherPath; Backup = $backupPath } }
}
