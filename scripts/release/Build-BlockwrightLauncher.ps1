[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [string]$Version
)

$ErrorActionPreference = "Stop"
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = [string]((Get-Content -Raw -LiteralPath (Join-Path $repositoryRoot "package.json") | ConvertFrom-Json).version)
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Launcher version must be a stable major.minor.patch version." }
$numericVersion = "$Version.0"
$sourcePath = Join-Path $repositoryRoot "launcher\windows\BlockwrightLauncher.cs"
$manifestPath = Join-Path $repositoryRoot "launcher\windows\BlockwrightLauncher.manifest"
$iconPath = Join-Path $repositoryRoot "installer\windows\assets\blockwright-v060.ico"
foreach ($required in @($sourcePath, $manifestPath, $iconPath, (Join-Path $PSScriptRoot "Test-BlockwrightLauncherBinary.ps1"))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Native launcher build input is missing: $required" }
}

$compilerCandidates = @(
    (Join-Path $env:SystemRoot "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
    (Join-Path $env:SystemRoot "Microsoft.NET\Framework\v4.0.30319\csc.exe")
)
$compilerPath = @($compilerCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1)
if ($compilerPath.Count -ne 1) { throw "The Windows .NET Framework C# compiler was not found. Blockwright.exe cannot be built on this host." }

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
if ([System.IO.Path]::GetExtension($resolvedOutput) -cne ".exe" -or [System.IO.Path]::GetFileName($resolvedOutput) -cne "Blockwright.exe") {
    throw "The launcher output must be an exact Blockwright.exe path."
}
$outputDirectory = Split-Path -Parent $resolvedOutput
if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) { $null = New-Item -ItemType Directory -Path $outputDirectory -Force }
$buildId = [guid]::NewGuid().ToString("N")
$assemblyInfoPath = Join-Path ([System.IO.Path]::GetTempPath()) "Blockwright-Launcher-AssemblyInfo-$buildId.cs"
$partialDirectory = Join-Path $outputDirectory ".blockwright-launcher-$buildId"
$partialOutput = Join-Path $partialDirectory "Blockwright.exe"
$assemblyInfo = @"
using System.Reflection;
[assembly: AssemblyTitle("Blockwright Windows Launcher")]
[assembly: AssemblyDescription("Blockwright Windows Launcher")]
[assembly: AssemblyCompany("Blockwright Contributors")]
[assembly: AssemblyProduct("Blockwright")]
[assembly: AssemblyCopyright("Copyright (c) Blockwright Contributors")]
[assembly: AssemblyVersion("$numericVersion")]
[assembly: AssemblyFileVersion("$numericVersion")]
[assembly: AssemblyInformationalVersion("$Version")]
"@

try {
    $null = New-Item -ItemType Directory -Path $partialDirectory
    [System.IO.File]::WriteAllText($assemblyInfoPath, $assemblyInfo, (New-Object System.Text.UTF8Encoding($false)))
    $compilerArguments = @(
        "/nologo",
        "/target:winexe",
        "/platform:x64",
        "/optimize+",
        "/debug-",
        "/warn:4",
        "/warnaserror+",
        "/win32icon:$iconPath",
        "/win32manifest:$manifestPath",
        "/out:$partialOutput",
        $sourcePath,
        $assemblyInfoPath
    )
    & $compilerPath[0] $compilerArguments
    if ($LASTEXITCODE -ne 0) { throw "The .NET Framework C# compiler failed with exit code $LASTEXITCODE." }
    $evidenceText = & (Join-Path $PSScriptRoot "Test-BlockwrightLauncherBinary.ps1") -Artifact $partialOutput -Version $Version -ExpectedAuthenticodeStatus NotSigned
    if ($LASTEXITCODE -ne 0) { throw "The newly built Blockwright.exe did not pass native launcher validation." }
    $evidence = $evidenceText | ConvertFrom-Json
    Move-Item -LiteralPath $partialOutput -Destination $resolvedOutput -Force
    [pscustomobject][ordered]@{
        artifact = $resolvedOutput
        version = $Version
        sha256 = [string]$evidence.sha256
        sizeBytes = [long]$evidence.sizeBytes
        authenticode = "not-signed"
        trust = "unsigned-local-build"
        compiler = [System.IO.Path]::GetFileName($compilerPath[0])
    } | ConvertTo-Json -Compress
} finally {
    if (Test-Path -LiteralPath $assemblyInfoPath -PathType Leaf) { Remove-Item -LiteralPath $assemblyInfoPath -Force }
    if (Test-Path -LiteralPath $partialOutput -PathType Leaf) { Remove-Item -LiteralPath $partialOutput -Force }
    if (Test-Path -LiteralPath $partialDirectory -PathType Container) { Remove-Item -LiteralPath $partialDirectory -Force }
}
