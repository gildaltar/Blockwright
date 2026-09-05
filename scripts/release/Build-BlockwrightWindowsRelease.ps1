[CmdletBinding()]
param(
    [switch]$KeepWork,
    [switch]$SkipSourceBuild,
    [string]$RuntimeArchive,
    [string]$OutputDirectory,
    [string]$TrustedPublisherThumbprint
)

$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") { throw "The Windows installer release wrapper requires Windows." }
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$toolchain = & (Join-Path $PSScriptRoot "Install-PinnedInnoSetup.ps1") -PassThru
try {
    $arguments = @((Join-Path $PSScriptRoot "build-windows-release.mjs"), "--installer", "--iscc", $toolchain.CompilerPath)
    if ($KeepWork) { $arguments += "--keep-work" }
    if ($SkipSourceBuild) { $arguments += "--skip-source-build" }
    if (-not [string]::IsNullOrWhiteSpace($RuntimeArchive)) { $arguments += @("--runtime-archive", [System.IO.Path]::GetFullPath($RuntimeArchive)) }
    if (-not [string]::IsNullOrWhiteSpace($OutputDirectory)) { $arguments += @("--out-dir", [System.IO.Path]::GetFullPath($OutputDirectory)) }
    if (-not [string]::IsNullOrWhiteSpace($TrustedPublisherThumbprint)) { $arguments += @("--trusted-publisher-thumbprint", $TrustedPublisherThumbprint) }
    Push-Location $repositoryRoot
    try {
        & node @arguments
        if ($LASTEXITCODE -ne 0) { throw "Windows release builder exited with code $LASTEXITCODE." }
    } finally {
        Pop-Location
    }
} finally {
    $acquisitionRoot = [System.IO.Path]::GetFullPath($toolchain.AcquisitionRoot)
    $temporaryRoots = @($env:RUNNER_TEMP, [System.IO.Path]::GetTempPath()) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { [System.IO.Path]::GetFullPath($_).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar }
    $safeToRemove = @($temporaryRoots | Where-Object { $acquisitionRoot.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0
    if (-not $safeToRemove) { throw "Refusing to remove an unexpected Inno Setup acquisition root: $acquisitionRoot" }
    $uninstaller = Join-Path (Split-Path -Parent $toolchain.CompilerPath) "unins000.exe"
    if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
        $process = Start-Process -FilePath $uninstaller -ArgumentList "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART" -Wait -PassThru -WindowStyle Hidden
        if ($process.ExitCode -ne 0) { Write-Warning "Temporary Inno Setup uninstaller exited with code $($process.ExitCode)." }
    }
    if (Test-Path -LiteralPath $acquisitionRoot -PathType Container) { Remove-Item -LiteralPath $acquisitionRoot -Recurse -Force }
}
