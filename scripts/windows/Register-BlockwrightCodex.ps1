[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$InstallRoot,
    [string]$StateRoot,
    [string]$CodexExecutable = "codex",
    [switch]$Remove,
    [switch]$PassThru
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "Blockwright-Paths.psm1") -Force
$resolvedInstallRoot = Resolve-BlockwrightInstallRoot -InstallRoot $InstallRoot
$resolvedStateRoot = Get-BlockwrightStateRoot -InstallRoot $resolvedInstallRoot -StateRoot $StateRoot
$privateNode = Get-BlockwrightPrivateNode -InstallRoot $resolvedInstallRoot
$bridge = Join-Path $resolvedInstallRoot "mcp\server.mjs"
$wrapper = Join-Path $resolvedInstallRoot "scripts\windows\Launch-Blockwright-Mcp.cmd"
$commandProcessor = Join-Path $env:SystemRoot "System32\cmd.exe"
$name = "blockwright-local"
$markerPath = Join-Path $resolvedStateRoot "integration\codex.json"

function Get-ExistingConfiguration {
    $raw = @(& $CodexExecutable mcp get $name --json 2>$null)
    if ($LASTEXITCODE -ne 0 -or $raw.Count -eq 0) { return $null }
    try { return ($raw -join [Environment]::NewLine) | ConvertFrom-Json } catch { throw "Codex returned unreadable MCP configuration for $name." }
}

function Test-OwnedConfiguration {
    param([object]$Existing, [object]$Marker)
    if ($null -eq $Existing -or $null -eq $Marker -or $Existing.transport.type -ne "stdio") { return $false }
    if (-not ([string]$Existing.transport.command).Equals([string]$Marker.command, [StringComparison]::OrdinalIgnoreCase)) { return $false }
    $actualArgs = @($Existing.transport.args | ForEach-Object { [string]$_ })
    $expectedArgs = @($Marker.args | ForEach-Object { [string]$_ })
    return ($actualArgs.Count -eq $expectedArgs.Count -and (($actualArgs -join "`0").Equals(($expectedArgs -join "`0"), [StringComparison]::OrdinalIgnoreCase)))
}

$marker = if (Test-Path -LiteralPath $markerPath -PathType Leaf) { Get-Content -Raw -LiteralPath $markerPath | ConvertFrom-Json } else { $null }
if ($Remove) {
    if ($null -eq $marker) { if ($PassThru) { [pscustomobject]@{ Status = "NotOwned"; Name = $name } }; exit 0 }
    $existing = Get-ExistingConfiguration
    if ($null -eq $existing) { if ($PassThru) { [pscustomobject]@{ Status = "NotFound"; Name = $name } }; exit 0 }
    if (-not (Test-OwnedConfiguration -Existing $existing -Marker $marker)) { throw "Codex MCP entry '$name' is not proven to be owned by this installation and was left unchanged." }
    if ($PSCmdlet.ShouldProcess($name, "Remove owned Codex MCP configuration")) {
        & $CodexExecutable mcp remove $name
        if ($LASTEXITCODE -ne 0) { throw "Codex could not remove the owned MCP entry '$name'." }
        if (Test-Path -LiteralPath $markerPath -PathType Leaf) { Remove-Item -LiteralPath $markerPath -Force }
        if ($PassThru) { [pscustomobject]@{ Status = "Removed"; Name = $name } }
    }
    exit 0
}

$existing = Get-ExistingConfiguration
if ($null -eq $privateNode) { throw "The packaged private Node runtime is missing. Codex integration will not fall back to machine-wide Node.js." }
if (-not (Test-Path -LiteralPath $bridge -PathType Leaf)) { throw "The packaged MCP bridge is missing: $bridge" }
if (-not (Test-Path -LiteralPath $wrapper -PathType Leaf)) { throw "The private-runtime MCP launcher is missing: $wrapper" }
$desired = [ordered]@{ schemaVersion = 1; name = $name; command = $commandProcessor; args = @("/d", "/s", "/c", $wrapper); installRoot = $resolvedInstallRoot }
if ($null -ne $existing) {
    if (Test-OwnedConfiguration -Existing $existing -Marker $desired) { if ($PassThru) { [pscustomobject]@{ Status = "AlreadyRegistered"; Name = $name } }; exit 0 }
    throw "Codex already has an MCP entry named '$name'. It was left unchanged; remove or rename it explicitly before retrying."
}
if ($PSCmdlet.ShouldProcess($name, "Register Blockwright private-runtime MCP bridge with Codex")) {
    & $CodexExecutable mcp add $name -- $commandProcessor /d /s /c $wrapper
    if ($LASTEXITCODE -ne 0) { throw "Codex could not register the Blockwright MCP bridge." }
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $markerPath) -Force
    [System.IO.File]::WriteAllText($markerPath, (($desired | ConvertTo-Json -Depth 5) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
    if ($PassThru) { [pscustomobject]@{ Status = "Registered"; Name = $name; Marker = $markerPath } }
}
