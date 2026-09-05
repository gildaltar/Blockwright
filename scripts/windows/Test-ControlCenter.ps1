[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") { throw "These controller integration checks require Windows." }

$controllerPath = Join-Path $PSScriptRoot "Blockwright-ControlCenter.ps1"
$repairPath = Join-Path $PSScriptRoot "Invoke-BlockwrightRuntimeRepair.ps1"
$pathsModulePath = Join-Path $PSScriptRoot "Blockwright-Paths.psm1"
$shortcutInstallerPath = Join-Path $PSScriptRoot "Install-BlockwrightShortcut.ps1"
$windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$testRoot = [System.IO.Path]::GetFullPath((Join-Path ([System.IO.Path]::GetTempPath()) ("Blockwright Control Center Test " + [guid]::NewGuid().ToString("N"))))
$fixtureRoot = Join-Path $testRoot "plugin fixture with spaces"
$appRoot = Join-Path $fixtureRoot "app"
$distRoot = Join-Path $appRoot "dist"
$fixtureWindowsScripts = Join-Path $fixtureRoot "scripts\windows"
$shortcutRoot = Join-Path $testRoot "shortcut fixture"
$results = New-Object 'System.Collections.Generic.List[object]'

function Quote-NativeArgument {
    param([Parameter(Mandatory = $true)][string]$Value)
    return '"' + $Value.Replace('"', '\"') + '"'
}

function Assert-Condition {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )
    if (-not $Condition) { throw $Message }
}

function Add-Pass {
    param([string]$Name, [string]$Detail)
    $results.Add([pscustomobject]@{ name = $Name; status = "pass"; detail = $Detail })
}

function Invoke-WindowsPowerShell {
    param(
        [Parameter(Mandatory = $true)][string]$Arguments,
        [hashtable]$EnvironmentVariables,
        [int]$TimeoutMilliseconds = 180000
    )
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $windowsPowerShell
    $startInfo.Arguments = $Arguments
    $startInfo.WorkingDirectory = $testRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.EnvironmentVariables["BLOCKWRIGHT_STATE_ROOT"] = (Join-Path $testRoot "state")
    if ($null -ne $EnvironmentVariables) {
        foreach ($name in $EnvironmentVariables.Keys) {
            $startInfo.EnvironmentVariables[[string]$name] = [string]$EnvironmentVariables[$name]
        }
    }
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw "Windows PowerShell test child did not start." }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutMilliseconds)) {
        try { $process.Kill() } catch {}
        throw "Windows PowerShell test child exceeded $TimeoutMilliseconds ms."
    }
    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    $exitCode = $process.ExitCode
    $process.Dispose()
    return [pscustomobject]@{ ExitCode = $exitCode; StandardOutput = $stdout; StandardError = $stderr }
}

function Get-FreePort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    } finally {
        $listener.Stop()
    }
}

function Test-PortAvailable {
    param([int]$Port)
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    try {
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        try { $listener.Stop() } catch {}
    }
}

try {
    $null = New-Item -ItemType Directory -Path $distRoot -Force
    $null = New-Item -ItemType Directory -Path $fixtureWindowsScripts -Force
    $null = New-Item -ItemType Directory -Path $shortcutRoot -Force

    $packageJson = @'
{
  "name": "blockwright-control-center-fixture",
  "version": "9.9.9",
  "type": "module",
  "dependencies": {}
}
'@
    $packageLock = @'
{
  "name": "blockwright-control-center-fixture",
  "version": "9.9.9",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "blockwright-control-center-fixture",
      "version": "9.9.9"
    }
  }
}
'@
    $fixtureServer = @'
import http from "node:http";

const port = Number(process.env.__PORT || process.env.PORT);
const service = process.env.BLOCKWRIGHT_FIXTURE_SERVICE || "blockwright";
const token = process.env.BLOCKWRIGHT_LOCAL_MCP_TOKEN;
if (!/^[A-Za-z0-9_-]{43,128}$/.test(token || "")) throw new Error("Fixture did not receive a strong per-launch MCP token.");
const server = http.createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url === "/health") {
    response.end(JSON.stringify({ status: "ok", service, version: "9.9.9", uptimeSeconds: Math.floor(process.uptime()) }));
    return;
  }
  if (request.url === "/ready") {
    response.end(JSON.stringify({ status: "ready", service, version: "9.9.9", checks: { runtime: { ok: true } } }));
    return;
  }
  if (request.url === "/mcp") {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.statusCode = 401;
      response.end(JSON.stringify({ ok: false, error: "authorization required" }));
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const message = JSON.parse(body);
      console.log("MCP_AUTH=ok");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: service, version: "9.9.9" } } }));
    });
    return;
  }
  response.end(JSON.stringify({ service, endpoint: request.url }));
});
server.listen(port, "127.0.0.1", () => {
  console.log(`ENTRY=__entry NODE_ENV=${process.env.NODE_ENV} __PORT=${process.env.__PORT} PORT=${process.env.PORT}`);
});
process.stdin.resume();
process.stdin.on("end", () => server.close(() => process.exit(0)));
'@
    [System.IO.File]::WriteAllText((Join-Path $appRoot "package.json"), $packageJson, (New-Object System.Text.UTF8Encoding($false)))
    [System.IO.File]::WriteAllText((Join-Path $appRoot "package-lock.json"), $packageLock, (New-Object System.Text.UTF8Encoding($false)))
    [System.IO.File]::WriteAllText((Join-Path $distRoot "__entry.js"), $fixtureServer, (New-Object System.Text.UTF8Encoding($false)))
    [System.IO.File]::Copy($repairPath, (Join-Path $fixtureWindowsScripts "Invoke-BlockwrightRuntimeRepair.ps1"), $true)
    [System.IO.File]::Copy($pathsModulePath, (Join-Path $fixtureWindowsScripts "Blockwright-Paths.psm1"), $true)

    foreach ($scriptPath in @($controllerPath, $repairPath, $pathsModulePath, $shortcutInstallerPath, $PSCommandPath)) {
        $tokens = $null
        $parseErrors = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors)
        Assert-Condition ($parseErrors.Count -eq 0) "PowerShell parsing failed for $scriptPath`: $($parseErrors.Message -join '; ')"
    }
    Add-Pass "powershell-parse" "Controller, path/runtime module, repair helper, shortcut helper, and this test script parse without errors."

    $controllerSource = [System.IO.File]::ReadAllText($controllerPath)
    foreach ($requiredFragment in @('app\dist\__entry.js', 'Get-BlockwrightPrivateNode', 'Write-ManagedServerRecord', 'BLOCKWRIGHT_STATE_ROOT = $script:StateRoot', 'BLOCKWRIGHT_STATE_DIR = $script:StateRoot', 'BLOCKWRIGHT_LOCAL_MCP_TOKEN = $script:LocalMcpToken', 'New-LocalMcpToken', 'Authorization', 'NODE_ENV = "production"', '__PORT = [string]$Port', 'npm ls', 'TakeDroppedCount', 'MaxLines = 250', 'UpdateButton', 'Update-Blockwright.ps1', 'Start-BlockwrightUpdateProcess -Mode "check"', ' -CheckOnly', 'MessageBoxResult]::Yes', 'Start-BlockwrightUpdateProcess -Mode "install"', 'last-check.json', 'nothing will be installed without confirmation')) {
        Assert-Condition ($controllerSource.Contains($requiredFragment)) "Controller contract fragment is missing: $requiredFragment"
    }
    $checkInvocationIndex = $controllerSource.IndexOf('Start-BlockwrightUpdateProcess -Mode "check"')
    $confirmationIndex = $controllerSource.IndexOf('MessageBoxResult]::Yes')
    $installInvocationIndex = $controllerSource.IndexOf('Start-BlockwrightUpdateProcess -Mode "install"')
    Assert-Condition ($checkInvocationIndex -ge 0 -and $confirmationIndex -ge 0 -and $installInvocationIndex -gt $confirmationIndex) "Control Center update installation is not structurally gated behind the explicit confirmation result."
    Add-Pass "source-contracts" "Direct entry, production port variables, full dependency validation, bounded log drains, and confirmed two-phase updates are present."

    $validateArguments = "-NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File $(Quote-NativeArgument $controllerPath) -PluginRoot $(Quote-NativeArgument $fixtureRoot) -ValidateUi"
    $validateResult = Invoke-WindowsPowerShell -Arguments $validateArguments
    Assert-Condition ($validateResult.ExitCode -eq 0) "WPF validation failed: $($validateResult.StandardError)"
    $validation = $validateResult.StandardOutput | ConvertFrom-Json
    Assert-Condition ([bool]$validation.valid) "WPF named-control validation reported invalid."
    Add-Pass "wpf-validation" "$($validation.controls) named controls resolved without opening the UI."

    $capturePath = Join-Path $testRoot "control-center-render.png"
    $captureArguments = "-NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File $(Quote-NativeArgument $controllerPath) -PluginRoot $(Quote-NativeArgument $fixtureRoot) -CaptureUiPath $(Quote-NativeArgument $capturePath)"
    $captureResult = Invoke-WindowsPowerShell -Arguments $captureArguments
    Assert-Condition ($captureResult.ExitCode -eq 0) "Render-only Control Center capture failed: $($captureResult.StandardError)"
    Assert-Condition ((Test-Path -LiteralPath $capturePath -PathType Leaf) -and (Get-Item -LiteralPath $capturePath).Length -gt 10000) "Render-only Control Center capture did not produce a substantive PNG."
    Add-Pass "render-only-capture" "The updated stopped-state Control Center can render to PNG without starting a server or update operation."

    $smokePort = Get-FreePort
    $smokeArguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File $(Quote-NativeArgument $controllerPath) -PluginRoot $(Quote-NativeArgument $fixtureRoot) -SmokeTest -SmokeTestSeconds 10 -Port $smokePort -Json"
    $smokeResult = Invoke-WindowsPowerShell -Arguments $smokeArguments
    Assert-Condition ($smokeResult.ExitCode -eq 0) "Direct-entry smoke failed: $($smokeResult.StandardError) $($smokeResult.StandardOutput)"
    $smoke = $smokeResult.StandardOutput | ConvertFrom-Json
    Assert-Condition ([bool]$smoke.healthy) "Direct-entry smoke did not become healthy."
    $joinedLogs = @($smoke.logs) -join "`n"
    Assert-Condition ($joinedLogs -match "ENTRY=__entry NODE_ENV=production __PORT=$smokePort PORT=$smokePort") "Direct entry did not receive the required production environment."
    Assert-Condition ($joinedLogs -match "MCP_AUTH=ok") "Control Center did not authenticate its MCP initialize smoke request."
    Assert-Condition ($joinedLogs -notmatch "BLOCKWRIGHT_LOCAL_MCP_TOKEN=") "The per-launch MCP token was written to a captured log."
    Assert-Condition (Test-PortAvailable -Port $smokePort) "The bounded smoke test left port $smokePort in use."
    Add-Pass "direct-entry-smoke" "Strict /health and /ready passed on port $smokePort; the process stopped and released the listener."

    $mismatchPort = Get-FreePort
    $mismatchArguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File $(Quote-NativeArgument $controllerPath) -PluginRoot $(Quote-NativeArgument $fixtureRoot) -SmokeTest -SmokeTestSeconds 5 -Port $mismatchPort -Json"
    $mismatchResult = Invoke-WindowsPowerShell -Arguments $mismatchArguments -EnvironmentVariables @{ BLOCKWRIGHT_FIXTURE_SERVICE = "not-blockwright" }
    Assert-Condition ($mismatchResult.ExitCode -eq 1) "A foreign service identity was not rejected."
    $mismatch = $mismatchResult.StandardOutput | ConvertFrom-Json
    Assert-Condition (-not [bool]$mismatch.healthy) "A foreign service identity was marked healthy."
    Assert-Condition ([string]$mismatch.failure -match "identity mismatch") "The mismatch failure did not explain the identity problem."
    Assert-Condition (Test-PortAvailable -Port $mismatchPort) "The rejected-identity smoke left port $mismatchPort in use."
    Add-Pass "identity-rejection" "A responder with service=not-blockwright remained unverified and was stopped."

    $lockPath = Join-Path $appRoot ".blockwright-runtime-repair.lock"
    $null = New-Item -ItemType Directory -Path $lockPath
    $staleTimestamp = [datetimeoffset]::UtcNow.AddSeconds(-20).ToString("o")
    $staleOwner = [ordered]@{ schemaVersion = 1; pid = 2147483000; startedAt = $staleTimestamp; acquiredAt = $staleTimestamp; actor = "test-stale-owner"; token = "stale-test-token" }
    [System.IO.File]::WriteAllText((Join-Path $lockPath "owner.json"), ($staleOwner | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
    Assert-Condition (Test-Path -LiteralPath (Join-Path $lockPath "owner.json") -PathType Leaf) "The stale lock fixture was not created."
    $repairArguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File $(Quote-NativeArgument $repairPath) -PluginRoot $(Quote-NativeArgument $fixtureRoot) -LockWaitAttempts 20 -LockWaitMilliseconds 25"
    $repairResult = Invoke-WindowsPowerShell -Arguments $repairArguments
    Assert-Condition ($repairResult.ExitCode -eq 0) "Stale-lock recovery failed: $($repairResult.StandardError)"
    Assert-Condition ($repairResult.StandardOutput -match "Recovering stale runtime-repair lock") "Stale-lock recovery was not reported. Output: $($repairResult.StandardOutput) Error: $($repairResult.StandardError)"
    Assert-Condition ($repairResult.StandardOutput -match "Using npm ci") "The repair helper did not choose reproducible npm ci with a lockfile."
    Assert-Condition (-not (Test-Path -LiteralPath $lockPath)) "The repair helper left its owned lock directory behind."
    Add-Pass "stale-lock-recovery" "A dead-PID lock was reclaimed, npm ci was used, and the owned lock was released."

    $null = New-Item -ItemType Directory -Path $lockPath
    $testHostProcess = [System.Diagnostics.Process]::GetCurrentProcess()
    $activeOwner = [ordered]@{
        schemaVersion = 1
        pid = $testHostProcess.Id
        startedAt = $testHostProcess.StartTime.ToUniversalTime().ToString("o")
        acquiredAt = [datetimeoffset]::UtcNow.AddSeconds(-20).ToString("o")
        actor = "test-active-owner"
        token = "active-test-token"
    }
    [System.IO.File]::WriteAllText((Join-Path $lockPath "owner.json"), ($activeOwner | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
    $activeLockArguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File $(Quote-NativeArgument $repairPath) -PluginRoot $(Quote-NativeArgument $fixtureRoot) -LockWaitAttempts 2 -LockWaitMilliseconds 25"
    $activeMutexHasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        $activeMutexHash = $activeMutexHasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($lockPath.Replace("\", "/").ToLowerInvariant()))
    } finally {
        $activeMutexHasher.Dispose()
    }
    $activeMutexName = "blockwright-runtime-repair-" + (-join ($activeMutexHash | ForEach-Object { $_.ToString("x2") })).Substring(0, 24)
    $activeMutex = [System.IO.Pipes.NamedPipeServerStream]::new($activeMutexName, [System.IO.Pipes.PipeDirection]::InOut, 1, [System.IO.Pipes.PipeTransmissionMode]::Byte, [System.IO.Pipes.PipeOptions]::Asynchronous)
    try {
        $activeLockResult = Invoke-WindowsPowerShell -Arguments $activeLockArguments
    } finally {
        $activeMutex.Dispose()
    }
    Assert-Condition ($activeLockResult.ExitCode -eq 23) "An active repair owner was not protected (exit $($activeLockResult.ExitCode))."
    Assert-Condition (Test-Path -LiteralPath $lockPath -PathType Container) "The active owner's lock was removed."
    $ownerAfterContention = [System.IO.File]::ReadAllText((Join-Path $lockPath "owner.json")) | ConvertFrom-Json
    Assert-Condition ([string]$ownerAfterContention.token -eq "active-test-token") "Lock contention changed the active owner's token."
    Remove-Item -LiteralPath $lockPath -Recurse -Force
    Add-Pass "active-lock-protection" "The OS-owned mutex and active PID/start-time metadata were preserved; contention exited 23."

    $shortcutArguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File $(Quote-NativeArgument $shortcutInstallerPath) -ShortcutDirectory $(Quote-NativeArgument $shortcutRoot) -PassThru"
    $shortcutResult = Invoke-WindowsPowerShell -Arguments $shortcutArguments
    Assert-Condition ($shortcutResult.ExitCode -eq 0) "Temporary shortcut install failed: $($shortcutResult.StandardError)"
    $shortcutPath = Join-Path $shortcutRoot "Blockwright Control Center.lnk"
    Assert-Condition (Test-Path -LiteralPath $shortcutPath -PathType Leaf) "The temporary shortcut was not created."

    $shell = New-Object -ComObject WScript.Shell
    $tamperedShortcut = $shell.CreateShortcut($shortcutPath)
    $tamperedShortcut.Arguments = '//nologo "C:\not-owned-by-blockwright.vbs"'
    $tamperedShortcut.Save()
    $refusalResult = Invoke-WindowsPowerShell -Arguments $shortcutArguments
    Assert-Condition ($refusalResult.ExitCode -ne 0) "The installer overwrote an unowned same-name shortcut without permission."
    $preservedShortcut = $shell.CreateShortcut($shortcutPath)
    Assert-Condition ([string]$preservedShortcut.Arguments -match "not-owned-by-blockwright") "The refused shortcut was modified."

    $backupArguments = $shortcutArguments + " -BackupExisting"
    $backupResult = Invoke-WindowsPowerShell -Arguments $backupArguments
    Assert-Condition ($backupResult.ExitCode -eq 0) "Backup-and-replace shortcut install failed: $($backupResult.StandardError)"
    $backupShortcuts = @(Get-ChildItem -LiteralPath $shortcutRoot -Filter "Blockwright Control Center.unowned-*.lnk")
    Assert-Condition ($backupShortcuts.Count -eq 1) "The unowned shortcut was not preserved as exactly one backup."

    $removeArguments = $shortcutArguments + " -Remove"
    $removeResult = Invoke-WindowsPowerShell -Arguments $removeArguments
    Assert-Condition ($removeResult.ExitCode -eq 0) "Owned shortcut removal failed: $($removeResult.StandardError)"
    Assert-Condition (-not (Test-Path -LiteralPath $shortcutPath)) "Owned shortcut removal left the exact shortcut behind."
    Assert-Condition (Test-Path -LiteralPath $backupShortcuts[0].FullName) "Owned shortcut removal also removed the preserved unowned backup."
    Add-Pass "shortcut-ownership" "Unowned shortcut was refused, explicitly backed up, and not removed with the owned shortcut."

    [ordered]@{
        status = "pass"
        generatedAt = [datetimeoffset]::UtcNow.ToString("o")
        checks = @($results | ForEach-Object { $_ })
    } | ConvertTo-Json -Depth 8
} finally {
    if (Test-Path -LiteralPath $fixtureRoot -PathType Container) {
        try {
            $entryPath = Join-Path $distRoot "__entry.js"
            Get-CimInstance Win32_Process -Property ProcessId, CommandLine -ErrorAction SilentlyContinue |
                Where-Object { -not [string]::IsNullOrWhiteSpace($_.CommandLine) -and $_.CommandLine.IndexOf($entryPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } |
                ForEach-Object { Stop-Process -Id ([int]$_.ProcessId) -Force -ErrorAction SilentlyContinue }
        } catch {}
    }
    $resolvedTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if ($testRoot.StartsWith($resolvedTempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
        ([System.IO.Path]::GetFileName($testRoot)).StartsWith("Blockwright Control Center Test ", [System.StringComparison]::Ordinal)) {
        if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue }
    }
}
