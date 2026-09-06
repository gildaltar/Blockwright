[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") { throw "These controller integration checks require Windows." }

$controllerPath = Join-Path $PSScriptRoot "Blockwright-ControlCenter.ps1"
$repairPath = Join-Path $PSScriptRoot "Invoke-BlockwrightRuntimeRepair.ps1"
$pathsModulePath = Join-Path $PSScriptRoot "Blockwright-Paths.psm1"
$shortcutInstallerPath = Join-Path $PSScriptRoot "Install-BlockwrightShortcut.ps1"
$launcherVbsPath = Join-Path $PSScriptRoot "Launch-Blockwright-ControlCenter.vbs"
$launcherBuilderPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\release\Build-BlockwrightLauncher.ps1"))
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
import { spawn } from "node:child_process";

const port = Number(process.env.__PORT || process.env.PORT);
const service = process.env.BLOCKWRIGHT_FIXTURE_SERVICE || "blockwright";
const token = process.env.BLOCKWRIGHT_LOCAL_MCP_TOKEN;
const buildHash = "a".repeat(64);
const buildId = "bw_123456789abc";
  const childPort = Number(process.env.BLOCKWRIGHT_FIXTURE_CHILD_PORT || 0);
  let childProcess;
  let taskPollCount = 0;
  let taskStatusPollCount = 0;
if (!/^[A-Za-z0-9_-]{43,128}$/.test(token || "")) throw new Error("Fixture did not receive a strong per-launch MCP token.");
if (Number.isInteger(childPort) && childPort > 0) {
  const childSource = 'const http=require("node:http");const port=Number(process.argv[1]);http.createServer((request,response)=>response.end("child")).listen(port,"127.0.0.1");';
  childProcess = spawn(process.execPath, ["-e", childSource, String(childPort)], { stdio: "ignore", windowsHide: true });
  console.log(`CHILD_PID=${childProcess.pid} CHILD_PORT=${childPort}`);
}
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
      let result;
      if (message.method === "initialize") {
        result = { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: service, version: "9.9.9" } };
      } else if (message.method === "tools/list") {
        result = { tools: ["compile_build", "validate_build", "validate_build_contract", "export_build", "start_compile_task", "get_task_status", "list_tasks"].map((name) => ({ name })) };
      } else if (message.method === "tools/call" && message.params?.name === "compile_build") {
        result = { isError: false, structuredContent: { build: { id: buildId, hash: buildHash, blockCount: 274, validation: { valid: true }, contract: { status: "valid" } } } };
      } else if (message.method === "tools/call" && message.params?.name === "validate_build") {
        result = { isError: false, structuredContent: { validation: { valid: true }, hash: buildHash } };
      } else if (message.method === "tools/call" && message.params?.name === "validate_build_contract") {
        result = { isError: false, structuredContent: { contract: { status: "valid", buildHash } } };
      } else if (message.method === "tools/call" && message.params?.name === "export_build") {
        result = { isError: false, structuredContent: { format: "schem", filename: "fixture.schem", bytes: 519, dataVersion: 4903, schematicVersion: 3 } };
      } else if (message.method === "tools/call" && message.params?.name === "start_compile_task") {
        result = { isError: false, structuredContent: { task: {
          id: "task_smoke_async001", operation: "Fixture async compile", state: "queued",
          progress: { sequence: 0, phase: "queued", operation: "Waiting for a worker" },
          timing: { queuedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", elapsedMs: 0 },
          resultAvailable: false,
        } } };
      } else if (message.method === "tools/call" && message.params?.name === "get_task_status") {
        taskStatusPollCount += 1;
        const completed = taskStatusPollCount >= 2;
        result = { isError: false, structuredContent: {
          task: {
            id: "task_smoke_async001", operation: "Fixture async compile", state: completed ? "completed" : "compiling",
            progress: { sequence: taskStatusPollCount, phase: completed ? "completed" : "compiling", operation: completed ? "Task completed" : "Compiling fixture", work: { unit: "operations", completedUnits: completed ? 2 : 1, totalUnits: 2 } },
            timing: { queuedAt: "2026-01-01T00:00:00.000Z", updatedAt: `2026-01-01T00:00:0${taskStatusPollCount}.000Z`, elapsedMs: taskStatusPollCount * 1000 },
            resultAvailable: completed,
          },
          ...(completed ? { build: { id: buildId, hash: buildHash, blockCount: 274 } } : {}),
        } };
      } else if (message.method === "tools/call" && message.params?.name === "list_tasks") {
        taskPollCount += 1;
        const task = (id, state, code) => ({
          id,
          operation: "Fixture compile",
          state,
          progress: { sequence: taskPollCount, phase: state, operation: state === "completed" ? "Task completed" : state === "failed" ? "Task failed" : "Compiling fixture", work: { unit: "operations", completedUnits: state === "compiling" ? 1 : 2, totalUnits: 2 } },
          timing: { queuedAt: "2026-01-01T00:00:00.000Z", updatedAt: `2026-01-01T00:00:0${taskPollCount}.000Z`, elapsedMs: taskPollCount * 1000 },
          resultAvailable: state === "completed",
          ...(code ? { diagnostic: { id: "diag_fixture001", code, phase: "failed", operation: "Fixture compile", error: "Fixture failure", likelyCause: "Fixture", retry: { safe: true, reason: "Fixture" }, recommendedAction: "Retry fixture", logReference: "logs/tasks/fixture.log" } } : {}),
        });
        result = { isError: false, structuredContent: { tasks: taskPollCount === 1
          ? [task("task_notify0001", "compiling"), task("task_history0001", "completed")]
          : [task("task_notify0001", "completed"), task("task_failure001", "failed", "BW-FIXTURE-FAIL"), task("task_history0001", "completed")] } };
      } else {
        response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "fixture method not found" } }));
        return;
      }
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
    return;
  }
  response.end(JSON.stringify({ service, endpoint: request.url }));
});
server.listen(port, "127.0.0.1", () => {
  console.log(`ENTRY=__entry NODE_ENV=${process.env.NODE_ENV} __PORT=${process.env.__PORT} PORT=${process.env.PORT}`);
  console.log(`NPM_ENV_CACHE=${process.env.NPM_CONFIG_CACHE} NPM_ENV_UPDATE_NOTIFIER=${process.env.NPM_CONFIG_UPDATE_NOTIFIER}`);
});
if (process.env.BLOCKWRIGHT_FIXTURE_IGNORE_STDIN !== "1") {
  process.stdin.resume();
  process.stdin.on("end", () => server.close(() => process.exit(0)));
}
'@
    $fixtureDiagnostics = @'
const evidence = {
  npmCache: process.env.NPM_CONFIG_CACHE || null,
  npmUpdateNotifier: process.env.NPM_CONFIG_UPDATE_NOTIFIER || null,
  localAppData: process.env.LOCALAPPDATA || null,
};
process.stdout.write(`${JSON.stringify({
  checks: [{
    status: "pass",
    area: "Runtime",
    name: "Diagnostic child environment",
    message: `CACHE=${evidence.npmCache} UPDATE=${evidence.npmUpdateNotifier}`,
  }],
  evidence,
})}\n`);
'@
    [System.IO.File]::WriteAllText((Join-Path $appRoot "package.json"), $packageJson, (New-Object System.Text.UTF8Encoding($false)))
    [System.IO.File]::WriteAllText((Join-Path $appRoot "package-lock.json"), $packageLock, (New-Object System.Text.UTF8Encoding($false)))
    [System.IO.File]::WriteAllText((Join-Path $distRoot "__entry.js"), $fixtureServer, (New-Object System.Text.UTF8Encoding($false)))
    [System.IO.File]::WriteAllText((Join-Path $fixtureRoot "scripts\diagnose.mjs"), $fixtureDiagnostics, (New-Object System.Text.UTF8Encoding($false)))
    [System.IO.File]::Copy($repairPath, (Join-Path $fixtureWindowsScripts "Invoke-BlockwrightRuntimeRepair.ps1"), $true)
    [System.IO.File]::Copy($pathsModulePath, (Join-Path $fixtureWindowsScripts "Blockwright-Paths.psm1"), $true)
    [System.IO.File]::Copy($launcherVbsPath, (Join-Path $fixtureWindowsScripts "Launch-Blockwright-ControlCenter.vbs"), $true)

    $controllerAst = $null
    $repairAst = $null
    foreach ($scriptPath in @($controllerPath, $repairPath, $pathsModulePath, $shortcutInstallerPath, $launcherBuilderPath, $PSCommandPath)) {
        $tokens = $null
        $parseErrors = $null
        $parsedAst = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors)
        Assert-Condition ($parseErrors.Count -eq 0) "PowerShell parsing failed for $scriptPath`: $($parseErrors.Message -join '; ')"
        if ($scriptPath -eq $controllerPath) { $controllerAst = $parsedAst }
        if ($scriptPath -eq $repairPath) { $repairAst = $parsedAst }
    }
    Add-Pass "powershell-parse" "Controller, path/runtime module, repair helper, shortcut helper, and this test script parse without errors."

    $controllerSource = [System.IO.File]::ReadAllText($controllerPath)
    foreach ($requiredFragment in @('app\dist\__entry.js', 'Get-BlockwrightPrivateNode', 'Write-ManagedServerRecord', 'BLOCKWRIGHT_STATE_ROOT = $script:StateRoot', 'BLOCKWRIGHT_STATE_DIR = $script:StateRoot', 'BLOCKWRIGHT_LOCAL_MCP_TOKEN = $script:LocalMcpToken', 'New-LocalMcpToken', 'Authorization', 'NODE_ENV = "production"', '__PORT = [string]$Port', 'npm ls', 'NPM_CONFIG_CACHE', 'NPM_CONFIG_UPDATE_NOTIFIER', 'TakeDroppedCount', 'MaxLines = 250', 'Invoke-PrimaryWorkflowSmokeTest', 'tools/list', '-MaximumResponseCharacters 4194304', 'compile_build', 'validate_build_contract', 'export_build', 'ProcessTreeSnapshot', 'Complete-ConfirmedServerStop -RemoveManagedRecord', 'process-tree exit could not be confirmed', 'Ownership evidence was retained', 'SupervisorSelfTest', 'Local\Blockwright.ControlCenter.', 'Start-BlockwrightActivationListener', 'Blockwright.ControlCenter', 'SetCurrentProcessExplicitAppUserModelID', 'Get-BlockwrightJumpLaunchSpec', '--new-build', '-OpenDiagnostics', 'JumpList]::SetJumpList', 'NotifyIcon', 'New build / Open workbench', 'Settings / Open state location', 'Get-BlockwrightCrashRestartDecision', 'CrashRestartLimit = 3', 'PersistentLogMaximumBytes', 'Protect-BlockwrightLogText', 'Get-BlockwrightManagedProcessStatus', 'TaskPollIntervalSeconds = 5', 'HttpClient', 'name = "list_tasks"', 'Get-BlockwrightTaskNotificationEvents', 'TaskbarItemInfo', 'TaskbarItemProgressState]::Normal', 'TaskbarItemProgressState]::Indeterminate', 'TaskbarItemProgressState]::Error', 'UpdateButton', 'Update-Blockwright.ps1', 'Start-BlockwrightUpdateProcess -Mode "check"', ' -CheckOnly', 'MessageBoxResult]::Yes', 'Start-BlockwrightUpdateProcess -Mode "install"', 'last-check.json', 'nothing will be installed without confirmation')) {
        Assert-Condition ($controllerSource.Contains($requiredFragment)) "Controller contract fragment is missing: $requiredFragment"
    }
    $checkInvocationIndex = $controllerSource.IndexOf('Start-BlockwrightUpdateProcess -Mode "check"')
    $confirmationIndex = $controllerSource.IndexOf('MessageBoxResult]::Yes')
    $installInvocationIndex = $controllerSource.IndexOf('Start-BlockwrightUpdateProcess -Mode "install"')
    Assert-Condition ($checkInvocationIndex -ge 0 -and $confirmationIndex -ge 0 -and $installInvocationIndex -gt $confirmationIndex) "Control Center update installation is not structurally gated behind the explicit confirmation result."
    Assert-Condition (-not $controllerSource.Contains('/api/local/editor/tasks')) "Control Center task notifications bypassed authenticated MCP for the weaker loopback editor route."
    Add-Pass "source-contracts" "Direct entry, stable Windows identity, native-aware Jump List actions, authenticated bounded task polling, real taskbar progress, install-keyed supervision, sanitized persistence, and confirmed two-phase updates are present."

    $dependencyStatusFunction = $controllerAst.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq "Get-RuntimeDependencyStatus"
    }, $true) | Select-Object -First 1
    Assert-Condition ($null -ne $dependencyStatusFunction) "Controller dependency-status function was unavailable for native npm boundary testing."
    . ([scriptblock]::Create($dependencyStatusFunction.Extent.Text))
    $script:NonzeroNpmFixture = Join-Path $testRoot "npm exits nonzero.cmd"
    $nonzeroNpmSource = @'
@echo off
echo CACHE=%NPM_CONFIG_CACHE%
echo UPDATE=%NPM_CONFIG_UPDATE_NOTIFIER%
echo forced npm failure 1>&2
exit /b 17
'@
    [System.IO.File]::WriteAllText($script:NonzeroNpmFixture, $nonzeroNpmSource, [System.Text.Encoding]::ASCII)
    function Get-NpmExecutable { return $script:NonzeroNpmFixture }
    $ResolvedPluginRoot = $fixtureRoot
    $script:StateRoot = Join-Path $testRoot "state"
    $originalTestNpmCache = [Environment]::GetEnvironmentVariable("NPM_CONFIG_CACHE", [EnvironmentVariableTarget]::Process)
    $originalTestNpmUpdateNotifier = [Environment]::GetEnvironmentVariable("NPM_CONFIG_UPDATE_NOTIFIER", [EnvironmentVariableTarget]::Process)
    $testPreferenceBefore = $ErrorActionPreference
    try {
        $env:NPM_CONFIG_CACHE = "fixture-caller-cache"
        $env:NPM_CONFIG_UPDATE_NOTIFIER = "fixture-caller-notifier"
        $nonzeroNpmStatus = Get-RuntimeDependencyStatus
        $testNpmCacheAfter = [Environment]::GetEnvironmentVariable("NPM_CONFIG_CACHE", [EnvironmentVariableTarget]::Process)
        $testNpmUpdateNotifierAfter = [Environment]::GetEnvironmentVariable("NPM_CONFIG_UPDATE_NOTIFIER", [EnvironmentVariableTarget]::Process)
        $testPreferenceAfter = $ErrorActionPreference
    } finally {
        try {
            [Environment]::SetEnvironmentVariable("NPM_CONFIG_CACHE", $originalTestNpmCache, [EnvironmentVariableTarget]::Process)
        } finally {
            [Environment]::SetEnvironmentVariable("NPM_CONFIG_UPDATE_NOTIFIER", $originalTestNpmUpdateNotifier, [EnvironmentVariableTarget]::Process)
        }
    }
    Assert-Condition (-not [bool]$nonzeroNpmStatus.Valid -and [int]$nonzeroNpmStatus.NpmExitCode -eq 17) "A nonzero native npm result was not rejected with its exact exit code."
    Assert-Condition ([string]$nonzeroNpmStatus.Message -match "npm ls rejected.*exit 17" -and [string]$nonzeroNpmStatus.Message -match [regex]::Escape((Join-Path $script:StateRoot "npm-cache")) -and [string]$nonzeroNpmStatus.Message -match "UPDATE=false") "The native npm failure did not prove state-local cache routing and disabled update notices."
    Assert-Condition ([string]$testNpmCacheAfter -ceq "fixture-caller-cache" -and [string]$testNpmUpdateNotifierAfter -ceq "fixture-caller-notifier" -and [string]$testPreferenceAfter -ceq [string]$testPreferenceBefore) "Native npm validation did not restore the caller environment and ErrorActionPreference exactly."
    Add-Pass "npm-validation-boundary" "A benign stderr-capable native boundary preserved explicit caller state, while exit 17 remained an invalid dependency result with state-local cache evidence."

    $script:NonzeroNpmFixture = Join-Path $testRoot "npm notice exits zero.cmd"
    $noticeNpmSource = @'
@echo off
echo {"name":"blockwright-control-center-fixture","version":"9.9.9"}
echo npm notice 1>&2
exit /b 0
'@
    [System.IO.File]::WriteAllText($script:NonzeroNpmFixture, $noticeNpmSource, [System.Text.Encoding]::ASCII)
    $originalNoticeNpmCache = [Environment]::GetEnvironmentVariable("NPM_CONFIG_CACHE", [EnvironmentVariableTarget]::Process)
    $originalNoticeNpmUpdateNotifier = [Environment]::GetEnvironmentVariable("NPM_CONFIG_UPDATE_NOTIFIER", [EnvironmentVariableTarget]::Process)
    $noticePreferenceBefore = $ErrorActionPreference
    try {
        $env:NPM_CONFIG_CACHE = "fixture-notice-caller-cache"
        $env:NPM_CONFIG_UPDATE_NOTIFIER = "fixture-notice-caller-notifier"
        $noticeNpmStatus = Get-RuntimeDependencyStatus
        $noticeNpmCacheAfter = [Environment]::GetEnvironmentVariable("NPM_CONFIG_CACHE", [EnvironmentVariableTarget]::Process)
        $noticeNpmUpdateNotifierAfter = [Environment]::GetEnvironmentVariable("NPM_CONFIG_UPDATE_NOTIFIER", [EnvironmentVariableTarget]::Process)
        $noticePreferenceAfter = $ErrorActionPreference
    } finally {
        try {
            [Environment]::SetEnvironmentVariable("NPM_CONFIG_CACHE", $originalNoticeNpmCache, [EnvironmentVariableTarget]::Process)
        } finally {
            [Environment]::SetEnvironmentVariable("NPM_CONFIG_UPDATE_NOTIFIER", $originalNoticeNpmUpdateNotifier, [EnvironmentVariableTarget]::Process)
        }
    }
    Assert-Condition ([bool]$noticeNpmStatus.Valid -and [int]$noticeNpmStatus.NpmExitCode -eq 0) "A native npm notice on stderr with exit 0 was incorrectly treated as an invalid dependency result."
    Assert-Condition ([string]$noticeNpmCacheAfter -ceq "fixture-notice-caller-cache" -and [string]$noticeNpmUpdateNotifierAfter -ceq "fixture-notice-caller-notifier" -and [string]$noticePreferenceAfter -ceq [string]$noticePreferenceBefore) "Successful native npm validation did not restore the caller environment and ErrorActionPreference exactly."
    Add-Pass "npm-notice-boundary" "A literal npm notice on stderr with exit 0 remained valid and restored the exact caller environment and ErrorActionPreference."

    $repairNpmFunction = $repairAst.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq "Invoke-NpmRepairCommands"
    }, $true) | Select-Object -First 1
    Assert-Condition ($null -ne $repairNpmFunction) "Repair helper npm boundary function was unavailable for native stderr and restoration testing."
    . ([scriptblock]::Create($repairNpmFunction.Extent.Text))
    $stateRoot = Join-Path $testRoot "repair state"
    $repairExternalLocalAppDataProbe = Join-Path $testRoot "repair external local appdata probe"
    $null = New-Item -ItemType Directory -Path $repairExternalLocalAppDataProbe -Force
    $repairEvidencePath = Join-Path $testRoot "repair npm evidence.txt"
    $repairNoticeNpmPath = Join-Path $testRoot "repair npm notice exits zero.cmd"
    $repairNoticeNpmSource = @'
@echo off
>>"%BLOCKWRIGHT_REPAIR_TEST_EVIDENCE%" echo CACHE=%NPM_CONFIG_CACHE% UPDATE=%NPM_CONFIG_UPDATE_NOTIFIER% ARGS=%*
echo npm notice 1>&2
exit /b 0
'@
    [System.IO.File]::WriteAllText($repairNoticeNpmPath, $repairNoticeNpmSource, [System.Text.Encoding]::ASCII)
    $repairNonzeroNpmPath = Join-Path $testRoot "repair npm exits nonzero.cmd"
    $repairNonzeroNpmSource = @'
@echo off
>>"%BLOCKWRIGHT_REPAIR_TEST_EVIDENCE%" echo CACHE=%NPM_CONFIG_CACHE% UPDATE=%NPM_CONFIG_UPDATE_NOTIFIER% ARGS=%*
echo forced repair npm failure 1>&2
exit /b 17
'@
    [System.IO.File]::WriteAllText($repairNonzeroNpmPath, $repairNonzeroNpmSource, [System.Text.Encoding]::ASCII)
    $originalRepairLocalAppData = [Environment]::GetEnvironmentVariable("LOCALAPPDATA", [EnvironmentVariableTarget]::Process)
    $originalRepairNpmCache = [Environment]::GetEnvironmentVariable("NPM_CONFIG_CACHE", [EnvironmentVariableTarget]::Process)
    $originalRepairNpmUpdateNotifier = [Environment]::GetEnvironmentVariable("NPM_CONFIG_UPDATE_NOTIFIER", [EnvironmentVariableTarget]::Process)
    $originalRepairEvidence = [Environment]::GetEnvironmentVariable("BLOCKWRIGHT_REPAIR_TEST_EVIDENCE", [EnvironmentVariableTarget]::Process)
    $originalRepairPreference = $ErrorActionPreference
    try {
        $env:LOCALAPPDATA = $repairExternalLocalAppDataProbe
        $env:BLOCKWRIGHT_REPAIR_TEST_EVIDENCE = $repairEvidencePath

        $env:NPM_CONFIG_CACHE = "repair-notice-caller-cache"
        $env:NPM_CONFIG_UPDATE_NOTIFIER = "repair-notice-caller-notifier"
        $repairNoticePreferenceBefore = $ErrorActionPreference
        $repairNoticeFailure = $null
        $repairNoticeOutput = @()
        try {
            $repairNoticeOutput = @(Invoke-NpmRepairCommands -NpmPath $repairNoticeNpmPath -InstallArguments @("ci", "--omit=dev"))
        } catch {
            $repairNoticeFailure = $_.Exception.Message
        }
        $repairNoticeNpmCacheAfter = [Environment]::GetEnvironmentVariable("NPM_CONFIG_CACHE", [EnvironmentVariableTarget]::Process)
        $repairNoticeNpmUpdateNotifierAfter = [Environment]::GetEnvironmentVariable("NPM_CONFIG_UPDATE_NOTIFIER", [EnvironmentVariableTarget]::Process)
        $repairNoticePreferenceAfter = $ErrorActionPreference

        $env:NPM_CONFIG_CACHE = "repair-failure-caller-cache"
        $env:NPM_CONFIG_UPDATE_NOTIFIER = "repair-failure-caller-notifier"
        $repairFailurePreferenceBefore = $ErrorActionPreference
        $repairFailureMessage = $null
        try {
            $null = @(Invoke-NpmRepairCommands -NpmPath $repairNonzeroNpmPath -InstallArguments @("ci", "--omit=dev"))
        } catch {
            $repairFailureMessage = $_.Exception.Message
        }
        $repairFailureNpmCacheAfter = [Environment]::GetEnvironmentVariable("NPM_CONFIG_CACHE", [EnvironmentVariableTarget]::Process)
        $repairFailureNpmUpdateNotifierAfter = [Environment]::GetEnvironmentVariable("NPM_CONFIG_UPDATE_NOTIFIER", [EnvironmentVariableTarget]::Process)
        $repairFailurePreferenceAfter = $ErrorActionPreference
        $repairExternalProbeEntries = @(Get-ChildItem -LiteralPath $repairExternalLocalAppDataProbe -Force -Recurse)
        $repairEvidence = if (Test-Path -LiteralPath $repairEvidencePath -PathType Leaf) { Get-Content -Raw -LiteralPath $repairEvidencePath } else { "" }
    } finally {
        try {
            [Environment]::SetEnvironmentVariable("LOCALAPPDATA", $originalRepairLocalAppData, [EnvironmentVariableTarget]::Process)
        } finally {
            try {
                [Environment]::SetEnvironmentVariable("NPM_CONFIG_CACHE", $originalRepairNpmCache, [EnvironmentVariableTarget]::Process)
            } finally {
                try {
                    [Environment]::SetEnvironmentVariable("NPM_CONFIG_UPDATE_NOTIFIER", $originalRepairNpmUpdateNotifier, [EnvironmentVariableTarget]::Process)
                } finally {
                    try {
                        [Environment]::SetEnvironmentVariable("BLOCKWRIGHT_REPAIR_TEST_EVIDENCE", $originalRepairEvidence, [EnvironmentVariableTarget]::Process)
                    } finally {
                        $ErrorActionPreference = $originalRepairPreference
                    }
                }
            }
        }
    }
    $expectedRepairCache = Join-Path $stateRoot "npm-cache"
    Assert-Condition ([string]::IsNullOrWhiteSpace([string]$repairNoticeFailure) -and (($repairNoticeOutput -join "`n") -match "npm notice")) "The repair helper treated a benign npm notice with exit 0 as a failure: $repairNoticeFailure"
    Assert-Condition ([string]$repairNoticeNpmCacheAfter -ceq "repair-notice-caller-cache" -and [string]$repairNoticeNpmUpdateNotifierAfter -ceq "repair-notice-caller-notifier" -and [string]$repairNoticePreferenceAfter -ceq [string]$repairNoticePreferenceBefore) "Successful repair npm commands did not restore the exact caller environment and ErrorActionPreference."
    Assert-Condition ([string]$repairEvidence -match [regex]::Escape("CACHE=$expectedRepairCache UPDATE=false") -and [string]$repairEvidence -match "ARGS=ci --omit=dev" -and [string]$repairEvidence -match "ARGS=ls --omit=dev --depth=0 --json") "Successful repair npm commands did not prove state-local cache routing, disabled notices, and both expected invocations."
    Add-Pass "repair-npm-notice-boundary" "The repair path accepted literal npm notices with exit 0, used the state-local cache for install and validation, and restored exact caller state."

    Assert-Condition ([string]$repairFailureMessage -ceq "npm dependency repair exited with code 17.") "A nonzero repair npm result did not fail with its exact exit code: $repairFailureMessage"
    Assert-Condition ([string]$repairFailureNpmCacheAfter -ceq "repair-failure-caller-cache" -and [string]$repairFailureNpmUpdateNotifierAfter -ceq "repair-failure-caller-notifier" -and [string]$repairFailurePreferenceAfter -ceq [string]$repairFailurePreferenceBefore) "Failed repair npm commands did not restore the exact caller environment and ErrorActionPreference."
    Assert-Condition ($repairExternalProbeEntries.Count -eq 0) "Repair npm commands wrote cache/update state beneath external LOCALAPPDATA."
    Add-Pass "repair-npm-failure-boundary" "Repair rejected native exit 17, restored exact caller state on failure, and left external LOCALAPPDATA unchanged."

    foreach ($functionName in @("Test-BlockwrightPortAvailable", "Select-BlockwrightPort")) {
        $functionAst = $controllerAst.FindAll({
            param($node)
            $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $functionName
        }, $true) | Select-Object -First 1
        Assert-Condition ($null -ne $functionAst) "Controller function was unavailable for port-collision testing: $functionName"
        . ([scriptblock]::Create($functionAst.Extent.Text))
    }
    function Save-BlockwrightPreferredPort {
        param([int]$PreferredPort)
        $script:PersistedCollisionPort = $PreferredPort
    }
    function Add-ControllerLog { param([string]$Message) }

    $occupiedPortListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try {
        $occupiedPortListener.Start()
        $occupiedPort = ([System.Net.IPEndPoint]$occupiedPortListener.LocalEndpoint).Port
        $script:PortWasExplicit = $false
        $script:PersistedCollisionPort = $null
        $selectedPort = Select-BlockwrightPort -PreferredPort $occupiedPort
        Assert-Condition ($selectedPort -ne $occupiedPort) "Automatic port selection reused the occupied preferred port."
        Assert-Condition ($selectedPort -eq $script:PersistedCollisionPort) "Automatic port selection did not persist the selected loopback port."
        Assert-Condition (Test-PortAvailable -Port $selectedPort) "Automatic port selection returned an unavailable candidate."

        $script:PortWasExplicit = $true
        $explicitFailure = $null
        try { $null = Select-BlockwrightPort -PreferredPort $occupiedPort } catch { $explicitFailure = $_.Exception.Message }
        Assert-Condition ([string]$explicitFailure -match "already in use") "An occupied explicit -Port did not fail with an actionable collision error."
    } finally {
        $occupiedPortListener.Stop()
    }
    Add-Pass "automatic-port-collision" "An occupied preferred port selected and persisted a free loopback successor, while an occupied explicit -Port failed closed."

    $supervisorArguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $(Quote-NativeArgument $controllerPath) -PluginRoot $(Quote-NativeArgument $fixtureRoot) -SupervisorSelfTest"
    $supervisorResult = Invoke-WindowsPowerShell -Arguments $supervisorArguments
    Assert-Condition ($supervisorResult.ExitCode -eq 0) "Headless supervisor self-test failed: $($supervisorResult.StandardError) $($supervisorResult.StandardOutput)"
    $supervisor = $supervisorResult.StandardOutput | ConvertFrom-Json
    Assert-Condition ([bool]$supervisor.Valid -and [bool]$supervisor.Redaction -and [bool]$supervisor.Rotation -and [bool]$supervisor.RestartBudget -and [bool]$supervisor.ActivationChannel -and [bool]$supervisor.SafeLauncherFallback -and [bool]$supervisor.TaskNotifications) "Headless supervisor self-test did not verify every declared helper."
    Assert-Condition ([string]$supervisor.InstallIdentity -match '^[a-f0-9]{24}$') "Install-root supervisor identity was not a bounded deterministic key."
    Assert-Condition ([string]$supervisor.AppUserModelId -ceq 'Blockwright.ControlCenter' -and [int]$supervisor.JumpListActions -eq 4) "Stable AppUserModelID or Jump List action contract was not verified."
    Add-Pass "supervisor-headless" "Install identity, AppUserModelID, Jump List fallback mapping, terminal-task deduplication, sanitized rotating logs, crash-restart budget, and named-pipe activation passed without opening the UI."

    $validateArguments = "-NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File $(Quote-NativeArgument $controllerPath) -PluginRoot $(Quote-NativeArgument $fixtureRoot) -ValidateUi"
    $validateResult = Invoke-WindowsPowerShell -Arguments $validateArguments
    Assert-Condition ($validateResult.ExitCode -eq 0) "WPF validation failed: $($validateResult.StandardError)"
    $validation = $validateResult.StandardOutput | ConvertFrom-Json
    Assert-Condition ([bool]$validation.valid) "WPF named-control validation reported invalid."
    Add-Pass "wpf-validation" "$($validation.controls) named controls resolved without opening the UI."

    $diagnosticExternalLocalAppDataProbe = Join-Path $testRoot "diagnostic external local appdata probe"
    $null = New-Item -ItemType Directory -Path $diagnosticExternalLocalAppDataProbe -Force
    $diagnosticArguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $(Quote-NativeArgument $controllerPath) -PluginRoot $(Quote-NativeArgument $fixtureRoot) -Diagnostics -Json"
    $diagnosticResult = Invoke-WindowsPowerShell -Arguments $diagnosticArguments -EnvironmentVariables @{
        LOCALAPPDATA = $diagnosticExternalLocalAppDataProbe
        NPM_CONFIG_CACHE = "diagnostic-caller-cache"
        NPM_CONFIG_UPDATE_NOTIFIER = "diagnostic-caller-notifier"
    }
    Assert-Condition ($diagnosticResult.ExitCode -eq 0) "Headless diagnostics environment isolation failed: $($diagnosticResult.StandardError) $($diagnosticResult.StandardOutput)"
    $diagnostic = $diagnosticResult.StandardOutput | ConvertFrom-Json
    $expectedDiagnosticCache = Join-Path (Join-Path $testRoot "state") "npm-cache"
    Assert-Condition ([string]$diagnostic.status -ceq "PASS" -and [string]$diagnostic.raw.evidence.npmCache -ceq $expectedDiagnosticCache -and [string]$diagnostic.raw.evidence.npmUpdateNotifier -ceq "false") "The diagnostic child did not receive the state-local npm cache and disabled update notifier."
    Assert-Condition ([string]$diagnostic.raw.evidence.localAppData -ceq $diagnosticExternalLocalAppDataProbe -and @(Get-ChildItem -LiteralPath $diagnosticExternalLocalAppDataProbe -Force -Recurse).Count -eq 0) "Diagnostics mutated the redirected external LOCALAPPDATA probe."
    Add-Pass "diagnostics-npm-isolation" "Headless diagnostics received child-only state-local npm settings and left redirected external LOCALAPPDATA unchanged."

    $capturePath = Join-Path $testRoot "control-center-render.png"
    $captureArguments = "-NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File $(Quote-NativeArgument $controllerPath) -PluginRoot $(Quote-NativeArgument $fixtureRoot) -CaptureUiPath $(Quote-NativeArgument $capturePath)"
    $captureResult = Invoke-WindowsPowerShell -Arguments $captureArguments
    Assert-Condition ($captureResult.ExitCode -eq 0) "Render-only Control Center capture failed: $($captureResult.StandardError)"
    Assert-Condition ((Test-Path -LiteralPath $capturePath -PathType Leaf) -and (Get-Item -LiteralPath $capturePath).Length -gt 10000) "Render-only Control Center capture did not produce a substantive PNG."
    Add-Pass "render-only-capture" "The updated stopped-state Control Center can render to PNG without starting a server or update operation."

    $smokePort = Get-FreePort
    $smokeArguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File $(Quote-NativeArgument $controllerPath) -PluginRoot $(Quote-NativeArgument $fixtureRoot) -SmokeTest -SmokeTestSeconds 10 -Port $smokePort -Json"
    $externalLocalAppDataProbe = Join-Path $testRoot "external local appdata probe"
    $null = New-Item -ItemType Directory -Path $externalLocalAppDataProbe -Force
    $smokeResult = Invoke-WindowsPowerShell -Arguments $smokeArguments -EnvironmentVariables @{
        LOCALAPPDATA = $externalLocalAppDataProbe
        NPM_CONFIG_CACHE = "fixture-original-cache"
        NPM_CONFIG_UPDATE_NOTIFIER = "fixture-original-notifier"
    }
    Assert-Condition ($smokeResult.ExitCode -eq 0) "Direct-entry smoke failed: $($smokeResult.StandardError) $($smokeResult.StandardOutput)"
    $smoke = $smokeResult.StandardOutput | ConvertFrom-Json
    Assert-Condition ([bool]$smoke.healthy) "Direct-entry smoke did not become healthy."
    Assert-Condition ([bool]$smoke.workflow.passed -and [bool]$smoke.workflow.deterministicReplay -and [bool]$smoke.workflow.validationValid -and [string]$smoke.workflow.contractStatus -eq "valid" -and [string]$smoke.workflow.exportFormat -eq "schem" -and [int]$smoke.workflow.schematicVersion -eq 3) "Direct-entry smoke did not exercise the deterministic compile/validation/export workflow."
    Assert-Condition ([string]$smoke.workflow.asyncTaskId -ceq "task_smoke_async001" -and [int]$smoke.workflow.asyncTaskPolls -eq 2 -and [string]$smoke.workflow.asyncTaskState -ceq "completed" -and [bool]$smoke.workflow.asyncTaskResultAvailable -and [string]$smoke.workflow.asyncTaskBuildId -ceq "bw_123456789abc" -and [string]$smoke.workflow.asyncTaskBuildHash -ceq ('a' * 64) -and [int]$smoke.workflow.asyncTaskBlockCount -eq 274) "Direct-entry smoke did not start, poll, and verify an asynchronous compile that reproduces the synchronous build."
    Assert-Condition ([bool]$smoke.taskPolling.authenticatedMcp -and [int]$smoke.taskPolling.observedTasks -eq 3 -and [string]$smoke.taskPolling.finalAttention -ceq "failed") "Authenticated MCP task polling did not establish a quiet baseline and observe terminal transitions."
    $joinedLogs = @($smoke.logs) -join "`n"
    Assert-Condition ($joinedLogs -match "ENTRY=__entry NODE_ENV=production __PORT=$smokePort PORT=$smokePort") "Direct entry did not receive the required production environment."
    Assert-Condition ($joinedLogs -match "NPM_ENV_CACHE=fixture-original-cache NPM_ENV_UPDATE_NOTIFIER=fixture-original-notifier") "Runtime dependency validation did not restore the caller's exact npm environment before starting the server."
    Assert-Condition ($joinedLogs -match "MCP_AUTH=ok") "Control Center did not authenticate its MCP initialize smoke request."
    Assert-Condition ($joinedLogs -notmatch "BLOCKWRIGHT_LOCAL_MCP_TOKEN=") "The per-launch MCP token was written to a captured log."
    Assert-Condition (Test-PortAvailable -Port $smokePort) "The bounded smoke test left port $smokePort in use."
    Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $testRoot "state\run\managed-server.json"))) "The bounded smoke test removed the process but left its managed-process record behind."
    $persistentLog = Join-Path $testRoot "state\logs\control-center.log"
    Assert-Condition ((Test-Path -LiteralPath $persistentLog -PathType Leaf) -and (Get-Item -LiteralPath $persistentLog).Length -gt 0) "The controller did not persist a session log beneath the state root."
    $persistentLogText = Get-Content -Raw -LiteralPath $persistentLog
    Assert-Condition ($persistentLogText -notmatch 'Bearer\s+[A-Za-z0-9_-]{20,}|BLOCKWRIGHT_LOCAL_MCP_TOKEN=') "The persistent controller log retained an access token."
    Assert-Condition (@(Get-ChildItem -LiteralPath $externalLocalAppDataProbe -Force).Count -eq 0) "Runtime dependency validation wrote npm cache/update state outside the selected Blockwright state root."
    Add-Pass "direct-entry-smoke" "Strict /health and /ready, MCP initialize/tools/list, deterministic compile/validation/export, an asynchronous compile through terminal result availability and exact build identity, two authenticated list_tasks polls, isolated npm cache placement, and exact npm environment restoration passed on port $smokePort; the process stopped and released the listener."

    $forcedTreePort = Get-FreePort
    do { $forcedChildPort = Get-FreePort } while ($forcedChildPort -eq $forcedTreePort)
    $forcedTreeArguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File $(Quote-NativeArgument $controllerPath) -PluginRoot $(Quote-NativeArgument $fixtureRoot) -SmokeTest -SmokeTestSeconds 10 -Port $forcedTreePort -Json"
    $forcedTreeResult = Invoke-WindowsPowerShell -Arguments $forcedTreeArguments -EnvironmentVariables @{
        BLOCKWRIGHT_FIXTURE_IGNORE_STDIN = "1"
        BLOCKWRIGHT_FIXTURE_CHILD_PORT = [string]$forcedChildPort
    }
    Assert-Condition ($forcedTreeResult.ExitCode -eq 0) "Forced process-tree smoke failed: $($forcedTreeResult.StandardError) $($forcedTreeResult.StandardOutput)"
    $forcedTree = $forcedTreeResult.StandardOutput | ConvertFrom-Json
    Assert-Condition ([bool]$forcedTree.healthy) "Forced process-tree smoke did not become healthy."
    $forcedTreeLogs = @($forcedTree.logs) -join "`n"
    Assert-Condition ($forcedTreeLogs -match "CHILD_PID=(\d+) CHILD_PORT=$forcedChildPort") "The forced-stop fixture did not report its descendant process."
    $forcedChildProcessId = [int]$Matches[1]
    Assert-Condition ($null -eq (Get-Process -Id $forcedChildProcessId -ErrorAction SilentlyContinue)) "Forced stop reported success while descendant PID $forcedChildProcessId remained alive."
    Assert-Condition (Test-PortAvailable -Port $forcedTreePort) "Forced stop left root port $forcedTreePort in use."
    Assert-Condition (Test-PortAvailable -Port $forcedChildPort) "Forced stop left descendant port $forcedChildPort in use."
    Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $testRoot "state\run\managed-server.json"))) "Forced stop left its managed-process record behind."
    Add-Pass "forced-tree-stop" "A server that ignored graceful stdin shutdown and its listening descendant were force-stopped, verified exited, and had their ownership record removed."

    $recordFailureStateRoot = Join-Path $testRoot "record failure state"
    $null = New-Item -ItemType Directory -Path $recordFailureStateRoot -Force
    [System.IO.File]::WriteAllText((Join-Path $recordFailureStateRoot "run"), "blocks the managed-record directory", (New-Object System.Text.UTF8Encoding($false)))
    $recordFailurePort = Get-FreePort
    $recordFailureArguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File $(Quote-NativeArgument $controllerPath) -PluginRoot $(Quote-NativeArgument $fixtureRoot) -SmokeTest -SmokeTestSeconds 5 -Port $recordFailurePort -Json"
    $recordFailureResult = Invoke-WindowsPowerShell -Arguments $recordFailureArguments -EnvironmentVariables @{ BLOCKWRIGHT_STATE_ROOT = $recordFailureStateRoot }
    Assert-Condition ($recordFailureResult.ExitCode -eq 1) "Managed-record persistence failure did not fail startup. Output: $($recordFailureResult.StandardOutput) Error: $($recordFailureResult.StandardError)"
    $recordFailure = $recordFailureResult.StandardOutput | ConvertFrom-Json
    Assert-Condition ([string]$recordFailure.failure -match "managed-process record could not be persisted") "Managed-record failure did not identify the persistence error."
    Assert-Condition ([string]$recordFailure.failure -match "process tree was stopped before startup failed") "Managed-record failure did not confirm transactional process cleanup."
    Assert-Condition (Test-PortAvailable -Port $recordFailurePort) "Managed-record failure left the newly started server listening on port $recordFailurePort."
    $fixtureEntryPath = Join-Path $distRoot "__entry.js"
    $orphanedFixtureProcesses = @(Get-CimInstance Win32_Process -Property ProcessId, CommandLine -ErrorAction SilentlyContinue | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_.CommandLine) -and $_.CommandLine.IndexOf($fixtureEntryPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    })
    Assert-Condition ($orphanedFixtureProcesses.Count -eq 0) "Managed-record failure left a fixture Node process alive: $($orphanedFixtureProcesses.ProcessId -join ', ')."
    Add-Pass "record-persistence-rollback" "A post-launch managed-record write failure stopped and verified the new process tree before startup reported failure."

    foreach ($functionName in @('Test-ProcessRunning', 'Get-ProcessTreeSnapshot', 'Test-CapturedProcessIdentityRunning', 'Get-RunningCapturedProcessIds', 'Stop-CapturedProcessTree')) {
        $functionAst = @($controllerAst.FindAll({
            param($node)
            $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $functionName
        }, $true))[0]
        Assert-Condition ($null -ne $functionAst) "Controller test helper could not locate function $functionName."
        Invoke-Expression $functionAst.Extent.Text
    }
    $sleeperStartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $sleeperStartInfo.FileName = $windowsPowerShell
    $sleeperStartInfo.Arguments = '-NoLogo -NoProfile -NonInteractive -Command "Start-Sleep -Seconds 30"'
    $sleeperStartInfo.UseShellExecute = $false
    $sleeperStartInfo.CreateNoWindow = $true
    $sleeperStartInfo.RedirectStandardInput = $true
    $sleeper = New-Object System.Diagnostics.Process
    $sleeper.StartInfo = $sleeperStartInfo
    Assert-Condition ($sleeper.Start()) "Failed-force fixture process did not start."
    $failedForceHandle = [pscustomobject]@{ Process = $sleeper; ProcessTreeSnapshot = @() }
    try {
        $failedForceMessage = $null
        try {
            Stop-CapturedProcessTree -Handle $failedForceHandle -GraceMilliseconds 50 -ForceWaitMilliseconds 200 -TaskKillPath (Join-Path $env:SystemRoot "System32\whoami.exe")
        } catch {
            $failedForceMessage = $_.Exception.Message
        }
        Assert-Condition ([string]$failedForceMessage -match "process-tree exit could not be confirmed") "A failed forced stop did not report that exit was unconfirmed: $failedForceMessage"
        Assert-Condition (-not $sleeper.HasExited) "The failed-force fixture unexpectedly exited, so evidence retention was not exercised."
        Assert-Condition (@($failedForceHandle.ProcessTreeSnapshot | Where-Object { [int]$_.ProcessId -eq $sleeper.Id }).Count -eq 1) "A failed forced stop discarded the captured ownership identity."
    } finally {
        if (-not $sleeper.HasExited) {
            try { $sleeper.Kill() } catch {}
            try { $null = $sleeper.WaitForExit(5000) } catch {}
        }
        $sleeper.Dispose()
    }
    Add-Pass "failed-force-retains-evidence" "When the forced-stop utility did not terminate the process, stop failed and retained the captured process identity."

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

    $fixtureLauncherPath = Join-Path $fixtureRoot "Blockwright.exe"
    $launcherBuildArguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File $(Quote-NativeArgument $launcherBuilderPath) -OutputPath $(Quote-NativeArgument $fixtureLauncherPath) -Version 0.8.0"
    $launcherBuildResult = Invoke-WindowsPowerShell -Arguments $launcherBuildArguments
    Assert-Condition ($launcherBuildResult.ExitCode -eq 0 -and (Test-Path -LiteralPath $fixtureLauncherPath -PathType Leaf)) "Fixture native launcher build failed: $($launcherBuildResult.StandardError)"

    $shortcutArguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File $(Quote-NativeArgument $shortcutInstallerPath) -InstallRoot $(Quote-NativeArgument $fixtureRoot) -ShortcutDirectory $(Quote-NativeArgument $shortcutRoot) -PassThru"
    $shortcutResult = Invoke-WindowsPowerShell -Arguments $shortcutArguments
    Assert-Condition ($shortcutResult.ExitCode -eq 0) "Temporary shortcut install failed: $($shortcutResult.StandardError)"
    $shortcutPath = Join-Path $shortcutRoot "Blockwright Control Center.lnk"
    Assert-Condition (Test-Path -LiteralPath $shortcutPath -PathType Leaf) "The temporary shortcut was not created."

    $shell = New-Object -ComObject WScript.Shell
    $createdShortcut = $shell.CreateShortcut($shortcutPath)
    Assert-Condition ([System.IO.Path]::GetFullPath([string]$createdShortcut.TargetPath).Equals([System.IO.Path]::GetFullPath($fixtureLauncherPath), [StringComparison]::OrdinalIgnoreCase)) "The helper-created Start Menu shortcut did not target the native Blockwright launcher."
    Assert-Condition ([string]::IsNullOrWhiteSpace([string]$createdShortcut.Arguments)) "The helper-created Start Menu shortcut unexpectedly added launcher arguments."
    Assert-Condition ([string]$createdShortcut.IconLocation -match ('(?i)^' + [regex]::Escape([System.IO.Path]::GetFullPath($fixtureLauncherPath)) + ',0$')) "The helper-created Start Menu shortcut did not use the native Blockwright launcher icon."
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
