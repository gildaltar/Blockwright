[CmdletBinding()]
param(
    [string]$InstallRoot,
    [string]$StateRoot,
    [string]$OutputPath,
    [ValidateRange(1, 20)][int]$MaximumFilesPerCategory = 5,
    [ValidateRange(65536, 5242880)][int]$MaximumFileBytes = 2097152,
    [switch]$SelfTest,
    [switch]$PassThru
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0
Import-Module (Join-Path $PSScriptRoot "Blockwright-Paths.psm1") -Force
$resolvedInstallRoot = Resolve-BlockwrightInstallRoot -InstallRoot $InstallRoot
$resolvedStateRoot = Get-BlockwrightStateRoot -InstallRoot $resolvedInstallRoot -StateRoot $StateRoot

function Protect-BlockwrightText {
    param([string]$Text)
    if ($null -eq $Text) { return "" }
    $value = $Text
    $knownPaths = @(
        @($resolvedInstallRoot, "%BLOCKWRIGHT_INSTALL%"),
        @($resolvedStateRoot, "%BLOCKWRIGHT_STATE%"),
        @($env:USERPROFILE, "%USERPROFILE%")
    )
    foreach ($item in $knownPaths) {
        if (-not [string]::IsNullOrWhiteSpace([string]$item[0])) { $value = $value -replace [regex]::Escape([string]$item[0]), [string]$item[1] }
    }
    if (-not [string]::IsNullOrWhiteSpace($env:USERNAME)) { $value = $value -replace [regex]::Escape($env:USERNAME), "%USERNAME%" }
    $value = $value -replace '(?i)(authorization\s*:\s*bearer\s+)[^\s"'']+', '$1%REDACTED_TOKEN%'
    $value = $value -replace '(?i)(api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|secret|password)(\s*[=:]\s*)[^\s,;"'']+', '$1$2%REDACTED_SECRET%'
    $value = $value -replace '(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}(?![A-Za-z0-9_-])', '%REDACTED_JWT%'
    $value = $value -replace '(?i)([?&](?:token|key|secret|signature|sig)=)[^&\s]+', '$1%REDACTED_SECRET%'
    $value = $value -replace '(?i)(?<![%A-Z0-9_])(?:[A-Z]:\\|\\\\)[^\r\n\t"''<>|]+', '%REDACTED_PATH%'
    return $value
}

if ($SelfTest) {
    $sample = "user=$env:USERNAME path=$env:USERPROFILE\worlds\secret token=abc.def.ghi Authorization: Bearer do-not-leak api_key=hidden"
    $redacted = Protect-BlockwrightText -Text $sample
    if ($redacted -match [regex]::Escape($env:USERNAME) -or $redacted -match 'do-not-leak|api_key=hidden') { throw "Support bundle redaction self-test failed." }
    [pscustomobject]@{ Valid = $true; Redacted = $redacted } | ConvertTo-Json -Compress
    exit 0
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $downloads = Join-Path $env:USERPROFILE "Downloads"
    if (-not (Test-Path -LiteralPath $downloads -PathType Container)) { $downloads = $resolvedStateRoot }
    $OutputPath = Join-Path $downloads ("Blockwright-support-{0}.zip" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
}
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$workParent = Join-Path $resolvedStateRoot "support-work"
$workRoot = Join-Path $workParent ([guid]::NewGuid().ToString("N"))
if (-not (Test-BlockwrightChildPath -Parent $workParent -Candidate $workRoot)) { throw "Refusing unsafe support-bundle work path: $workRoot" }
$null = New-Item -ItemType Directory -Path $workRoot -Force
$included = New-Object 'System.Collections.Generic.List[string]'

function Add-RedactedFile {
    param([Parameter(Mandatory = $true)][string]$Source, [Parameter(Mandatory = $true)][string]$DestinationName)
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { return }
    $item = Get-Item -LiteralPath $Source
    if ($item.Length -gt $MaximumFileBytes) { return }
    $destination = Join-Path $workRoot $DestinationName
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force
    $text = Get-Content -Raw -LiteralPath $Source -ErrorAction Stop
    [System.IO.File]::WriteAllText($destination, (Protect-BlockwrightText -Text $text), (New-Object System.Text.UTF8Encoding($false)))
    $included.Add($DestinationName)
}

try {
    Add-RedactedFile -Source (Join-Path $resolvedStateRoot "config.json") -DestinationName "state\config.json"
    Add-RedactedFile -Source (Join-Path $resolvedStateRoot "install-state.json") -DestinationName "state\install-state.json"
    Add-RedactedFile -Source (Join-Path $resolvedInstallRoot "release-manifest.json") -DestinationName "install\release-manifest.json"
    foreach ($category in @("logs", "crashes")) {
        $categoryRoot = Join-Path $resolvedStateRoot $category
        if (-not (Test-Path -LiteralPath $categoryRoot -PathType Container)) { continue }
        foreach ($file in @(Get-ChildItem -LiteralPath $categoryRoot -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First $MaximumFilesPerCategory)) {
            Add-RedactedFile -Source $file.FullName -DestinationName "$category\$($file.Name)"
        }
    }
    $manifest = [ordered]@{
        schemaVersion = 1
        generatedAt = [datetimeoffset]::UtcNow.ToString("o")
        privacy = "Allowlisted diagnostics only. Projects, exports, palettes, worlds, schematics, and environment variables are excluded."
        included = @($included)
        redactions = @("username", "user profile", "install/state paths", "tokens", "secrets", "unrelated absolute paths")
    }
    [System.IO.File]::WriteAllText((Join-Path $workRoot "manifest.json"), (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $resolvedOutput -PathType Leaf) { throw "Support bundle output already exists: $resolvedOutput" }
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $resolvedOutput) -Force
    Compress-Archive -Path (Join-Path $workRoot '*') -DestinationPath $resolvedOutput -CompressionLevel Optimal
    $result = [pscustomobject]@{ Path = $resolvedOutput; IncludedFiles = $included.Count; ExcludedUserContent = @("projects", "exports", "palettes", "worlds", "schematics") }
    if ($PassThru) { $result } else { Write-Output "Created redacted support bundle: $resolvedOutput" }
} finally {
    if ((Test-BlockwrightChildPath -Parent $workParent -Candidate $workRoot) -and (Test-Path -LiteralPath $workRoot -PathType Container)) {
        Remove-Item -LiteralPath $workRoot -Recurse -Force
    }
}
