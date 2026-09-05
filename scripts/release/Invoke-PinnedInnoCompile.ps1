[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$CompilerPath,
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$StageDir,
    [Parameter(Mandatory = $true)][string]$OutputDir,
    [string]$ScriptPath
)

$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") { throw "Inno Setup compilation requires Windows." }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Inno Setup compilation requires a stable numeric MAJOR.MINOR.PATCH version." }
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$expectedScript = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot "installer\windows\Blockwright.iss"))
if ([string]::IsNullOrWhiteSpace($ScriptPath)) { $ScriptPath = $expectedScript }
$resolvedScript = [System.IO.Path]::GetFullPath($ScriptPath)
if (-not $resolvedScript.Equals($expectedScript, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing to compile an unexpected Inno Setup script: $resolvedScript" }
if (-not (Test-Path -LiteralPath $resolvedScript -PathType Leaf)) { throw "Blockwright Inno Setup script is missing: $resolvedScript" }
$resolvedStage = [System.IO.Path]::GetFullPath($StageDir)
if (-not (Test-Path -LiteralPath $resolvedStage -PathType Container)) { throw "Blockwright installer stage is missing: $resolvedStage" }
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDir)
if (-not (Test-Path -LiteralPath $resolvedOutput -PathType Container)) { throw "Blockwright installer output directory is missing: $resolvedOutput" }
$verified = & (Join-Path $PSScriptRoot "Test-PinnedInnoSetup.ps1") -CompilerPath $CompilerPath -PassThru
$resolvedCompiler = $verified.CompilerPath

& $resolvedCompiler "/Qp" "/DMyAppVersion=$Version" "/DStageDir=$resolvedStage" "/DReleaseOutputDir=$resolvedOutput" $resolvedScript
if ($LASTEXITCODE -ne 0) { throw "Pinned Inno Setup compiler exited with code $LASTEXITCODE." }
