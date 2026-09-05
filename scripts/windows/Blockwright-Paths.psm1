Set-StrictMode -Version 2.0

function Resolve-BlockwrightInstallRoot {
    param([string]$InstallRoot)
    $value = if ([string]::IsNullOrWhiteSpace($InstallRoot)) { Join-Path $PSScriptRoot "..\.." } else { $InstallRoot }
    return [System.IO.Path]::GetFullPath($value)
}

function Get-BlockwrightStateRoot {
    param(
        [string]$InstallRoot,
        [string]$StateRoot
    )
    if (-not [string]::IsNullOrWhiteSpace($StateRoot)) { return [System.IO.Path]::GetFullPath($StateRoot) }
    if (-not [string]::IsNullOrWhiteSpace($env:BLOCKWRIGHT_STATE_ROOT)) { return [System.IO.Path]::GetFullPath($env:BLOCKWRIGHT_STATE_ROOT) }
    $resolvedInstallRoot = Resolve-BlockwrightInstallRoot -InstallRoot $InstallRoot
    if (Test-Path -LiteralPath (Join-Path $resolvedInstallRoot "portable.flag") -PathType Leaf) {
        return [System.IO.Path]::GetFullPath((Join-Path $resolvedInstallRoot "data\state"))
    }
    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { throw "LOCALAPPDATA is required for per-user Blockwright state." }
    return [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Blockwright"))
}

function Get-BlockwrightPrivateNode {
    param([string]$InstallRoot)
    $resolvedInstallRoot = Resolve-BlockwrightInstallRoot -InstallRoot $InstallRoot
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $resolvedInstallRoot "runtime\node\node.exe"))
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    return $null
}

function Get-BlockwrightPrivateNpm {
    param([string]$InstallRoot)
    $resolvedInstallRoot = Resolve-BlockwrightInstallRoot -InstallRoot $InstallRoot
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $resolvedInstallRoot "runtime\node\npm.cmd"))
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    return $null
}

function Get-BlockwrightConfiguration {
    param(
        [string]$InstallRoot,
        [string]$StateRoot
    )
    $resolvedInstallRoot = Resolve-BlockwrightInstallRoot -InstallRoot $InstallRoot
    $resolvedStateRoot = Get-BlockwrightStateRoot -InstallRoot $resolvedInstallRoot -StateRoot $StateRoot
    $configuration = [ordered]@{
        schemaVersion = 1
        port = 32147
        bindAddress = "127.0.0.1"
        updateMetadataUri = $null
        trustedPublisherThumbprint = $null
        stateMode = if (Test-Path -LiteralPath (Join-Path $resolvedInstallRoot "portable.flag") -PathType Leaf) { "portable" } else { "per-user" }
    }
    foreach ($path in @((Join-Path $resolvedInstallRoot "config\defaults.json"), (Join-Path $resolvedStateRoot "config.json"))) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
        try {
            $value = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
            foreach ($property in $value.PSObject.Properties) { $configuration[$property.Name] = $property.Value }
        } catch {
            throw "Blockwright configuration is invalid JSON: $path. $($_.Exception.Message)"
        }
    }
    if (Test-Path -LiteralPath (Join-Path $resolvedInstallRoot "portable.flag") -PathType Leaf) { $configuration.stateMode = "portable" }
    $portValue = [int]$configuration.port
    if ($portValue -lt 1024 -or $portValue -gt 65535) { throw "Configured Blockwright port must be between 1024 and 65535." }
    if ([string]$configuration.bindAddress -ne "127.0.0.1") { throw "Blockwright Windows packages permit only the loopback bind address 127.0.0.1." }
    return [pscustomobject]$configuration
}

function Test-BlockwrightChildPath {
    param(
        [Parameter(Mandatory = $true)][string]$Parent,
        [Parameter(Mandatory = $true)][string]$Candidate
    )
    $parentPath = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    $candidatePath = [System.IO.Path]::GetFullPath($Candidate)
    return $candidatePath.StartsWith($parentPath, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-BlockwrightInstallerTestRoot {
    param(
        [Parameter(Mandatory = $true)][string]$Candidate,
        [Parameter(Mandatory = $true)][ValidateSet("state", "roaming")][string]$LeafName
    )
    $candidatePath = [System.IO.Path]::GetFullPath($Candidate)
    if (-not ([System.IO.Path]::GetFileName($candidatePath)).Equals($LeafName, [StringComparison]::OrdinalIgnoreCase)) { return $false }
    $lifecycleRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $candidatePath))
    if ([System.IO.Path]::GetFileName($lifecycleRoot) -notmatch '^Blockwright Installer Lifecycle [a-f0-9]{32}$') { return $false }
    $temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $lifecycleParent = [System.IO.Path]::GetFullPath((Split-Path -Parent $lifecycleRoot))
    try {
        $canonicalLifecycleParent = [System.IO.Path]::GetFullPath((Get-Item -LiteralPath $lifecycleParent -Force -ErrorAction Stop).FullName).TrimEnd('\')
        $canonicalTemporaryRoot = [System.IO.Path]::GetFullPath((Get-Item -LiteralPath $temporaryRoot -Force -ErrorAction Stop).FullName).TrimEnd('\')
    } catch {
        return $false
    }
    return $canonicalLifecycleParent.Equals($canonicalTemporaryRoot, [StringComparison]::OrdinalIgnoreCase)
}

function Test-BlockwrightInstalledStateRoot {
    param([Parameter(Mandatory = $true)][string]$Candidate)
    $candidatePath = [System.IO.Path]::GetFullPath($Candidate)
    $localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    if (-not [string]::IsNullOrWhiteSpace($localAppData)) {
        $standardRoot = [System.IO.Path]::GetFullPath((Join-Path $localAppData "Blockwright"))
        if ($candidatePath.Equals($standardRoot, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    return Test-BlockwrightInstallerTestRoot -Candidate $candidatePath -LeafName "state"
}

function Test-BlockwrightInstalledRoamingRoot {
    param([Parameter(Mandatory = $true)][string]$Candidate)
    $candidatePath = [System.IO.Path]::GetFullPath($Candidate)
    $roamingAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
    if (-not [string]::IsNullOrWhiteSpace($roamingAppData) -and $candidatePath.Equals([System.IO.Path]::GetFullPath($roamingAppData), [StringComparison]::OrdinalIgnoreCase)) { return $true }
    return Test-BlockwrightInstallerTestRoot -Candidate $candidatePath -LeafName "roaming"
}

function Get-BlockwrightManagedRecordPath {
    param([string]$InstallRoot, [string]$StateRoot)
    return Join-Path (Get-BlockwrightStateRoot -InstallRoot $InstallRoot -StateRoot $StateRoot) "run\managed-server.json"
}

function Stop-BlockwrightManagedProcess {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param(
        [string]$InstallRoot,
        [string]$StateRoot,
        [ValidateRange(1, 30)][int]$WaitSeconds = 5
    )
    $resolvedInstallRoot = Resolve-BlockwrightInstallRoot -InstallRoot $InstallRoot
    $recordPath = Get-BlockwrightManagedRecordPath -InstallRoot $resolvedInstallRoot -StateRoot $StateRoot
    if (-not (Test-Path -LiteralPath $recordPath -PathType Leaf)) {
        return [pscustomobject]@{ Status = "NotRunning"; ProcessId = $null; RecordPath = $recordPath }
    }
    try { $record = Get-Content -Raw -LiteralPath $recordPath | ConvertFrom-Json } catch { throw "Managed-process metadata is unreadable and no process was stopped: $recordPath" }
    if ([int]$record.schemaVersion -ne 1 -or [int]$record.pid -le 0 -or [string]::IsNullOrWhiteSpace([string]$record.processStartUtc)) {
        throw "Managed-process metadata is incomplete and no process was stopped."
    }
    if (-not ([System.IO.Path]::GetFullPath([string]$record.installRoot)).Equals($resolvedInstallRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Managed-process metadata belongs to another installation and no process was stopped."
    }
    $expectedNode = Get-BlockwrightPrivateNode -InstallRoot $resolvedInstallRoot
    if ($null -eq $expectedNode -or -not ([System.IO.Path]::GetFullPath([string]$record.executable)).Equals($expectedNode, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Managed-process metadata does not identify this installation's private Node runtime and no process was stopped."
    }
    $processIdValue = [int]$record.pid
    $process = Get-Process -Id $processIdValue -ErrorAction SilentlyContinue
    if ($null -eq $process) {
        Remove-Item -LiteralPath $recordPath -Force
        return [pscustomobject]@{ Status = "StaleRecordRemoved"; ProcessId = $processIdValue; RecordPath = $recordPath }
    }
    $expectedStart = [datetimeoffset]::Parse([string]$record.processStartUtc).UtcDateTime
    $actualStart = $process.StartTime.ToUniversalTime()
    if ([math]::Abs(($actualStart - $expectedStart).TotalSeconds) -gt 2) { throw "The managed PID was reused; no process was stopped." }
    try { $actualExecutable = [System.IO.Path]::GetFullPath($process.Path) } catch { throw "The managed process executable could not be verified; no process was stopped." }
    if (-not $actualExecutable.Equals($expectedNode, [StringComparison]::OrdinalIgnoreCase)) { throw "The managed PID is not Blockwright's private Node runtime; no process was stopped." }
    if ($PSCmdlet.ShouldProcess("PID $processIdValue", "Stop verified Blockwright managed process tree")) {
        $taskKill = Join-Path $env:SystemRoot "System32\taskkill.exe"
        & $taskKill /PID $processIdValue /T /F 2>&1 | Out-Null
        $deadline = (Get-Date).AddSeconds($WaitSeconds)
        while ((Get-Date) -lt $deadline -and $null -ne (Get-Process -Id $processIdValue -ErrorAction SilentlyContinue)) { Start-Sleep -Milliseconds 100 }
        if ($null -ne (Get-Process -Id $processIdValue -ErrorAction SilentlyContinue)) { throw "Verified Blockwright PID $processIdValue did not stop." }
        if (Test-Path -LiteralPath $recordPath -PathType Leaf) { Remove-Item -LiteralPath $recordPath -Force }
        return [pscustomobject]@{ Status = "Stopped"; ProcessId = $processIdValue; RecordPath = $recordPath }
    }
    return [pscustomobject]@{ Status = "WhatIf"; ProcessId = $processIdValue; RecordPath = $recordPath }
}

Export-ModuleMember -Function Resolve-BlockwrightInstallRoot, Get-BlockwrightStateRoot, Get-BlockwrightPrivateNode, Get-BlockwrightPrivateNpm, Get-BlockwrightConfiguration, Test-BlockwrightChildPath, Test-BlockwrightInstalledStateRoot, Test-BlockwrightInstalledRoamingRoot, Get-BlockwrightManagedRecordPath, Stop-BlockwrightManagedProcess
