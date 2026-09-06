[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$InstallRoot
)

$ErrorActionPreference = "Stop"
$resolvedPath = [System.IO.Path]::GetFullPath($Path)
if (-not (Test-Path -LiteralPath $resolvedPath -PathType Leaf)) { throw "The schematic file does not exist: $resolvedPath" }
if ([System.IO.Path]::GetExtension($resolvedPath) -ne ".schem") { throw "Blockwright's file association accepts only .schem files." }
$resolvedInstallRoot = if ([string]::IsNullOrWhiteSpace($InstallRoot)) { [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..")) } else { [System.IO.Path]::GetFullPath($InstallRoot) }
$launcher = Join-Path $resolvedInstallRoot "Blockwright.exe"
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw "The native Blockwright launcher is missing: $launcher" }
Start-Process -FilePath $launcher -ArgumentList @('--open-schematic', ('"' + $resolvedPath + '"')) -WindowStyle Hidden
