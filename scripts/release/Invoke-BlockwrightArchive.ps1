[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet("Expand", "Compress")][string]$Action,
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
)

$ErrorActionPreference = "Stop"
$sourcePath = [System.IO.Path]::GetFullPath($Source)
$destinationPath = [System.IO.Path]::GetFullPath($Destination)
if ($Action -eq "Expand") {
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Archive source is missing: $sourcePath" }
    if (-not (Test-Path -LiteralPath $destinationPath -PathType Container)) { $null = New-Item -ItemType Directory -Path $destinationPath -Force }
    Expand-Archive -LiteralPath $sourcePath -DestinationPath $destinationPath -Force
    exit 0
}
if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) { throw "Archive source directory is missing: $sourcePath" }
if (Test-Path -LiteralPath $destinationPath) { throw "Archive destination already exists: $destinationPath" }
$null = New-Item -ItemType Directory -Path (Split-Path -Parent $destinationPath) -Force
$tarPath = Join-Path $env:SystemRoot "System32\tar.exe"
if (-not (Test-Path -LiteralPath $tarPath -PathType Leaf)) { throw "Windows tar.exe is required for practical release ZIP creation: $tarPath" }
$sourceParent = Split-Path -Parent $sourcePath
$sourceName = Split-Path -Leaf $sourcePath
& $tarPath -a -c -f $destinationPath -C $sourceParent $sourceName
if ($LASTEXITCODE -ne 0) { throw "tar.exe could not create the portable ZIP (exit $LASTEXITCODE)." }
