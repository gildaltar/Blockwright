[CmdletBinding()]
param(
    [string]$PluginRoot,
    [ValidateRange(1, 480)][int]$LockWaitAttempts = 480,
    [ValidateRange(25, 1000)][int]$LockWaitMilliseconds = 250
)

$ErrorActionPreference = "Stop"

$resolvedPluginRoot = if ([string]::IsNullOrWhiteSpace($PluginRoot)) {
    [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
} else {
    [System.IO.Path]::GetFullPath($PluginRoot)
}
$pathsModule = Join-Path $PSScriptRoot "Blockwright-Paths.psm1"
if (-not (Test-Path -LiteralPath $pathsModule -PathType Leaf)) { throw "The Windows path/runtime helper is missing: $pathsModule" }
Import-Module $pathsModule -Force
$appRoot = [System.IO.Path]::GetFullPath((Join-Path $resolvedPluginRoot "app"))
$lockPath = [System.IO.Path]::GetFullPath((Join-Path $appRoot ".blockwright-runtime-repair.lock"))
$expectedLockPath = Join-Path $appRoot ".blockwright-runtime-repair.lock"
$ownerPath = Join-Path $lockPath "owner.json"
$lockToken = [guid]::NewGuid().ToString("N")
$lockOwned = $false
$validOwnerMinimumAgeSeconds = 5
$malformedOwnerMinimumAgeSeconds = 600
$normalizedMutexKey = $lockPath.Replace("\", "/").ToLowerInvariant()
$mutexHasher = [System.Security.Cryptography.SHA256]::Create()
try {
    $mutexHash = $mutexHasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($normalizedMutexKey))
} finally {
    $mutexHasher.Dispose()
}
$mutexHashText = -join ($mutexHash | ForEach-Object { $_.ToString("x2") })
$mutexPipeName = "blockwright-runtime-repair-" + $mutexHashText.Substring(0, 24)
$repairMutexStream = $null

if (-not $lockPath.Equals($expectedLockPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use an unexpected runtime-repair lock path: $lockPath"
}

if (-not ("BlockwrightNativeDirectoryLock" -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class BlockwrightNativeDirectoryLock
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CreateDirectory(string path, IntPtr securityAttributes);
}
'@
}

function Get-NpmExecutable {
    $privateNpm = Get-BlockwrightPrivateNpm -InstallRoot $resolvedPluginRoot
    if ($null -ne $privateNpm) { return $privateNpm }
    if (Test-Path -LiteralPath (Join-Path $resolvedPluginRoot "release-manifest.json") -PathType Leaf) { return $null }
    $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $nodeCommand) {
        $nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    }
    if ($null -ne $nodeCommand) {
        $nodePath = if (-not [string]::IsNullOrWhiteSpace($nodeCommand.Path)) { $nodeCommand.Path } else { $nodeCommand.Source }
        $siblingNpm = Join-Path (Split-Path -Parent $nodePath) "npm.cmd"
        if (Test-Path -LiteralPath $siblingNpm -PathType Leaf) { return $siblingNpm }
    }
    $npmCommand = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $npmCommand) { return $null }
    if (-not [string]::IsNullOrWhiteSpace($npmCommand.Path)) { return $npmCommand.Path }
    return $npmCommand.Source
}

function Acquire-RuntimeRepairMutex {
    for ($attempt = 1; $attempt -le $lockWaitAttempts; $attempt++) {
        $candidate = $null
        try {
            $candidate = [System.IO.Pipes.NamedPipeServerStream]::new(
                $mutexPipeName,
                [System.IO.Pipes.PipeDirection]::InOut,
                1,
                [System.IO.Pipes.PipeTransmissionMode]::Byte,
                [System.IO.Pipes.PipeOptions]::Asynchronous
            )
            $script:repairMutexStream = $candidate
            Write-Output "Acquired the OS-owned runtime-repair mutex."
            return
        } catch {
            if ($null -ne $candidate) { $candidate.Dispose() }
            $baseError = $_.Exception.GetBaseException()
            if (-not ($baseError -is [System.IO.IOException]) -and -not ($baseError -is [System.UnauthorizedAccessException])) { throw }
            if ($attempt -lt $lockWaitAttempts) { Start-Sleep -Milliseconds $lockWaitMilliseconds }
        }
    }
    throw "Timed out waiting for the shared runtime-repair lock after $($lockWaitAttempts * $lockWaitMilliseconds) ms. Another Blockwright process may be repairing dependencies."
}

function Release-RuntimeRepairMutex {
    if ($null -eq $script:repairMutexStream) { return }
    try {
        $script:repairMutexStream.Dispose()
        Write-Output "Released the OS-owned runtime-repair mutex."
    } finally {
        $script:repairMutexStream = $null
    }
}

function Get-LockDirectoryAgeSeconds {
    try {
        $lockItem = Get-Item -LiteralPath $lockPath -Force -ErrorAction Stop
        return [math]::Max(0, ((Get-Date).ToUniversalTime() - $lockItem.LastWriteTimeUtc).TotalSeconds)
    } catch {
        return 0
    }
}

function Get-LockInspection {
    if (-not (Test-Path -LiteralPath $lockPath -PathType Container)) {
        return [pscustomobject]@{ Exists = $false; Stale = $false; Raw = $null; Reason = "lock disappeared" }
    }

    $rawOwner = $null
    try {
        $rawOwner = [System.IO.File]::ReadAllText($ownerPath)
        $owner = $rawOwner | ConvertFrom-Json
        if ([int]$owner.schemaVersion -ne 1 -or [int]$owner.pid -le 0 -or [string]::IsNullOrWhiteSpace([string]$owner.startedAt) -or
            [string]::IsNullOrWhiteSpace([string]$owner.acquiredAt) -or [string]::IsNullOrWhiteSpace([string]$owner.token)) {
            throw "owner metadata is incomplete"
        }

        $ownerProcessId = [int]$owner.pid
        $ownerStartedAt = [datetimeoffset]::Parse([string]$owner.startedAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
        $ownerAcquiredAt = [datetimeoffset]::Parse([string]$owner.acquiredAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
        $ownerAgeSeconds = [math]::Max(0, ([datetimeoffset]::UtcNow - $ownerAcquiredAt.ToUniversalTime()).TotalSeconds)
        if ($ownerAgeSeconds -lt $validOwnerMinimumAgeSeconds) {
            return [pscustomobject]@{ Exists = $true; Stale = $false; Raw = $rawOwner; Reason = "owner metadata is recent" }
        }

        $ownerProcess = Get-Process -Id $ownerProcessId -ErrorAction SilentlyContinue
        if ($null -eq $ownerProcess) {
            return [pscustomobject]@{ Exists = $true; Stale = $true; Raw = $rawOwner; Reason = "owner PID $ownerProcessId is no longer running" }
        }
        try {
            $actualStartedAt = $ownerProcess.StartTime.ToUniversalTime()
            $startDifference = [math]::Abs(($actualStartedAt - $ownerStartedAt.UtcDateTime).TotalSeconds)
            if ($startDifference -gt 2) {
                return [pscustomobject]@{ Exists = $true; Stale = $true; Raw = $rawOwner; Reason = "owner PID $ownerProcessId was reused" }
            }
        } catch {
            return [pscustomobject]@{ Exists = $true; Stale = $false; Raw = $rawOwner; Reason = "owner PID $ownerProcessId could not be verified" }
        }
        return [pscustomobject]@{ Exists = $true; Stale = $false; Raw = $rawOwner; Reason = "owner PID $ownerProcessId is active" }
    } catch {
        $directoryAgeSeconds = Get-LockDirectoryAgeSeconds
        $canReclaim = $directoryAgeSeconds -ge $malformedOwnerMinimumAgeSeconds
        $reason = if ($canReclaim) {
            "owner metadata is unreadable and the lock directory is at least 10 minutes old"
        } else {
            "owner metadata is unreadable, but the lock directory is not yet 10 minutes old"
        }
        return [pscustomobject]@{ Exists = $true; Stale = $canReclaim; Raw = $rawOwner; Reason = $reason }
    }
}

function Remove-StaleLock {
    param([Parameter(Mandatory = $true)][object]$Inspection)
    if (-not $Inspection.Stale) { return $false }
    if (-not (Test-Path -LiteralPath $lockPath -PathType Container)) { return $true }

    # Re-read immediately before removal so a newly acquired owner is not removed
    # after an older owner released the directory during inspection.
    $currentRaw = $null
    try { $currentRaw = [System.IO.File]::ReadAllText($ownerPath) } catch {}
    if ($null -ne $Inspection.Raw -and $currentRaw -ne $Inspection.Raw) { return $false }
    if ($null -eq $Inspection.Raw -and $null -ne $currentRaw) { return $false }

    try {
        Remove-Item -LiteralPath $lockPath -Recurse -Force -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Acquire-RuntimeRepairLock {
    Acquire-RuntimeRepairMutex
    $currentProcess = [System.Diagnostics.Process]::GetCurrentProcess()
    $ownerDocument = [ordered]@{
        schemaVersion = 1
        pid = $currentProcess.Id
        startedAt = $currentProcess.StartTime.ToUniversalTime().ToString("o")
        acquiredAt = $null
        actor = "windows-control-center"
        token = $lockToken
    }

    for ($attempt = 1; $attempt -le $lockWaitAttempts; $attempt++) {
        $created = [BlockwrightNativeDirectoryLock]::CreateDirectory($lockPath, [IntPtr]::Zero)
        if ($created) {
            try {
            $ownerDocument.acquiredAt = [datetimeoffset]::UtcNow.ToString("o")
                [System.IO.File]::WriteAllText($ownerPath, ($ownerDocument | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
                $script:lockOwned = $true
                Write-Output "Acquired the shared runtime-repair lock."
                return
            } catch {
                try { Remove-Item -LiteralPath $lockPath -Recurse -Force -ErrorAction SilentlyContinue } catch {}
                throw
            }
        }

        $nativeError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        if ($nativeError -ne 80 -and $nativeError -ne 183) {
            throw (New-Object System.ComponentModel.Win32Exception($nativeError, "Could not create the shared runtime-repair lock directory."))
        }
        $inspection = Get-LockInspection
        if ($inspection.Stale) {
            $recovered = Remove-StaleLock -Inspection $inspection
            if ($recovered) { Write-Output "Recovering stale runtime-repair lock ($($inspection.Reason))." }
        }
        if ($attempt -lt $lockWaitAttempts) { Start-Sleep -Milliseconds $lockWaitMilliseconds }
    }
    throw "Timed out waiting for the shared runtime-repair lock after $($lockWaitAttempts * $lockWaitMilliseconds) ms. Another Blockwright process may be repairing dependencies."
}

function Release-RuntimeRepairLock {
    if (-not $script:lockOwned) { return }
    try {
        $owner = [System.IO.File]::ReadAllText($ownerPath) | ConvertFrom-Json
        if ([string]$owner.token -eq $lockToken) {
            Remove-Item -LiteralPath $lockPath -Recurse -Force -ErrorAction Stop
            Write-Output "Released the shared runtime-repair lock."
        } else {
            Write-Warning "The runtime-repair lock owner changed; it was not removed."
        }
    } catch {
        Write-Warning "The runtime-repair lock could not be released safely: $($_.Exception.Message)"
    } finally {
        $script:lockOwned = $false
    }
}

function Assert-DirectDependencies {
    $manifestPath = Join-Path $appRoot "package.json"
    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    $dependencyNames = if ($null -eq $manifest.dependencies) {
        @()
    } else {
        @($manifest.dependencies.PSObject.Properties | ForEach-Object { [string]$_.Name } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }
    $missing = @()
    foreach ($dependencyName in $dependencyNames) {
        $dependencySegments = ([string]$dependencyName).Split('/')
        $dependencyPath = Join-Path $appRoot "node_modules"
        foreach ($segment in $dependencySegments) {
            if (-not [string]::IsNullOrWhiteSpace($segment)) { $dependencyPath = Join-Path $dependencyPath $segment }
        }
        $dependencyManifest = Join-Path $dependencyPath "package.json"
        if (-not (Test-Path -LiteralPath $dependencyManifest -PathType Leaf)) { $missing += [string]$dependencyName }
    }
    if ($missing.Count -gt 0) { throw "Dependency repair completed, but direct dependencies are still missing: $($missing -join ', ')." }
}

if (-not (Test-Path -LiteralPath $appRoot -PathType Container)) {
    Write-Error "The packaged app directory is missing: $appRoot"
    exit 1
}
$packagePath = Join-Path $appRoot "package.json"
if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
    Write-Error "The packaged app manifest is missing: $packagePath"
    exit 1
}
$npmPath = Get-NpmExecutable
if ($null -eq $npmPath) {
    Write-Error "The packaged private npm.cmd is missing. Installed releases do not repair with machine-wide Node.js/npm."
    exit 1
}

try {
    Write-Output "Runtime-repair lock: $lockPath (present before acquisition: $(Test-Path -LiteralPath $lockPath -PathType Container))."
    Acquire-RuntimeRepairLock
    $lockFilePath = Join-Path $appRoot "package-lock.json"
    if (Test-Path -LiteralPath $lockFilePath -PathType Leaf) {
        $npmArguments = @("ci", "--omit=dev", "--no-audit", "--no-fund", "--prefer-offline")
        Write-Output "Using npm ci because app/package-lock.json is present."
    } else {
        $npmArguments = @("install", "--omit=dev", "--no-audit", "--no-fund", "--prefer-offline")
        Write-Warning "app/package-lock.json is missing; falling back to npm install."
    }

    Push-Location $appRoot
    try {
        & $npmPath @npmArguments 2>&1 | ForEach-Object { Write-Output ([string]$_) }
        $installExitCode = $LASTEXITCODE
        if ($installExitCode -ne 0) { throw "npm dependency repair exited with code $installExitCode." }

        & $npmPath ls --omit=dev --depth=0 --json 2>&1 | ForEach-Object { Write-Output ([string]$_) }
        $listExitCode = $LASTEXITCODE
        if ($listExitCode -ne 0) { throw "npm ls rejected the repaired production dependency tree (exit $listExitCode)." }
    } finally {
        Pop-Location
    }
    Assert-DirectDependencies
    Write-Output "Blockwright runtime dependencies are ready."
    exit 0
} catch {
    $failureMessage = $_.Exception.Message
    $failureExitCode = if ($failureMessage -like "Timed out waiting for the shared runtime-repair lock*") { 23 } else { 1 }
    [Console]::Error.WriteLine($failureMessage)
    exit $failureExitCode
} finally {
    Release-RuntimeRepairLock
    Release-RuntimeRepairMutex
}
