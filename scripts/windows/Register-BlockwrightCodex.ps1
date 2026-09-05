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

function Invoke-CodexCommand {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    # Windows PowerShell 5.1 promotes native stderr to a NativeCommandError when
    # ErrorActionPreference is Stop, and a command-resolution failure can leave a
    # stale LASTEXITCODE behind. Isolate each call, reset the native status first,
    # and decide from both invocation success and the newly reported exit code.
    $previousErrorActionPreference = $ErrorActionPreference
    $previousLastExitCode = $global:LASTEXITCODE
    try {
        $ErrorActionPreference = "Continue"
        $global:LASTEXITCODE = $null
        $output = @(& $CodexExecutable @Arguments 2>&1)
        $invocationSucceeded = $?
        $nativeExitCode = $global:LASTEXITCODE
        if ($null -eq $nativeExitCode -or (-not $invocationSucceeded -and [int]$nativeExitCode -eq 0)) {
            $detail = (@($output | Select-Object -Last 6 | ForEach-Object { [string]$_ }) -join " ").Trim()
            if ($detail.Length -gt 500) { $detail = $detail.Substring(0, 497) + "..." }
            throw "Codex CLI did not start as a native process or did not report a trustworthy exit code.$(if ($detail) { " $detail" })"
        }
        $exitCode = [int]$nativeExitCode
    } catch {
        throw "Codex CLI could not be started from '$CodexExecutable'. $($_.Exception.Message)"
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
        $global:LASTEXITCODE = $previousLastExitCode
    }
    return [pscustomobject]@{ ExitCode = $exitCode; InvocationSucceeded = [bool]$invocationSucceeded; Output = @($output | ForEach-Object { [string]$_ }) }
}

function Get-CodexFailureDetail {
    param([Parameter(Mandatory = $true)][object]$Result)
    $detail = (@($Result.Output | Select-Object -Last 6) -join " ").Trim()
    if ($detail.Length -gt 500) { $detail = $detail.Substring(0, 497) + "..." }
    return $detail
}

function Get-ExistingConfiguration {
    $result = Invoke-CodexCommand -Arguments @("mcp", "get", $name, "--json")
    if ($result.ExitCode -ne 0) {
        $detail = Get-CodexFailureDetail -Result $result
        $expectedNotFound = $result.ExitCode -eq 1 -and
            $detail.IndexOf("No MCP server named", [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $detail.IndexOf($name, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $detail.IndexOf("found", [StringComparison]::OrdinalIgnoreCase) -ge 0
        if ($expectedNotFound) { return $null }
        throw "Codex MCP probe for '$name' failed with exit code $($result.ExitCode).$(if ($detail) { " $detail" })"
    }
    if ($result.Output.Count -eq 0) { throw "Codex returned an empty MCP configuration for $name." }
    try { return ($result.Output -join [Environment]::NewLine) | ConvertFrom-Json } catch { throw "Codex returned unreadable MCP configuration for $name." }
}

function Test-OwnedConfiguration {
    param([object]$Existing, [object]$Marker)
    if ($null -eq $Existing -or $null -eq $Marker -or $Existing.transport.type -ne "stdio") { return $false }
    if (-not ([string]$Existing.transport.command).Equals([string]$Marker.command, [StringComparison]::OrdinalIgnoreCase)) { return $false }
    $actualArgs = @($Existing.transport.args | ForEach-Object { [string]$_ })
    $expectedArgs = @($Marker.args | ForEach-Object { [string]$_ })
    return ($actualArgs.Count -eq $expectedArgs.Count -and (($actualArgs -join "`0").Equals(($expectedArgs -join "`0"), [StringComparison]::OrdinalIgnoreCase)))
}

function Test-OwnershipMarker {
    param(
        [object]$Marker,
        [Parameter(Mandatory = $true)][object]$Desired
    )
    if ($null -eq $Marker -or [int]$Marker.schemaVersion -ne 1 -or [string]$Marker.name -cne $name) { return $false }
    if ([string]::IsNullOrWhiteSpace([string]$Marker.installRoot)) { return $false }
    try {
        if (-not ([System.IO.Path]::GetFullPath([string]$Marker.installRoot)).Equals($resolvedInstallRoot, [StringComparison]::OrdinalIgnoreCase)) { return $false }
    } catch {
        return $false
    }
    $markerConfiguration = [pscustomobject]@{
        transport = [pscustomobject]@{
            type = "stdio"
            command = [string]$Marker.command
            args = @($Marker.args | ForEach-Object { [string]$_ })
        }
    }
    return Test-OwnedConfiguration -Existing $markerConfiguration -Marker $Desired
}

function Write-OwnershipMarker {
    param([Parameter(Mandatory = $true)][object]$Desired)
    $markerRoot = Split-Path -Parent $markerPath
    $null = New-Item -ItemType Directory -Path $markerRoot -Force
    $temporaryMarker = Join-Path $markerRoot (".{0}.{1}.tmp" -f ([System.IO.Path]::GetFileName($markerPath)), [guid]::NewGuid().ToString("N"))
    try {
        [System.IO.File]::WriteAllText($temporaryMarker, (($Desired | ConvertTo-Json -Depth 5) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temporaryMarker -Destination $markerPath -Force
    } finally {
        if (Test-Path -LiteralPath $temporaryMarker -PathType Leaf) { Remove-Item -LiteralPath $temporaryMarker -Force }
    }
}

function Undo-DesiredConfiguration {
    param([Parameter(Mandatory = $true)][object]$Desired)
    try {
        $current = Get-ExistingConfiguration
    } catch {
        return "the newly added entry could not be inspected: $($_.Exception.Message)"
    }
    if ($null -eq $current) { return $null }
    if (-not (Test-OwnedConfiguration -Existing $current -Marker $Desired)) {
        return "the current entry no longer exactly matches the configuration added by this installation and was left unchanged"
    }
    try {
        $rollbackResult = Invoke-CodexCommand -Arguments @("mcp", "remove", $name)
        if ($rollbackResult.ExitCode -ne 0) {
            $detail = Get-CodexFailureDetail -Result $rollbackResult
            return "Codex removal exited with code $($rollbackResult.ExitCode)$(if ($detail) { ": $detail" })"
        }
        $remaining = Get-ExistingConfiguration
        if ($null -ne $remaining) { return "Codex reported success but the entry is still present" }
    } catch {
        return $_.Exception.Message
    }
    return $null
}

$desired = [ordered]@{ schemaVersion = 1; name = $name; command = $commandProcessor; args = @("/d", "/s", "/c", $wrapper); installRoot = $resolvedInstallRoot }
$markerExisted = Test-Path -LiteralPath $markerPath -PathType Leaf
if ((Test-Path -LiteralPath $markerPath) -and -not $markerExisted) { throw "The Blockwright Codex ownership-marker path is not a file and was left unchanged: $markerPath" }
$marker = if ($markerExisted) { Get-Content -Raw -LiteralPath $markerPath | ConvertFrom-Json } else { $null }
if ($Remove) {
    if ($null -eq $marker) { if ($PassThru) { [pscustomobject]@{ Status = "NotOwned"; Name = $name } }; exit 0 }
    if (-not (Test-OwnershipMarker -Marker $marker -Desired $desired)) { throw "The Blockwright Codex ownership marker does not match this installation; no configuration was removed." }
    $existing = Get-ExistingConfiguration
    if ($null -eq $existing) {
        if ($PSCmdlet.ShouldProcess($markerPath, "Remove stale Blockwright Codex ownership marker")) { Remove-Item -LiteralPath $markerPath -Force }
        if ($PassThru) { [pscustomobject]@{ Status = "NotFound"; Name = $name } }
        exit 0
    }
    if (-not (Test-OwnedConfiguration -Existing $existing -Marker $marker)) { throw "Codex MCP entry '$name' is not proven to be owned by this installation and was left unchanged." }
    if ($PSCmdlet.ShouldProcess($name, "Remove owned Codex MCP configuration")) {
        $removeResult = Invoke-CodexCommand -Arguments @("mcp", "remove", $name)
        if ($removeResult.ExitCode -ne 0) {
            $detail = Get-CodexFailureDetail -Result $removeResult
            throw "Codex could not remove the owned MCP entry '$name'.$(if ($detail) { " $detail" })"
        }
        $remaining = Get-ExistingConfiguration
        if ($null -ne $remaining) { throw "Codex reported that the owned MCP entry '$name' was removed, but it is still present; the ownership marker was retained." }
        if (Test-Path -LiteralPath $markerPath -PathType Leaf) { Remove-Item -LiteralPath $markerPath -Force }
        if ($PassThru) { [pscustomobject]@{ Status = "Removed"; Name = $name } }
    }
    exit 0
}

$existing = Get-ExistingConfiguration
if ($null -eq $privateNode) { throw "The packaged private Node runtime is missing. Codex integration will not fall back to machine-wide Node.js." }
if (-not (Test-Path -LiteralPath $bridge -PathType Leaf)) { throw "The packaged MCP bridge is missing: $bridge" }
if (-not (Test-Path -LiteralPath $wrapper -PathType Leaf)) { throw "The private-runtime MCP launcher is missing: $wrapper" }
if ($null -ne $marker -and -not (Test-OwnershipMarker -Marker $marker -Desired $desired)) {
    throw "A stale or invalid Blockwright Codex ownership marker exists and was left unchanged."
}
if ($null -ne $existing) {
    if ($null -ne $marker -and (Test-OwnedConfiguration -Existing $existing -Marker $marker)) { if ($PassThru) { [pscustomobject]@{ Status = "AlreadyRegistered"; Name = $name } }; exit 0 }
    if ($null -eq $marker -and (Test-OwnedConfiguration -Existing $existing -Marker $desired)) {
        throw "Codex already has the exact Blockwright MCP entry, but this installation has no ownership marker. It was not adopted and will not be removed automatically."
    }
    throw "Codex already has an MCP entry named '$name'. It was left unchanged; remove or rename it explicitly before retrying."
}
if ($PSCmdlet.ShouldProcess($name, "Register Blockwright private-runtime MCP bridge with Codex")) {
    $addResult = Invoke-CodexCommand -Arguments @("mcp", "add", $name, "--", $commandProcessor, "/d", "/s", "/c", $wrapper)
    if ($addResult.ExitCode -ne 0) {
        $detail = Get-CodexFailureDetail -Result $addResult
        throw "Codex could not register the Blockwright MCP bridge.$(if ($detail) { " $detail" })"
    }
    try {
        $created = Get-ExistingConfiguration
        if ($null -eq $created -or -not (Test-OwnedConfiguration -Existing $created -Marker $desired)) {
            throw "Codex reported success but did not persist the exact Blockwright MCP configuration."
        }
        Write-OwnershipMarker -Desired $desired
        $persistedMarker = Get-Content -Raw -LiteralPath $markerPath | ConvertFrom-Json
        if (-not (Test-OwnershipMarker -Marker $persistedMarker -Desired $desired)) { throw "The Blockwright Codex ownership marker did not persist its exact expected contents." }
    } catch {
        $registrationFailure = $_.Exception.Message
        $rollbackFailure = Undo-DesiredConfiguration -Desired $desired
        if (-not $markerExisted -and (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
            try { Remove-Item -LiteralPath $markerPath -Force } catch {}
        }
        if ($rollbackFailure) {
            throw "$registrationFailure Automatic rollback could not safely remove the newly added Codex entry: $rollbackFailure"
        }
        throw "$registrationFailure The newly added Codex entry was rolled back."
    }
    if ($PassThru) { [pscustomobject]@{ Status = "Registered"; Name = $name; Marker = $markerPath } }
}
