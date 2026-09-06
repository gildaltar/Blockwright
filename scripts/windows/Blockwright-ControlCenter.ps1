[CmdletBinding()]
param(
    [string]$PluginRoot,
    [switch]$Diagnostics,
    [switch]$Json,
    [switch]$ValidateUi,
    [switch]$SmokeTest,
    [switch]$SupervisorSelfTest,
    [string]$CaptureUiPath,
    [string]$OpenSchematic,
    [switch]$Open,
    [switch]$NewBuild,
    [switch]$OpenSettings,
    [switch]$OpenDiagnostics,
    [switch]$StartMinimized,
    [ValidateRange(1024, 65535)]
    [int]$Port = 32147,
    [ValidateRange(5, 180)]
    [int]$SmokeTestSeconds = 30
)

$ErrorActionPreference = "Stop"

$ControllerVersion = "1.1.0"
$script:AppUserModelId = "Blockwright.ControlCenter"
$DefaultPluginRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
if ([string]::IsNullOrWhiteSpace($PluginRoot)) {
    $ResolvedPluginRoot = $DefaultPluginRoot
} else {
    $ResolvedPluginRoot = [System.IO.Path]::GetFullPath($PluginRoot)
}

$pathsModule = Join-Path $PSScriptRoot "Blockwright-Paths.psm1"
if (-not (Test-Path -LiteralPath $pathsModule -PathType Leaf)) { throw "The Windows path/runtime helper is missing: $pathsModule" }
Import-Module $pathsModule -Force
$script:StateRoot = Get-BlockwrightStateRoot -InstallRoot $ResolvedPluginRoot
$script:PortWasExplicit = $PSBoundParameters.ContainsKey("Port")
if (-not $script:PortWasExplicit) {
    $Port = [int](Get-BlockwrightConfiguration -InstallRoot $ResolvedPluginRoot -StateRoot $script:StateRoot).port
}
$script:PersistentLogMaximumBytes = 2097152
$script:PersistentLogArchiveCount = 4
$script:PersistentLogPath = Join-Path $script:StateRoot "logs\control-center.log"
$script:PersistentLogFailure = $null
$script:PersistentLogFailureNotified = $false
$script:SupervisorMutex = $null
$script:SupervisorMutexOwned = $false
$script:ActivationPipe = $null
$script:ActivationWaitTask = $null
$script:ActivationReader = $null
$script:ActivationReadTask = $null
$script:ActivationConnectedAt = $null

if (-not ("BlockwrightShellIdentity" -as [type])) {
    Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;

public static class BlockwrightShellIdentity
{
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern int SetCurrentProcessExplicitAppUserModelID(string appId);
}
'@
}

function Set-BlockwrightAppUserModelId {
    if ($env:OS -ne "Windows_NT") { return }
    $result = [BlockwrightShellIdentity]::SetCurrentProcessExplicitAppUserModelID($script:AppUserModelId)
    if ($result -ne 0) { [System.Runtime.InteropServices.Marshal]::ThrowExceptionForHR($result) }
}

function Get-BlockwrightRequestedActivation {
    $requested = New-Object 'System.Collections.Generic.List[string]'
    if ($Open) { $requested.Add("activate") }
    if ($NewBuild) { $requested.Add("new-build") }
    if ($OpenSettings) { $requested.Add("settings") }
    if ($OpenDiagnostics) { $requested.Add("diagnostics") }
    if (-not [string]::IsNullOrWhiteSpace($OpenSchematic)) { $requested.Add("open-schematic") }
    if ($requested.Count -gt 1) {
        throw "Choose only one Blockwright launch action: -Open, -NewBuild, -OpenSettings, -OpenDiagnostics, or -OpenSchematic."
    }
    return [pscustomobject]@{
        Action = if ($requested.Count -eq 1) { $requested[0] } else { "activate" }
        Explicit = ($requested.Count -eq 1)
    }
}

function Get-BlockwrightJumpActionDefinitions {
    return @(
        [pscustomobject]@{ Key = "open"; Title = "Open Blockwright"; Description = "Open the Blockwright Control Center."; NativeArgument = "--open"; FallbackArgument = "-Open" },
        [pscustomobject]@{ Key = "new-build"; Title = "New Build"; Description = "Open the local Blockwright build workspace."; NativeArgument = "--new-build"; FallbackArgument = "-NewBuild" },
        [pscustomobject]@{ Key = "settings"; Title = "Settings"; Description = "Open Blockwright's per-user settings location."; NativeArgument = "--settings"; FallbackArgument = "-OpenSettings" },
        [pscustomobject]@{ Key = "diagnostics"; Title = "Diagnostics"; Description = "Open and refresh Blockwright diagnostics."; NativeArgument = "--diagnostics"; FallbackArgument = "-OpenDiagnostics" }
    )
}

function Get-BlockwrightLaunchTarget {
    param([Parameter(Mandatory = $true)][string]$InstallRoot)
    $root = [System.IO.Path]::GetFullPath($InstallRoot)
    $nativePath = Join-Path $root "Blockwright.exe"
    if (Test-Path -LiteralPath $nativePath -PathType Leaf) {
        return [pscustomobject]@{ Native = $true; ApplicationPath = $nativePath; ScriptPath = $null }
    }
    $wscriptPath = Join-Path $env:SystemRoot "System32\wscript.exe"
    $scriptPath = Join-Path $root "scripts\windows\Launch-Blockwright-ControlCenter.vbs"
    if (-not (Test-Path -LiteralPath $wscriptPath -PathType Leaf)) { throw "Windows Script Host is unavailable." }
    if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) { throw "The Blockwright Control Center launcher is unavailable." }
    return [pscustomobject]@{ Native = $false; ApplicationPath = $wscriptPath; ScriptPath = $scriptPath }
}

function Get-BlockwrightJumpLaunchSpec {
    param(
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [Parameter(Mandatory = $true)][ValidateSet("open", "new-build", "settings", "diagnostics")][string]$Action
    )
    $definition = Get-BlockwrightJumpActionDefinitions | Where-Object { $_.Key -ceq $Action } | Select-Object -First 1
    $target = Get-BlockwrightLaunchTarget -InstallRoot $InstallRoot
    $arguments = if ($target.Native) {
        [string]$definition.NativeArgument
    } else {
        "//nologo $(Quote-NativeArgument ([string]$target.ScriptPath)) $([string]$definition.FallbackArgument)"
    }
    return [pscustomobject]@{
        Key = [string]$definition.Key
        Title = [string]$definition.Title
        Description = [string]$definition.Description
        ApplicationPath = [string]$target.ApplicationPath
        Arguments = $arguments
        WorkingDirectory = [System.IO.Path]::GetFullPath($InstallRoot)
        Native = [bool]$target.Native
    }
}

function Get-BlockwrightTaskNotificationEvents {
    param(
        [object[]]$Tasks,
        [Parameter(Mandatory = $true)][hashtable]$KnownStates,
        [switch]$EstablishBaseline
    )
    $events = New-Object 'System.Collections.Generic.List[object]'
    $visibleIds = @{}
    foreach ($task in @($Tasks)) {
        $taskId = [string]$task.id
        $state = [string]$task.state
        if ($taskId -notmatch '^task_[A-Za-z0-9_-]{8,80}$' -or $state -notin @("queued", "preparing", "planning", "generating", "compiling", "validating", "auditing", "rendering", "exporting", "installing", "completed", "cancelling", "cancelled", "failed", "interrupted")) { continue }
        $visibleIds[$taskId] = $true
        $previous = if ($KnownStates.ContainsKey($taskId)) { [string]$KnownStates[$taskId] } else { $null }
        $previousWasTerminal = $previous -in @("completed", "cancelled", "failed", "interrupted")
        if (-not $EstablishBaseline -and -not $previousWasTerminal) {
            if ($state -ceq "completed") {
                $events.Add([pscustomobject]@{ Kind = "completed"; Task = $task })
            } elseif ($state -in @("failed", "interrupted")) {
                $events.Add([pscustomobject]@{ Kind = "failed"; Task = $task })
            }
        }
        $KnownStates[$taskId] = $state
    }
    foreach ($knownId in @($KnownStates.Keys)) {
        if (-not $visibleIds.ContainsKey([string]$knownId)) { $null = $KnownStates.Remove($knownId) }
    }
    return $events.ToArray()
}

$script:RequestedActivation = Get-BlockwrightRequestedActivation
if ($Diagnostics -and $script:RequestedActivation.Explicit) {
    throw "The headless -Diagnostics check cannot be combined with a graphical launch action."
}

if (-not ("BlockwrightActivationClient" -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading.Tasks;

public static class BlockwrightActivationClient
{
    public static Task<bool> SendAsync(string pipeName, string payload, int timeoutMilliseconds)
    {
        return Task.Run(() =>
        {
            using (var client = new NamedPipeClientStream(".", pipeName, PipeDirection.Out, PipeOptions.Asynchronous))
            {
                client.Connect(timeoutMilliseconds);
                using (var writer = new StreamWriter(client, new UTF8Encoding(false), 1024, true))
                {
                    writer.WriteLine(payload);
                    writer.Flush();
                }
            }
            return true;
        });
    }
}
'@
}

function Get-BlockwrightSupervisorIdentity {
    param([Parameter(Mandatory = $true)][string]$InstallRoot)
    $normalizedRoot = [System.IO.Path]::GetFullPath($InstallRoot).TrimEnd('\').Replace('\', '/').ToLowerInvariant()
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        $digest = $hasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($normalizedRoot))
    } finally {
        $hasher.Dispose()
    }
    $key = (-join ($digest | ForEach-Object { $_.ToString("x2") })).Substring(0, 24)
    $sessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
    return [pscustomobject]@{
        Key = $key
        MutexName = "Local\Blockwright.ControlCenter.$key"
        PipeName = "blockwright-control-$key-s$sessionId"
    }
}

function Protect-BlockwrightLogText {
    param([string]$Text)
    if ($null -eq $Text) { return "" }
    $value = $Text
    foreach ($item in @(
        @($ResolvedPluginRoot, "%BLOCKWRIGHT_INSTALL%"),
        @($script:StateRoot, "%BLOCKWRIGHT_STATE%"),
        @($env:USERPROFILE, "%USERPROFILE%")
    )) {
        if (-not [string]::IsNullOrWhiteSpace([string]$item[0])) {
            $value = $value -replace [regex]::Escape([string]$item[0]), [string]$item[1]
        }
    }
    if (-not [string]::IsNullOrWhiteSpace($env:USERNAME)) {
        $value = $value -replace [regex]::Escape($env:USERNAME), "%USERNAME%"
    }
    $tokenVariable = Get-Variable -Name LocalMcpToken -Scope Script -ErrorAction SilentlyContinue
    if ($null -ne $tokenVariable -and -not [string]::IsNullOrWhiteSpace([string]$tokenVariable.Value)) {
        $value = $value -replace [regex]::Escape([string]$tokenVariable.Value), "%REDACTED_TOKEN%"
    }
    $value = $value -replace '(?i)(authorization\s*:\s*bearer\s+)[^\s"'']+', '$1%REDACTED_TOKEN%'
    $value = $value -replace '(?i)(api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|secret|password)(\s*[=:]\s*)[^\s,;"'']+', '$1$2%REDACTED_SECRET%'
    $value = $value -replace '(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}(?![A-Za-z0-9_-])', '%REDACTED_JWT%'
    $value = $value -replace '(?i)([?&](?:token|key|secret|signature|sig)=)[^&\s]+', '$1%REDACTED_SECRET%'
    if ($value.Length -gt 32768) { $value = $value.Substring(0, 32765) + "..." }
    return $value
}

function Write-BlockwrightPersistentLogLine {
    param(
        [Parameter(Mandatory = $true)][string]$Line,
        [string]$Path = $script:PersistentLogPath,
        [int]$MaximumBytes = $script:PersistentLogMaximumBytes,
        [int]$ArchiveCount = $script:PersistentLogArchiveCount
    )
    $resolvedPath = [System.IO.Path]::GetFullPath($Path)
    $parent = Split-Path -Parent $resolvedPath
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) { $null = New-Item -ItemType Directory -Path $parent -Force }
    $safeLine = Protect-BlockwrightLogText -Text $Line
    $encodedLength = [System.Text.Encoding]::UTF8.GetByteCount($safeLine + [Environment]::NewLine)
    if ($MaximumBytes -lt 1024 -or $ArchiveCount -lt 1) { throw "Persistent log rotation limits are invalid." }
    $existingLength = if (Test-Path -LiteralPath $resolvedPath -PathType Leaf) { (Get-Item -LiteralPath $resolvedPath).Length } else { 0 }
    if ($existingLength -gt 0 -and ($existingLength + $encodedLength) -gt $MaximumBytes) {
        $oldest = "$resolvedPath.$ArchiveCount"
        if (Test-Path -LiteralPath $oldest -PathType Leaf) { Remove-Item -LiteralPath $oldest -Force }
        for ($index = $ArchiveCount - 1; $index -ge 1; $index--) {
            $source = "$resolvedPath.$index"
            if (Test-Path -LiteralPath $source -PathType Leaf) { Move-Item -LiteralPath $source -Destination "$resolvedPath.$($index + 1)" -Force }
        }
        Move-Item -LiteralPath $resolvedPath -Destination "$resolvedPath.1" -Force
    }
    [System.IO.File]::AppendAllText($resolvedPath, ($safeLine + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
}

function Get-BlockwrightCrashRestartDecision {
    param(
        [datetime[]]$History,
        [datetime]$Now = (Get-Date),
        [ValidateRange(1, 20)][int]$Limit = 3,
        [ValidateRange(30, 3600)][int]$WindowSeconds = 300
    )
    $cutoff = $Now.AddSeconds(-$WindowSeconds)
    $recent = @($History | Where-Object { $_ -ge $cutoff -and $_ -le $Now })
    return [pscustomobject]@{ Allowed = ($recent.Count -lt $Limit); Recent = $recent; Attempts = $recent.Count; Limit = $Limit; WindowSeconds = $WindowSeconds }
}

function Start-BlockwrightActivationListener {
    param([Parameter(Mandatory = $true)][string]$PipeName)
    Stop-BlockwrightActivationListener
    $script:ActivationPipe = [System.IO.Pipes.NamedPipeServerStream]::new(
        $PipeName,
        [System.IO.Pipes.PipeDirection]::In,
        1,
        [System.IO.Pipes.PipeTransmissionMode]::Byte,
        [System.IO.Pipes.PipeOptions]::Asynchronous
    )
    $script:ActivationWaitTask = $script:ActivationPipe.WaitForConnectionAsync()
}

function Stop-BlockwrightActivationListener {
    if ($null -ne $script:ActivationReader) { try { $script:ActivationReader.Dispose() } catch {} }
    if ($null -ne $script:ActivationPipe) { try { $script:ActivationPipe.Dispose() } catch {} }
    $script:ActivationReader = $null
    $script:ActivationPipe = $null
    $script:ActivationWaitTask = $null
    $script:ActivationReadTask = $null
    $script:ActivationConnectedAt = $null
}

function Start-BlockwrightActivationSend {
    param(
        [Parameter(Mandatory = $true)][string]$PipeName,
        [ValidateSet("activate", "new-build", "settings", "diagnostics", "open-schematic")][string]$Action = "activate",
        [string]$SchematicPath
    )
    if ($Action -ceq "open-schematic" -and [string]::IsNullOrWhiteSpace($SchematicPath)) {
        throw "An open-schematic activation requires a schematic path."
    }
    $payload = [ordered]@{ schemaVersion = 1; action = $Action }
    if ($Action -ceq "open-schematic") { $payload.schematicPath = $SchematicPath }
    $serialized = $payload | ConvertTo-Json -Compress
    if ($serialized.Length -gt 32768) { throw "The activation message is too large." }
    return [BlockwrightActivationClient]::SendAsync($PipeName, $serialized, 500)
}

function Send-BlockwrightActivation {
    param(
        [Parameter(Mandatory = $true)][string]$PipeName,
        [ValidateSet("activate", "new-build", "settings", "diagnostics", "open-schematic")][string]$Action = "activate",
        [string]$SchematicPath
    )
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        try {
            $sendTask = Start-BlockwrightActivationSend -PipeName $PipeName -Action $Action -SchematicPath $SchematicPath
            return [bool]$sendTask.GetAwaiter().GetResult()
        } catch {
            if ($attempt -lt 5) { Start-Sleep -Milliseconds 150 }
        }
    }
    return $false
}

function Receive-BlockwrightActivationMessage {
    param([Parameter(Mandatory = $true)][string]$PipeName)
    if ($null -eq $script:ActivationPipe) { Start-BlockwrightActivationListener -PipeName $PipeName; return $null }
    if ($null -eq $script:ActivationReadTask) {
        if ($null -eq $script:ActivationWaitTask -or -not $script:ActivationWaitTask.IsCompleted) { return $null }
        try { $null = $script:ActivationWaitTask.GetAwaiter().GetResult() } catch { Start-BlockwrightActivationListener -PipeName $PipeName; return $null }
        $script:ActivationReader = [System.IO.StreamReader]::new($script:ActivationPipe, [System.Text.Encoding]::UTF8, $true, 1024, $true)
        $script:ActivationReadTask = $script:ActivationReader.ReadLineAsync()
        $script:ActivationConnectedAt = Get-Date
        return $null
    }
    if (-not $script:ActivationReadTask.IsCompleted) {
        if ($null -ne $script:ActivationConnectedAt -and ((Get-Date) - $script:ActivationConnectedAt).TotalSeconds -gt 3) {
            Start-BlockwrightActivationListener -PipeName $PipeName
        }
        return $null
    }
    try {
        $message = [string]$script:ActivationReadTask.GetAwaiter().GetResult()
    } catch {
        $message = $null
    }
    Start-BlockwrightActivationListener -PipeName $PipeName
    if ([string]::IsNullOrWhiteSpace($message) -or $message.Length -gt 32768) { return $null }
    return $message
}

function Quote-NativeArgument {
    param([Parameter(Mandatory = $true)][string]$Value)
    return '"' + $Value.Replace('"', '\"') + '"'
}

function New-LocalMcpToken {
    $bytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    } finally {
        $generator.Dispose()
    }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-NodeExecutable {
    $privateNode = Get-BlockwrightPrivateNode -InstallRoot $ResolvedPluginRoot
    if ($null -ne $privateNode) { return $privateNode }
    if (Test-Path -LiteralPath (Join-Path $ResolvedPluginRoot "release-manifest.json") -PathType Leaf) { return $null }
    $command = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $command) {
        $command = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    }
    if ($null -eq $command) { return $null }
    if (-not [string]::IsNullOrWhiteSpace($command.Path)) { return $command.Path }
    return $command.Source
}

function Get-ExpectedAppVersion {
    $manifestPath = Join-Path $ResolvedPluginRoot "app\package.json"
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { return $null }
    try {
        $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
        return [string]$manifest.version
    } catch {
        return $null
    }
}

function Get-NpmExecutable {
    $privateNpm = Get-BlockwrightPrivateNpm -InstallRoot $ResolvedPluginRoot
    if ($null -ne $privateNpm) { return $privateNpm }
    if (Test-Path -LiteralPath (Join-Path $ResolvedPluginRoot "release-manifest.json") -PathType Leaf) { return $null }
    $nodePath = Get-NodeExecutable
    if ($null -ne $nodePath) {
        $siblingNpm = Join-Path (Split-Path -Parent $nodePath) "npm.cmd"
        if (Test-Path -LiteralPath $siblingNpm -PathType Leaf) { return $siblingNpm }
    }
    $command = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $command) { return $null }
    if (-not [string]::IsNullOrWhiteSpace($command.Path)) { return $command.Path }
    return $command.Source
}

function Get-ServerEntryPath {
    $preferredEntry = Join-Path $ResolvedPluginRoot "app\dist\__entry.js"
    if (Test-Path -LiteralPath $preferredEntry -PathType Leaf) { return $preferredEntry }
    $fallbackEntry = Join-Path $ResolvedPluginRoot "app\dist\server.js"
    if (Test-Path -LiteralPath $fallbackEntry -PathType Leaf) { return $fallbackEntry }
    return $null
}

function Get-RuntimeDependencyStatus {
    $appRoot = Join-Path $ResolvedPluginRoot "app"
    $manifestPath = Join-Path $appRoot "package.json"
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        return [pscustomobject]@{ Valid = $false; Message = "The packaged runtime manifest is missing."; Missing = @("app/package.json"); NpmExitCode = $null }
    }
    try {
        $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    } catch {
        return [pscustomobject]@{ Valid = $false; Message = "The packaged runtime manifest is invalid JSON: $($_.Exception.Message)"; Missing = @(); NpmExitCode = $null }
    }

    $dependencyNames = @()
    if ($null -ne $manifest.dependencies) {
        $dependencyNames = @($manifest.dependencies.PSObject.Properties | ForEach-Object { [string]$_.Name } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }
    $missingDependencies = @()
    foreach ($dependencyName in $dependencyNames) {
        $dependencyPath = Join-Path $appRoot "node_modules"
        foreach ($segment in ([string]$dependencyName).Split('/')) {
            if (-not [string]::IsNullOrWhiteSpace($segment)) { $dependencyPath = Join-Path $dependencyPath $segment }
        }
        $dependencyManifest = Join-Path $dependencyPath "package.json"
        if (-not (Test-Path -LiteralPath $dependencyManifest -PathType Leaf)) { $missingDependencies += [string]$dependencyName }
    }
    if ($missingDependencies.Count -gt 0) {
        return [pscustomobject]@{
            Valid = $false
            Message = "Missing direct runtime dependencies: $($missingDependencies -join ', ')."
            Missing = $missingDependencies
            NpmExitCode = $null
        }
    }

    $npmPath = Get-NpmExecutable
    if ($null -eq $npmPath) {
        return [pscustomobject]@{ Valid = $false; Message = "npm.cmd was not found beside Node.js or on PATH."; Missing = @(); NpmExitCode = $null }
    }

    $npmOutput = @()
    $npmExitCode = 1
    $previousNpmCache = [Environment]::GetEnvironmentVariable("NPM_CONFIG_CACHE", [EnvironmentVariableTarget]::Process)
    $previousNpmUpdateNotifier = [Environment]::GetEnvironmentVariable("NPM_CONFIG_UPDATE_NOTIFIER", [EnvironmentVariableTarget]::Process)
    $previousErrorActionPreference = $ErrorActionPreference
    Push-Location $appRoot
    try {
        $env:NPM_CONFIG_CACHE = Join-Path $script:StateRoot "npm-cache"
        $env:NPM_CONFIG_UPDATE_NOTIFIER = "false"
        $ErrorActionPreference = "Continue"
        $npmOutput = @(& $npmPath ls --omit=dev --depth=0 --json 2>&1)
        $npmExitCode = $LASTEXITCODE
    } finally {
        try {
            Pop-Location
        } finally {
            try {
                [Environment]::SetEnvironmentVariable("NPM_CONFIG_CACHE", $previousNpmCache, [EnvironmentVariableTarget]::Process)
            } finally {
                try {
                    [Environment]::SetEnvironmentVariable("NPM_CONFIG_UPDATE_NOTIFIER", $previousNpmUpdateNotifier, [EnvironmentVariableTarget]::Process)
                } finally {
                    $ErrorActionPreference = $previousErrorActionPreference
                }
            }
        }
    }
    if ($npmExitCode -ne 0) {
        $tail = @($npmOutput | ForEach-Object { [string]$_ } | Select-Object -Last 4) -join " "
        if ($tail.Length -gt 360) { $tail = $tail.Substring(0, 357) + "..." }
        return [pscustomobject]@{ Valid = $false; Message = "npm ls rejected the packaged dependency tree (exit $npmExitCode). $tail"; Missing = @(); NpmExitCode = $npmExitCode }
    }

    return [pscustomobject]@{
        Valid = $true
        Message = "$($dependencyNames.Count) direct runtime dependencies are present and npm ls accepted the tree."
        Missing = @()
        NpmExitCode = 0
    }
}

function Get-FirstPropertyValue {
    param(
        [object]$Object,
        [string[]]$Names
    )
    if ($null -eq $Object) { return $null }
    foreach ($name in $Names) {
        $property = $Object.PSObject.Properties[$name]
        if ($null -ne $property -and $null -ne $property.Value) {
            return $property.Value
        }
    }
    return $null
}

function ConvertTo-DisplayStatus {
    param([object]$Value)
    if ($Value -is [bool]) {
        if ($Value) { return "PASS" }
        return "FAIL"
    }
    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) { return "INFO" }
    switch -Regex ($text.Trim().ToLowerInvariant()) {
        '^(pass|passed|ok|good|healthy|success|ready)$' { return "PASS" }
        '^(warn|warning|degraded|outdated|missing_optional)$' { return "WARN" }
        '^(fail|failed|error|fatal|invalid|missing|blocked|unhealthy)$' { return "FAIL" }
        default { return $text.Trim().ToUpperInvariant() }
    }
}

function New-FallbackDiagnosticResult {
    param([string]$Reason)
    $nodePath = Get-NodeExecutable
    $entryPath = Get-ServerEntryPath
    $helperPath = Join-Path $ResolvedPluginRoot "scripts\diagnose.mjs"
    $checks = @()
    $checks += [pscustomobject]@{
        Status = if ($null -ne $nodePath) { "PASS" } else { "FAIL" }
        Area = "Runtime"
        Name = "Node.js executable"
        Message = if ($null -ne $nodePath) { $nodePath } else { "The packaged private Node.js runtime is missing." }
        Detail = "Installed and portable releases require runtime/node/node.exe and never fall back to machine-wide Node.js."
    }
    $checks += [pscustomobject]@{
        Status = if ($null -ne $entryPath) { "PASS" } else { "FAIL" }
        Area = "Files"
        Name = "Production server entry"
        Message = if ($null -ne $entryPath) { $entryPath } else { "app/dist/__entry.js and app/dist/server.js are missing." }
        Detail = "The control center prefers the manifest-priming __entry.js build output."
    }
    $checks += [pscustomobject]@{
        Status = "FAIL"
        Area = "Diagnostics"
        Name = "Diagnostic engine"
        Message = $Reason
        Detail = $helperPath
    }
    $passCount = @($checks | Where-Object { $_.Status -eq "PASS" }).Count
    $failCount = @($checks | Where-Object { $_.Status -eq "FAIL" }).Count
    return [pscustomobject]@{
        Raw = $null
        Checks = $checks
        Counts = [pscustomobject]@{ Pass = $passCount; Warn = 0; Fail = $failCount; Info = 0 }
        Status = "FAIL"
        ExitCode = 1
        StandardError = $Reason
    }
}

function ConvertTo-DisplayDiagnostics {
    param(
        [object]$Raw,
        [int]$EngineExitCode,
        [string]$StandardError
    )

    $sourceChecks = $null
    if ($Raw -is [System.Array]) {
        $sourceChecks = $Raw
    } else {
        $sourceChecks = Get-FirstPropertyValue -Object $Raw -Names @("checks", "results", "diagnostics", "items")
    }

    $displayChecks = @()
    if ($null -ne $sourceChecks) {
        foreach ($item in @($sourceChecks)) {
            $statusValue = Get-FirstPropertyValue -Object $item -Names @("status", "level", "severity", "ok", "passed")
            $areaValue = Get-FirstPropertyValue -Object $item -Names @("area", "category", "group", "section")
            $nameValue = Get-FirstPropertyValue -Object $item -Names @("name", "label", "id", "check")
            $messageValue = Get-FirstPropertyValue -Object $item -Names @("message", "summary", "result", "value")
            $detailValue = Get-FirstPropertyValue -Object $item -Names @("detail", "details", "path", "expected", "recommendation")

            if ($detailValue -isnot [string] -and $null -ne $detailValue) {
                $detailValue = $detailValue | ConvertTo-Json -Depth 8 -Compress
            }
            if ([string]::IsNullOrWhiteSpace([string]$messageValue)) {
                $messageValue = [string]$detailValue
            }
            if ([string]::IsNullOrWhiteSpace([string]$nameValue)) {
                $nameValue = "Diagnostic check"
            }
            if ([string]::IsNullOrWhiteSpace([string]$areaValue)) {
                $areaValue = "Environment"
            }

            $displayChecks += [pscustomobject]@{
                Status = ConvertTo-DisplayStatus $statusValue
                Area = [string]$areaValue
                Name = [string]$nameValue
                Message = [string]$messageValue
                Detail = [string]$detailValue
            }
        }
    }

    if ($displayChecks.Count -eq 0) {
        $summaryValue = Get-FirstPropertyValue -Object $Raw -Names @("summary", "message", "status")
        if ($summaryValue -isnot [string] -and $null -ne $summaryValue) {
            $summaryValue = $summaryValue | ConvertTo-Json -Depth 8 -Compress
        }
        $displayChecks = @([pscustomobject]@{
            Status = if ($EngineExitCode -eq 0) { "PASS" } else { "FAIL" }
            Area = "Diagnostics"
            Name = "Environment summary"
            Message = [string]$summaryValue
            Detail = $StandardError
        })
    }

    $passCount = @($displayChecks | Where-Object { $_.Status -eq "PASS" }).Count
    $warnCount = @($displayChecks | Where-Object { $_.Status -eq "WARN" }).Count
    $failCount = @($displayChecks | Where-Object { $_.Status -eq "FAIL" }).Count
    $infoCount = $displayChecks.Count - $passCount - $warnCount - $failCount
    $overallStatus = if ($failCount -gt 0) { "FAIL" } elseif ($warnCount -gt 0) { "WARN" } else { "PASS" }

    return [pscustomobject]@{
        Raw = $Raw
        Checks = $displayChecks
        Counts = [pscustomobject]@{ Pass = $passCount; Warn = $warnCount; Fail = $failCount; Info = $infoCount }
        Status = $overallStatus
        ExitCode = $EngineExitCode
        StandardError = $StandardError
    }
}

function Invoke-BlockwrightDiagnostics {
    $nodePath = Get-NodeExecutable
    if ($null -eq $nodePath) {
        return New-FallbackDiagnosticResult -Reason "Node.js was not found, so the diagnostic engine could not run."
    }

    $helperPath = Join-Path $ResolvedPluginRoot "scripts\diagnose.mjs"
    if (-not (Test-Path -LiteralPath $helperPath -PathType Leaf)) {
        return New-FallbackDiagnosticResult -Reason "scripts\diagnose.mjs is missing from this Blockwright package."
    }

    try {
        $startInfo = New-Object System.Diagnostics.ProcessStartInfo
        $startInfo.FileName = $nodePath
        $startInfo.Arguments = "$(Quote-NativeArgument $helperPath) --json"
        $startInfo.WorkingDirectory = $ResolvedPluginRoot
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        $startInfo.EnvironmentVariables["NPM_CONFIG_CACHE"] = Join-Path $script:StateRoot "npm-cache"
        $startInfo.EnvironmentVariables["NPM_CONFIG_UPDATE_NOTIFIER"] = "false"

        $diagnosticProcess = New-Object System.Diagnostics.Process
        $diagnosticProcess.StartInfo = $startInfo
        if (-not $diagnosticProcess.Start()) {
            return New-FallbackDiagnosticResult -Reason "The diagnostic engine did not start."
        }
        $standardOutput = $diagnosticProcess.StandardOutput.ReadToEnd()
        $standardError = $diagnosticProcess.StandardError.ReadToEnd()
        $diagnosticProcess.WaitForExit()
        $engineExitCode = $diagnosticProcess.ExitCode
        $diagnosticProcess.Dispose()

        if ([string]::IsNullOrWhiteSpace($standardOutput)) {
            return New-FallbackDiagnosticResult -Reason "The diagnostic engine returned no JSON. $standardError"
        }
        $raw = $standardOutput | ConvertFrom-Json
        return ConvertTo-DisplayDiagnostics -Raw $raw -EngineExitCode $engineExitCode -StandardError $standardError.Trim()
    } catch {
        return New-FallbackDiagnosticResult -Reason "The diagnostic engine failed: $($_.Exception.Message)"
    }
}

function Write-DiagnosticResult {
    param([object]$Result)
    $output = [ordered]@{
        controllerVersion = $ControllerVersion
        generatedAt = (Get-Date).ToUniversalTime().ToString("o")
        pluginRoot = $ResolvedPluginRoot
        status = $Result.Status
        counts = $Result.Counts
        engineExitCode = $Result.ExitCode
        checks = $Result.Checks
        raw = $Result.Raw
    }
    if ($Json) {
        $output | ConvertTo-Json -Depth 20
    } else {
        Write-Output "Blockwright Control Center diagnostics"
        Write-Output "Root: $ResolvedPluginRoot"
        Write-Output "Status: $($Result.Status) | pass $($Result.Counts.Pass), warn $($Result.Counts.Warn), fail $($Result.Counts.Fail)"
        foreach ($check in $Result.Checks) {
            Write-Output ("[{0}] {1} / {2}: {3}" -f $check.Status, $check.Area, $check.Name, $check.Message)
        }
    }
}

if ($Diagnostics) {
    $diagnosticResult = Invoke-BlockwrightDiagnostics
    Write-DiagnosticResult -Result $diagnosticResult
    if ($diagnosticResult.Counts.Fail -gt 0) { exit 1 }
    exit 0
}

if ($env:OS -ne "Windows_NT") {
    throw "The graphical Blockwright Control Center requires Windows. Use -Diagnostics for a non-GUI environment check."
}
Add-Type -AssemblyName System.Net.Http

$script:SupervisorIdentity = Get-BlockwrightSupervisorIdentity -InstallRoot $ResolvedPluginRoot
if ($SupervisorSelfTest) {
    Write-Verbose "Starting supervisor identity self-test."
    $sameIdentity = Get-BlockwrightSupervisorIdentity -InstallRoot $ResolvedPluginRoot
    $differentIdentity = Get-BlockwrightSupervisorIdentity -InstallRoot (Join-Path $ResolvedPluginRoot "different-install")
    if ($sameIdentity.Key -cne $script:SupervisorIdentity.Key -or $differentIdentity.Key -ceq $script:SupervisorIdentity.Key) {
        throw "Install-root supervisor identity self-test failed."
    }
    $previousToken = $script:LocalMcpToken
    $script:LocalMcpToken = "supervisor-self-test-token-value"
    $redacted = Protect-BlockwrightLogText -Text "user=$env:USERNAME root=$ResolvedPluginRoot Authorization: Bearer do-not-log api_key=hidden token=$script:LocalMcpToken"
    if ($redacted -match 'do-not-log|api_key=hidden|supervisor-self-test-token-value' -or
        (-not [string]::IsNullOrWhiteSpace($env:USERNAME) -and $redacted -match [regex]::Escape($env:USERNAME))) {
        throw "Persistent log redaction self-test failed."
    }
    $script:LocalMcpToken = $previousToken
    $restartAllowed = Get-BlockwrightCrashRestartDecision -History @((Get-Date).AddSeconds(-10), (Get-Date).AddSeconds(-5)) -Limit 3 -WindowSeconds 300
    $restartBlocked = Get-BlockwrightCrashRestartDecision -History @((Get-Date).AddSeconds(-20), (Get-Date).AddSeconds(-10), (Get-Date).AddSeconds(-5)) -Limit 3 -WindowSeconds 300
    if (-not $restartAllowed.Allowed -or $restartBlocked.Allowed) { throw "Bounded crash-restart policy self-test failed." }
    Write-Verbose "Identity, redaction, and restart-budget self-tests passed."

    $selfTestRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("Blockwright Supervisor SelfTest " + [guid]::NewGuid().ToString("N"))
    $selfTestLog = Join-Path $selfTestRoot "logs\control-center.log"
    try {
        for ($index = 0; $index -lt 16; $index++) {
            Write-BlockwrightPersistentLogLine -Line ("line-$index Authorization: Bearer rotate-secret " + ("x" * 120)) -Path $selfTestLog -MaximumBytes 1024 -ArchiveCount 2
        }
        if (-not (Test-Path -LiteralPath $selfTestLog -PathType Leaf) -or -not (Test-Path -LiteralPath "$selfTestLog.1" -PathType Leaf)) {
            throw "Persistent log rotation self-test did not produce an active log and archive."
        }
        $combinedLog = @($selfTestLog, "$selfTestLog.1", "$selfTestLog.2") | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | ForEach-Object { Get-Content -Raw -LiteralPath $_ }
        if (($combinedLog -join "`n") -match 'rotate-secret') { throw "Persistent log rotation self-test retained a bearer token." }
        Write-Verbose "Persistent log rotation self-test passed."

        Start-BlockwrightActivationListener -PipeName $script:SupervisorIdentity.PipeName
        Write-Verbose "Activation listener started."
        $activationSendTask = Start-BlockwrightActivationSend -PipeName $script:SupervisorIdentity.PipeName -Action "open-schematic" -SchematicPath "C:\fixture\sample.schem"
        $activationMessage = $null
        $activationDeadline = (Get-Date).AddSeconds(3)
        while ($null -eq $activationMessage -and (Get-Date) -lt $activationDeadline) {
            $activationMessage = Receive-BlockwrightActivationMessage -PipeName $script:SupervisorIdentity.PipeName
            if ($null -eq $activationMessage) { Start-Sleep -Milliseconds 25 }
        }
        if ([string]::IsNullOrWhiteSpace($activationMessage)) { throw "Activation channel self-test timed out." }
        if (-not [bool]$activationSendTask.GetAwaiter().GetResult()) { throw "Activation channel self-test could not send." }
        Write-Verbose "Activation message received."
        $activation = $activationMessage | ConvertFrom-Json
        if ([int]$activation.schemaVersion -ne 1 -or [string]$activation.action -cne "open-schematic" -or [string]$activation.schematicPath -cne "C:\fixture\sample.schem") {
            throw "Activation channel self-test received an unexpected payload."
        }
        $jumpActions = @(Get-BlockwrightJumpActionDefinitions)
        $jumpMapping = @($jumpActions | ForEach-Object { "$($_.NativeArgument)>$($_.FallbackArgument)" }) -join ";"
        if ($jumpActions.Count -ne 4 -or $jumpMapping -cne "--open>-Open;--new-build>-NewBuild;--settings>-OpenSettings;--diagnostics>-OpenDiagnostics") {
            throw "Jump List launcher-contract self-test failed."
        }
        $launchSpec = Get-BlockwrightJumpLaunchSpec -InstallRoot $ResolvedPluginRoot -Action "diagnostics"
        $launchSpecValid = if ($launchSpec.Native) {
            [string]$launchSpec.ApplicationPath -match '(?i)Blockwright\.exe$' -and [string]$launchSpec.Arguments -ceq '--diagnostics'
        } else {
            [string]$launchSpec.ApplicationPath -match '(?i)wscript\.exe$' -and [string]$launchSpec.Arguments -match '(?i)-OpenDiagnostics$'
        }
        if (-not $launchSpecValid) {
            throw "Jump List safe-fallback self-test failed."
        }
        $knownTaskStates = @{}
        $baselineEvents = @(Get-BlockwrightTaskNotificationEvents -Tasks @(
            [pscustomobject]@{ id = "task_baseline01"; state = "completed" },
            [pscustomobject]@{ id = "task_running001"; state = "compiling" }
        ) -KnownStates $knownTaskStates -EstablishBaseline)
        $transitionEvents = @(Get-BlockwrightTaskNotificationEvents -Tasks @(
            [pscustomobject]@{ id = "task_baseline01"; state = "completed" },
            [pscustomobject]@{ id = "task_running001"; state = "completed" },
            [pscustomobject]@{ id = "task_failed0001"; state = "failed" }
        ) -KnownStates $knownTaskStates)
        if ($baselineEvents.Count -ne 0 -or $transitionEvents.Count -ne 2 -or
            @($transitionEvents | ForEach-Object { $_.Kind } | Sort-Object) -join "," -cne "completed,failed") {
            throw "Task-notification transition self-test failed."
        }
    } finally {
        Write-Verbose "Cleaning up supervisor self-test."
        Stop-BlockwrightActivationListener
        if (Test-Path -LiteralPath $selfTestRoot -PathType Container) { Remove-Item -LiteralPath $selfTestRoot -Recurse -Force }
    }
    [pscustomobject]@{
        Valid = $true
        ControllerVersion = $ControllerVersion
        InstallIdentity = $script:SupervisorIdentity.Key
        Redaction = $true
        Rotation = $true
        RestartBudget = $true
        ActivationChannel = $true
        AppUserModelId = $script:AppUserModelId
        JumpListActions = $jumpActions.Count
        SafeLauncherFallback = (-not [bool]$launchSpec.Native)
        TaskNotifications = $true
    } | ConvertTo-Json -Compress
    exit 0
}

$interactiveSupervisor = -not $ValidateUi -and -not $SmokeTest -and [string]::IsNullOrWhiteSpace($CaptureUiPath)
if ($interactiveSupervisor) {
    try { Set-BlockwrightAppUserModelId } catch { throw "Blockwright could not establish its stable Windows application identity." }
    $createdNew = $false
    $script:SupervisorMutex = [System.Threading.Mutex]::new($true, $script:SupervisorIdentity.MutexName, [ref]$createdNew)
    if (-not $createdNew) {
        $activationPath = if ($script:RequestedActivation.Action -cne "open-schematic") { $null } else { [System.IO.Path]::GetFullPath($OpenSchematic) }
        # A login-started background instance must never pull an already-running UI to the foreground.
        $activated = if ($StartMinimized -and -not $script:RequestedActivation.Explicit) { $true } else { Send-BlockwrightActivation -PipeName $script:SupervisorIdentity.PipeName -Action $script:RequestedActivation.Action -SchematicPath $activationPath }
        $script:SupervisorMutex.Dispose()
        $script:SupervisorMutex = $null
        if (-not $activated) { throw "Blockwright is already running, but its activation channel did not respond." }
        exit 0
    }
    $script:SupervisorMutexOwned = $true
    Start-BlockwrightActivationListener -PipeName $script:SupervisorIdentity.PipeName
}

if (-not ("BlockwrightProcessLogPump" -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Diagnostics;

public sealed class BlockwrightProcessLogPump
{
    private readonly ConcurrentQueue<string> queue = new ConcurrentQueue<string>();
    private readonly string label;
    private readonly int maxLines;
    private int queuedLines;
    private int droppedLines;

    public BlockwrightProcessLogPump(string label, int maxLines)
    {
        this.label = label;
        this.maxLines = Math.Max(100, maxLines);
    }

    public void Attach(Process process)
    {
        process.OutputDataReceived += OnOutput;
        process.ErrorDataReceived += OnError;
    }

    private void OnOutput(object sender, DataReceivedEventArgs args)
    {
        Enqueue("out", args.Data);
    }

    private void OnError(object sender, DataReceivedEventArgs args)
    {
        Enqueue("err", args.Data);
    }

    private void Enqueue(string stream, string text)
    {
        if (text == null) return;
        if (text.Length > 16384) text = text.Substring(0, 16381) + "...";
        queue.Enqueue(String.Format("[{0:HH:mm:ss.fff}] [{1}/{2}] {3}", DateTime.Now, label, stream, text));
        int count = System.Threading.Interlocked.Increment(ref queuedLines);
        while (count > maxLines)
        {
            string discarded;
            if (!queue.TryDequeue(out discarded)) break;
            System.Threading.Interlocked.Decrement(ref queuedLines);
            System.Threading.Interlocked.Increment(ref droppedLines);
            count = System.Threading.Volatile.Read(ref queuedLines);
        }
    }

    public bool TryDequeue(out string line)
    {
        if (!queue.TryDequeue(out line)) return false;
        System.Threading.Interlocked.Decrement(ref queuedLines);
        return true;
    }

    public int TakeDroppedCount()
    {
        return System.Threading.Interlocked.Exchange(ref droppedLines, 0);
    }
}
'@
}

$script:ServerHandle = $null
$script:MaintenanceHandle = $null
$script:UpdateHandle = $null
$script:UpdateMode = $null
$script:ServerStartedAt = $null
$script:ServerBaseUrl = $null
$script:ServerHttpStatus = $null
$script:ServerReady = $false
$script:ServerIdentityVerified = $false
$script:ServerHealthDetail = $null
$script:ServerIdentityDetail = $null
$script:ServerReadinessDetail = $null
$script:LastExitCode = $null
$script:LastNetworkScan = [datetime]::MinValue
$script:LastHealthScan = [datetime]::MinValue
$script:LastDiagnosticRefresh = [datetime]::MinValue
$script:LastProcessTreeScan = [datetime]::MinValue
$script:CurrentDiagnostics = $null
$script:UiReady = $false
$script:StartAfterMaintenance = $false
$script:StartAfterMaintenanceCrashRecovery = $false
$script:AutomaticStartFailure = $null
$script:ManagedToken = [guid]::NewGuid().ToString("N")
$script:ExpectedServerStop = $false
$script:LocalMcpToken = $null
$script:CrashRestartHistory = New-Object 'System.Collections.Generic.List[datetime]'
$script:CrashRestartDueAt = $null
$script:CrashRestartLimit = 3
$script:CrashRestartWindowSeconds = 300
$script:CrashRestartDelaySeconds = 3
$script:AutoRestartEligible = $false
$script:CrashRestartPendingAttempt = $null
$script:ExitRequested = $false
$script:HideToTrayNoticeShown = $false
$script:OpenWorkbenchPending = $false
$script:NotifyIcon = $null
$script:TrayMenu = $null
$script:TrayIconResource = $null
$script:TrayItems = @{}
$script:NotificationHistory = @{}
$script:StartupReconciliationMessage = $null
$script:ServerCrashCleanupFailureNotified = $false
$script:TaskPollIntervalSeconds = 5
$script:TaskPollTimeoutMilliseconds = 1500
$script:TaskPollMaximumResponseBytes = 1048576
$script:TaskPollClient = $null
$script:TaskPollRequest = $null
$script:TaskPollTask = $null
$script:TaskPollSequence = 0
$script:LastTaskPollStartedAt = [datetime]::MinValue
$script:LastTaskPollFailureLoggedAt = [datetime]::MinValue
$script:TaskPollBaselineEstablished = $false
$script:KnownTaskStates = @{}
$script:TaskSnapshots = @()
$script:ActiveTaskSnapshot = $null
$script:TaskAttentionState = $null
$script:TaskAttentionUntil = $null
$script:ManagedRecordPath = Get-BlockwrightManagedRecordPath -InstallRoot $ResolvedPluginRoot -StateRoot $script:StateRoot
$script:UpdateCheckPath = Join-Path $script:StateRoot "updates\last-check.json"
$script:UpdateFailurePath = Join-Path $script:StateRoot "updates\last-failure.json"
$script:UpdateSuccessPath = Join-Path $script:StateRoot "updates\last-success.json"

function Reset-BlockwrightTaskMonitor {
    if ($null -ne $script:TaskPollClient) { try { $script:TaskPollClient.Dispose() } catch {} }
    if ($null -ne $script:TaskPollRequest) { try { $script:TaskPollRequest.Dispose() } catch {} }
    $script:TaskPollClient = $null
    $script:TaskPollRequest = $null
    $script:TaskPollTask = $null
    $script:LastTaskPollStartedAt = [datetime]::MinValue
    $script:LastTaskPollFailureLoggedAt = [datetime]::MinValue
    $script:TaskPollBaselineEstablished = $false
    $script:KnownTaskStates = @{}
    $script:TaskSnapshots = @()
    $script:ActiveTaskSnapshot = $null
    $script:TaskAttentionState = $null
    $script:TaskAttentionUntil = $null
}

function Initialize-BlockwrightTaskPollClient {
    if ($null -ne $script:TaskPollClient) { return }
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $script:TaskPollClient = [System.Net.Http.HttpClient]::new($handler, $true)
    $script:TaskPollClient.Timeout = [TimeSpan]::FromMilliseconds($script:TaskPollTimeoutMilliseconds)
    $script:TaskPollClient.MaxResponseContentBufferSize = $script:TaskPollMaximumResponseBytes
}

function Start-BlockwrightTaskPoll {
    if ($null -ne $script:TaskPollTask -or -not $script:ServerReady -or -not $script:ServerIdentityVerified -or
        [string]::IsNullOrWhiteSpace($script:ServerBaseUrl) -or [string]::IsNullOrWhiteSpace($script:LocalMcpToken)) { return }
    if (((Get-Date) - $script:LastTaskPollStartedAt).TotalSeconds -lt $script:TaskPollIntervalSeconds) { return }
    Initialize-BlockwrightTaskPollClient
    $script:TaskPollSequence++
    $requestId = "blockwright-control-center-tasks-$($script:TaskPollSequence)"
    $payloadDocument = [ordered]@{
        jsonrpc = "2.0"
        id = $requestId
        method = "tools/call"
        params = @{ name = "list_tasks"; arguments = @{} }
    }
    $payload = $payloadDocument | ConvertTo-Json -Depth 8 -Compress
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, "$($script:ServerBaseUrl.TrimEnd('/'))/mcp")
    $request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $script:LocalMcpToken)
    $request.Headers.Accept.Add([System.Net.Http.Headers.MediaTypeWithQualityHeaderValue]::new("application/json"))
    $request.Headers.Accept.Add([System.Net.Http.Headers.MediaTypeWithQualityHeaderValue]::new("text/event-stream"))
    $request.Content = [System.Net.Http.StringContent]::new($payload, [System.Text.Encoding]::UTF8, "application/json")
    $script:TaskPollRequest = $request
    $script:TaskPollRequestId = $requestId
    $script:TaskPollTask = $script:TaskPollClient.SendAsync($request)
    $script:LastTaskPollStartedAt = Get-Date
}

function Update-BlockwrightObservedTasks {
    param([object[]]$Tasks)
    $events = @(Get-BlockwrightTaskNotificationEvents -Tasks $Tasks -KnownStates $script:KnownTaskStates -EstablishBaseline:(-not $script:TaskPollBaselineEstablished))
    $script:TaskSnapshots = @($Tasks)
    $activeTasks = @($Tasks | Where-Object { [string]$_.state -notin @("completed", "cancelled", "failed", "interrupted") } | Sort-Object { [string]$_.timing.updatedAt } -Descending)
    $script:ActiveTaskSnapshot = if ($activeTasks.Count -gt 0) { $activeTasks[0] } else { $null }
    if (-not $script:TaskPollBaselineEstablished) {
        $script:TaskPollBaselineEstablished = $true
        return
    }
    foreach ($event in $events) {
        if ([string]$event.Kind -ceq "completed") {
            $script:TaskAttentionState = "completed"
            $script:TaskAttentionUntil = (Get-Date).AddSeconds(15)
            Show-BlockwrightSupervisorNotification -Key "task-completed-$([string]$event.Task.id)" -Title "Blockwright task completed" -Message "A build task finished successfully. Open Blockwright to review the result." -Level Info -ThrottleSeconds 3600
        } else {
            $script:TaskAttentionState = "failed"
            $script:TaskAttentionUntil = (Get-Date).AddSeconds(60)
            $diagnosticCode = [string]$event.Task.diagnostic.code
            if ($diagnosticCode -notmatch '^[A-Za-z0-9_-]{1,64}$') { $diagnosticCode = "TASK_FAILED" }
            Show-BlockwrightSupervisorNotification -Key "task-failed-$([string]$event.Task.id)" -Title "Blockwright task failed" -Message "A build task failed ($diagnosticCode). Open Diagnostics for safe retry guidance." -Level Error -ThrottleSeconds 3600
        }
    }
}

function Complete-BlockwrightTaskPoll {
    if ($null -eq $script:TaskPollTask -or -not $script:TaskPollTask.IsCompleted) { return }
    $pendingTask = $script:TaskPollTask
    $pendingRequest = $script:TaskPollRequest
    $expectedRequestId = $script:TaskPollRequestId
    $script:TaskPollTask = $null
    $script:TaskPollRequest = $null
    $script:TaskPollRequestId = $null
    $response = $null
    try {
        $response = $pendingTask.GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) { throw "The authenticated MCP task poll was rejected." }
        $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if ([System.Text.Encoding]::UTF8.GetByteCount($body) -gt $script:TaskPollMaximumResponseBytes) { throw "The authenticated MCP task response exceeded its limit." }
        $message = $body | ConvertFrom-Json
        if ([string]$message.jsonrpc -cne "2.0" -or [string]$message.id -cne $expectedRequestId -or $null -ne $message.PSObject.Properties["error"]) {
            throw "The authenticated MCP task response was invalid."
        }
        if ([bool]$message.result.isError -or $null -eq $message.result.structuredContent -or $null -eq $message.result.structuredContent.PSObject.Properties["tasks"]) {
            throw "The authenticated MCP task tool did not return task metadata."
        }
        Update-BlockwrightObservedTasks -Tasks @($message.result.structuredContent.tasks)
        $script:LastTaskPollFailureLoggedAt = [datetime]::MinValue
    } catch {
        if (((Get-Date) - $script:LastTaskPollFailureLoggedAt).TotalSeconds -ge 300) {
            $script:LastTaskPollFailureLoggedAt = Get-Date
            Add-ControllerLog "Authenticated task-status polling is temporarily unavailable; the Control Center will retry without exposing request details."
        }
    } finally {
        if ($null -ne $response) { try { $response.Dispose() } catch {} }
        if ($null -ne $pendingRequest) { try { $pendingRequest.Dispose() } catch {} }
    }
}

function Write-ManagedServerRecord {
    if (-not (Test-ProcessRunning $script:ServerHandle)) { return }
    $recordRoot = Split-Path -Parent $script:ManagedRecordPath
    $null = New-Item -ItemType Directory -Path $recordRoot -Force
    $record = [ordered]@{
        schemaVersion = 1
        pid = [int]$script:ServerHandle.Process.Id
        processStartUtc = $script:ServerHandle.Process.StartTime.ToUniversalTime().ToString("o")
        executable = [System.IO.Path]::GetFullPath([string]$script:ServerHandle.Process.StartInfo.FileName)
        entry = Get-ServerEntryPath
        installRoot = $ResolvedPluginRoot
        stateRoot = $script:StateRoot
        port = $Port
        controllerPid = $PID
        ownerToken = $script:ManagedToken
    }
    [System.IO.File]::WriteAllText($script:ManagedRecordPath, (($record | ConvertTo-Json -Depth 5) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
}

function Remove-ManagedServerRecord {
    if (-not (Test-Path -LiteralPath $script:ManagedRecordPath -PathType Leaf)) { return }
    try {
        $record = Get-Content -Raw -LiteralPath $script:ManagedRecordPath | ConvertFrom-Json
        if ([string]$record.ownerToken -eq $script:ManagedToken) { Remove-Item -LiteralPath $script:ManagedRecordPath -Force }
    } catch {}
}

function Remove-StaleOwnedServerRecord {
    param([Parameter(Mandatory = $true)][object]$Status)
    if ([string]$Status.Status -cne "StaleOwnedRecord" -or -not [bool]$Status.OwnedRecord) {
        throw "Only an ownership-validated stale managed-process record may be removed."
    }
    $expectedRecordPath = [System.IO.Path]::GetFullPath($script:ManagedRecordPath)
    $reportedRecordPath = [System.IO.Path]::GetFullPath([string]$Status.RecordPath)
    if (-not $reportedRecordPath.Equals($expectedRecordPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw "The stale managed-process record path is outside this controller's state location."
    }
    if (Test-Path -LiteralPath $expectedRecordPath -PathType Leaf) { Remove-Item -LiteralPath $expectedRecordPath -Force }
}

function Repair-BlockwrightManagedRecord {
    $status = Get-BlockwrightManagedProcessStatus -InstallRoot $ResolvedPluginRoot -StateRoot $script:StateRoot
    switch ([string]$status.Status) {
        "NotRunning" { return }
        "StaleOwnedRecord" {
            Remove-StaleOwnedServerRecord -Status $status
            $script:StartupReconciliationMessage = "Removed an ownership-validated stale server record for PID $($status.ProcessId). No process was stopped."
            Add-ControllerLog $script:StartupReconciliationMessage
            return
        }
        "RunningOwned" {
            Add-ControllerLog "A server from an interrupted Control Center session is still running as verified PID $($status.ProcessId). Stopping that owned process because its ephemeral access token cannot be recovered."
            $result = Stop-BlockwrightManagedProcess -InstallRoot $ResolvedPluginRoot -StateRoot $script:StateRoot -Confirm:$false
            if ([string]$result.Status -cne "Stopped") { throw "The verified prior-session Blockwright process could not be reconciled safely." }
            $script:StartupReconciliationMessage = "Stopped the verified prior-session Blockwright process because its ephemeral access token could not be recovered."
            Add-ControllerLog $script:StartupReconciliationMessage
            return
        }
        default {
            $script:StartupReconciliationMessage = "Managed-process reconciliation was blocked: $($status.Reason)"
            Add-ControllerLog $script:StartupReconciliationMessage
            return
        }
    }
}

function Assert-BlockwrightManagedRecordReady {
    $status = Get-BlockwrightManagedProcessStatus -InstallRoot $ResolvedPluginRoot -StateRoot $script:StateRoot
    if ([string]$status.Status -ceq "NotRunning") { return }
    if ([string]$status.Status -ceq "StaleOwnedRecord") {
        Remove-StaleOwnedServerRecord -Status $status
        Add-ControllerLog "Removed an ownership-validated stale server record before start. No process was stopped."
        return
    }
    throw "Blockwright cannot start while managed-process ownership is unresolved. $($status.Reason)"
}

function Write-CrashRecord {
    param(
        [object]$ExitCode,
        [string]$RestartStatus,
        [object]$RestartAttempt
    )
    $crashRoot = Join-Path $script:StateRoot "crashes"
    $null = New-Item -ItemType Directory -Path $crashRoot -Force
    $record = [ordered]@{
        schemaVersion = 1
        recordedAt = [datetimeoffset]::UtcNow.ToString("o")
        version = Get-ExpectedAppVersion
        exitCode = $ExitCode
        port = $Port
        restartStatus = $RestartStatus
        restartAttempt = $RestartAttempt
        persistentLog = $script:PersistentLogPath
        recovery = @("Open the Control Center and choose Start again.", "Run dependency repair if diagnostics report missing packages.", "Create a redacted support bundle if the crash repeats.")
    }
    $path = Join-Path $crashRoot ("server-crash-{0}.json" -f (Get-Date -Format "yyyyMMdd-HHmmssfff"))
    [System.IO.File]::WriteAllText($path, (($record | ConvertTo-Json -Depth 5) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
}

function New-CapturedProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FileName,
        [Parameter(Mandatory = $true)][string]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$Label,
        [hashtable]$EnvironmentVariables
    )

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FileName
    $startInfo.Arguments = $Arguments
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    if ($null -ne $EnvironmentVariables) {
        foreach ($key in $EnvironmentVariables.Keys) {
            $startInfo.EnvironmentVariables[[string]$key] = [string]$EnvironmentVariables[$key]
        }
    }

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    $process.EnableRaisingEvents = $true
    $pump = [BlockwrightProcessLogPump]::new($Label, 4000)
    $pump.Attach($process)
    if (-not $process.Start()) {
        $process.Dispose()
        throw "$Label did not start."
    }
    $process.BeginOutputReadLine()
    $process.BeginErrorReadLine()
    return [pscustomobject]@{ Process = $process; Pump = $pump; Label = $Label; ProcessTreeSnapshot = @() }
}

function Add-ControllerLog {
    param([string]$Message)
    $line = "[{0:o}] [control] {1}" -f [datetimeoffset]::UtcNow, (Protect-BlockwrightLogText -Text $Message)
    try {
        Write-BlockwrightPersistentLogLine -Line $line
        $script:PersistentLogFailure = $null
    } catch {
        $script:PersistentLogFailure = Protect-BlockwrightLogText -Text $_.Exception.Message
    }
    if ($script:UiReady -and $null -ne $script:LogBox) {
        $script:LogBox.AppendText($line + [Environment]::NewLine)
        $script:LogBox.ScrollToEnd()
    } else {
        Write-Verbose $line
    }
}

function Add-ProcessLogLine {
    param([string]$Line)
    $safeLine = Protect-BlockwrightLogText -Text $Line
    if ($safeLine -match '(https?://(?:127\.0\.0\.1|localhost):\d+)') {
        $script:ServerBaseUrl = $Matches[1].Replace("localhost", "127.0.0.1")
    }
    try {
        Write-BlockwrightPersistentLogLine -Line $safeLine
        $script:PersistentLogFailure = $null
    } catch {
        $script:PersistentLogFailure = Protect-BlockwrightLogText -Text $_.Exception.Message
    }
    if ($script:UiReady -and $null -ne $script:LogBox) {
        $script:LogBox.AppendText($safeLine + [Environment]::NewLine)
        if ($script:LogBox.Text.Length -gt 1200000) {
            $script:LogBox.Text = $script:LogBox.Text.Substring(400000)
            $script:LogBox.CaretIndex = $script:LogBox.Text.Length
        }
        $script:LogBox.ScrollToEnd()
    }
}

function Drain-ProcessLogs {
    param(
        [object]$Handle,
        [ValidateRange(1, 2000)][int]$MaxLines = 250
    )
    if ($null -eq $Handle) { return @() }
    $lines = New-Object 'System.Collections.Generic.List[string]'
    $droppedCount = $Handle.Pump.TakeDroppedCount()
    if ($droppedCount -gt 0) {
        $dropLine = "[{0:HH:mm:ss.fff}] [control] Log queue dropped {1} older line(s) because the producer outpaced the UI." -f (Get-Date), $droppedCount
        $lines.Add($dropLine)
        Add-ProcessLogLine -Line $dropLine
    }
    for ($drained = 0; $drained -lt $MaxLines; $drained++) {
        $line = $null
        if (-not $Handle.Pump.TryDequeue([ref]$line)) { break }
        $safeLine = Protect-BlockwrightLogText -Text $line
        $lines.Add($safeLine)
        Add-ProcessLogLine -Line $safeLine
    }
    return @($lines)
}

function Test-ProcessRunning {
    param([object]$Handle)
    if ($null -eq $Handle -or $null -eq $Handle.Process) { return $false }
    try { return -not $Handle.Process.HasExited } catch { return $false }
}

function Show-BlockwrightSupervisorNotification {
    param(
        [Parameter(Mandatory = $true)][string]$Key,
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][string]$Message,
        [ValidateSet("Info", "Warning", "Error")][string]$Level = "Info",
        [ValidateRange(5, 3600)][int]$ThrottleSeconds = 30
    )
    if ($null -eq $script:NotifyIcon -or -not $script:NotifyIcon.Visible) { return }
    $now = Get-Date
    if ($script:NotificationHistory.ContainsKey($Key) -and ($now - [datetime]$script:NotificationHistory[$Key]).TotalSeconds -lt $ThrottleSeconds) { return }
    $script:NotificationHistory[$Key] = $now
    $safeTitle = Protect-BlockwrightLogText -Text $Title
    $safeMessage = Protect-BlockwrightLogText -Text $Message
    if ($safeTitle.Length -gt 63) { $safeTitle = $safeTitle.Substring(0, 63) }
    if ($safeMessage.Length -gt 255) { $safeMessage = $safeMessage.Substring(0, 252) + "..." }
    try {
        $iconLevel = [System.Windows.Forms.ToolTipIcon]::$Level
        $script:NotifyIcon.ShowBalloonTip(5000, $safeTitle, $safeMessage, $iconLevel)
    } catch {}
}

function Get-ProcessTreeSnapshot {
    param([Parameter(Mandatory = $true)][int]$RootProcessId)
    $knownIds = New-Object 'System.Collections.Generic.List[int]'
    $knownIds.Add($RootProcessId)
    try {
        $processRows = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId -ErrorAction Stop
        $changed = $true
        while ($changed) {
            $changed = $false
            foreach ($row in $processRows) {
                $candidateId = [int]$row.ProcessId
                $candidateParentId = [int]$row.ParentProcessId
                if ($knownIds.Contains($candidateParentId) -and -not $knownIds.Contains($candidateId)) {
                    $knownIds.Add($candidateId)
                    $changed = $true
                }
            }
        }
    } catch {}

    $snapshot = @()
    foreach ($processIdValue in $knownIds) {
        $process = Get-Process -Id $processIdValue -ErrorAction SilentlyContinue
        if ($null -eq $process) { continue }
        $processStartUtc = $null
        try { $processStartUtc = $process.StartTime.ToUniversalTime().ToString("o") } catch {}
        $snapshot += [pscustomobject]@{ ProcessId = [int]$processIdValue; ProcessStartUtc = $processStartUtc }
    }
    return @($snapshot)
}

function Test-CapturedProcessIdentityRunning {
    param([Parameter(Mandatory = $true)][object]$Identity)
    $process = Get-Process -Id ([int]$Identity.ProcessId) -ErrorAction SilentlyContinue
    if ($null -eq $process) { return $false }
    if ([string]::IsNullOrWhiteSpace([string]$Identity.ProcessStartUtc)) { return $false }
    try {
        $expectedStart = [datetimeoffset]::Parse([string]$Identity.ProcessStartUtc).UtcDateTime
        $actualStart = $process.StartTime.ToUniversalTime()
        return [math]::Abs(($actualStart - $expectedStart).TotalSeconds) -le 1
    } catch {
        return $false
    }
}

function Get-RunningCapturedProcessIds {
    param([object[]]$Snapshot)
    return @($Snapshot | Where-Object { Test-CapturedProcessIdentityRunning -Identity $_ } | ForEach-Object { [int]$_.ProcessId } | Sort-Object -Unique)
}

function Test-CapturedProcessTreeRunning {
    param([object]$Handle)
    if (Test-ProcessRunning $Handle) { return $true }
    if ($null -eq $Handle) { return $false }
    $snapshotProperty = $Handle.PSObject.Properties["ProcessTreeSnapshot"]
    if ($null -eq $snapshotProperty) { return $false }
    return @(Get-RunningCapturedProcessIds -Snapshot @($snapshotProperty.Value)).Count -gt 0
}

function Update-CapturedProcessTreeSnapshot {
    param([object]$Handle)
    if (-not (Test-ProcessRunning $Handle) -or ((Get-Date) - $script:LastProcessTreeScan).TotalSeconds -lt 2) { return }
    $script:LastProcessTreeScan = Get-Date
    $snapshotByIdentity = @{}
    foreach ($identity in @($Handle.ProcessTreeSnapshot) + @(Get-ProcessTreeSnapshot -RootProcessId ([int]$Handle.Process.Id))) {
        $key = "{0}|{1}" -f ([int]$identity.ProcessId), ([string]$identity.ProcessStartUtc)
        $snapshotByIdentity[$key] = $identity
    }
    $Handle.ProcessTreeSnapshot = @($snapshotByIdentity.Values)
}

function Test-BlockwrightPortAvailable {
    param([Parameter(Mandatory = $true)][ValidateRange(1024, 65535)][int]$CandidatePort)
    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $CandidatePort)
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        if ($null -ne $listener) { try { $listener.Stop() } catch {} }
    }
}

function Save-BlockwrightPreferredPort {
    param([Parameter(Mandatory = $true)][ValidateRange(1024, 65535)][int]$PreferredPort)
    $configuration = Get-BlockwrightConfiguration -InstallRoot $ResolvedPluginRoot -StateRoot $script:StateRoot
    $document = [ordered]@{}
    foreach ($property in $configuration.PSObject.Properties) { $document[$property.Name] = $property.Value }
    $document.port = $PreferredPort
    $configPath = Join-Path $script:StateRoot "config.json"
    $configDirectory = Split-Path -Parent $configPath
    if (-not (Test-Path -LiteralPath $configDirectory -PathType Container)) { $null = New-Item -ItemType Directory -Path $configDirectory -Force }
    $temporaryPath = Join-Path $configDirectory ("config.{0}.tmp" -f ([guid]::NewGuid().ToString("N")))
    try {
        [System.IO.File]::WriteAllText($temporaryPath, (($document | ConvertTo-Json -Depth 8) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temporaryPath -Destination $configPath -Force
    } finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) { Remove-Item -LiteralPath $temporaryPath -Force }
    }
}

function Select-BlockwrightPort {
    param([Parameter(Mandatory = $true)][ValidateRange(1024, 65535)][int]$PreferredPort)
    if (Test-BlockwrightPortAvailable -CandidatePort $PreferredPort) { return $PreferredPort }
    if ($script:PortWasExplicit) { throw "Local port $PreferredPort is already in use. Choose another explicit -Port value." }

    for ($offset = 1; $offset -le 64; $offset += 1) {
        $candidate = $PreferredPort + $offset
        if ($candidate -gt 65535) { $candidate = 1024 + ($candidate - 65536) }
        if (Test-BlockwrightPortAvailable -CandidatePort $candidate) {
            Save-BlockwrightPreferredPort -PreferredPort $candidate
            Add-ControllerLog "Preferred port $PreferredPort was unavailable. Selected and persisted loopback port $candidate."
            return $candidate
        }
    }
    throw "Blockwright could not find an available loopback port within 64 candidates after preferred port $PreferredPort."
}

function Start-BlockwrightServer {
    param(
        [switch]$NoAutomaticRepair,
        [switch]$CrashRecovery
    )
    if (Test-ProcessRunning $script:ServerHandle) {
        Add-ControllerLog "The server is already running."
        return
    }
    if (Test-ProcessRunning $script:MaintenanceHandle) {
        throw "Wait for dependency maintenance to finish before starting the server."
    }
    $script:CrashRestartDueAt = $null
    $script:CrashRestartPendingAttempt = $null
    if (-not $CrashRecovery) { $script:CrashRestartHistory.Clear() }
    $script:AutoRestartEligible = [bool]$CrashRecovery
    $script:AutomaticStartFailure = $null
    Assert-BlockwrightManagedRecordReady

    $nodePath = Get-NodeExecutable
    if ($null -eq $nodePath) { throw "The packaged private Node.js runtime is missing. Reinstall or repair Blockwright; installed releases do not use machine-wide Node.js." }
    $appRoot = Join-Path $ResolvedPluginRoot "app"
    $entryPath = Get-ServerEntryPath
    if ($null -eq $entryPath) {
        throw "The packaged production server entry is missing (expected app/dist/__entry.js or app/dist/server.js)."
    }
    $dependencyStatus = Get-RuntimeDependencyStatus
    if (-not $dependencyStatus.Valid) {
        if ($NoAutomaticRepair) {
            throw "Runtime dependencies are still invalid after maintenance. $($dependencyStatus.Message)"
        }
        Add-ControllerLog "$($dependencyStatus.Message) Shared dependency maintenance will run first, then the server will start automatically."
        Start-DependencyMaintenance -StartServerAfter -CrashRecovery:$CrashRecovery
        return
    }
    Add-ControllerLog $dependencyStatus.Message

    $script:Port = Select-BlockwrightPort -PreferredPort $Port

    $dataRoot = Join-Path $appRoot "data\java"
    $script:ServerBaseUrl = "http://127.0.0.1:$Port"
    $script:ServerHttpStatus = $null
    $script:ServerReady = $false
    $script:ServerIdentityVerified = $false
    $script:ServerHealthDetail = $null
    $script:ServerIdentityDetail = $null
    $script:ServerReadinessDetail = $null
    $script:LastHealthScan = [datetime]::MinValue
    $script:LastProcessTreeScan = [datetime]::MinValue
    $script:ServerCrashCleanupFailureNotified = $false
    $script:LastExitCode = $null
    $script:ServerStartedAt = Get-Date
    $entryArguments = Quote-NativeArgument $entryPath
    Reset-BlockwrightTaskMonitor
    $script:LocalMcpToken = New-LocalMcpToken
    $serverEnvironment = @{
        NODE_ENV = "production"
        __PORT = [string]$Port
        PORT = [string]$Port
        BLOCKWRIGHT_DATA_DIR = $dataRoot
        BLOCKWRIGHT_STATE_ROOT = $script:StateRoot
        BLOCKWRIGHT_STATE_DIR = $script:StateRoot
        BLOCKWRIGHT_LOCAL_MCP_TOKEN = $script:LocalMcpToken
    }
    try {
        $script:ServerHandle = New-CapturedProcess -FileName $nodePath -Arguments $entryArguments -WorkingDirectory $appRoot -Label "server" -EnvironmentVariables $serverEnvironment
    } catch {
        $script:LocalMcpToken = $null
        $script:AutoRestartEligible = $false
        throw
    }
    $script:ExpectedServerStop = $false
    try {
        Write-ManagedServerRecord
    } catch {
        $recordFailure = $_.Exception.Message
        $startedProcessId = [int]$script:ServerHandle.Process.Id
        $script:ExpectedServerStop = $true
        try {
            Stop-CapturedProcessTree -Handle $script:ServerHandle
        } catch {
            $cleanupFailure = $_.Exception.Message
            $script:ExpectedServerStop = $false
            throw "The server started as PID $startedProcessId, but its managed-process record could not be persisted and process-tree cleanup could not be confirmed. The live handle and any ownership evidence were retained. Record failure: $recordFailure Cleanup failure: $cleanupFailure"
        }
        Complete-ConfirmedServerStop -RemoveManagedRecord
        throw "The server started as PID $startedProcessId, but its managed-process record could not be persisted. The started process tree was stopped before startup failed. $recordFailure"
    }
    Add-ControllerLog "Production entry: $entryPath (NODE_ENV=production, __PORT=$Port, PORT=$Port)."
    Add-ControllerLog "Started the standalone Blockwright HTTP/MCP server on 127.0.0.1:$Port (PID $($script:ServerHandle.Process.Id)). Codex-managed session servers are separate."
}

function Stop-CapturedProcessTree {
    param(
        [object]$Handle,
        [int]$GraceMilliseconds = 3500,
        [int]$ForceWaitMilliseconds = 5000,
        [string]$TaskKillPath
    )
    if ($null -eq $Handle -or $null -eq $Handle.Process) { return }
    $managedProcess = $Handle.Process
    $managedProcessId = [int]$managedProcess.Id
    $snapshotProperty = $Handle.PSObject.Properties["ProcessTreeSnapshot"]
    if ($null -eq $snapshotProperty) {
        $Handle | Add-Member -NotePropertyName ProcessTreeSnapshot -NotePropertyValue @()
        $snapshotProperty = $Handle.PSObject.Properties["ProcessTreeSnapshot"]
    }
    $snapshotByIdentity = @{}
    $liveSnapshot = if (Test-ProcessRunning $Handle) { @(Get-ProcessTreeSnapshot -RootProcessId $managedProcessId) } else { @() }
    foreach ($identity in @($snapshotProperty.Value) + @($liveSnapshot)) {
        $key = "{0}|{1}" -f ([int]$identity.ProcessId), ([string]$identity.ProcessStartUtc)
        $snapshotByIdentity[$key] = $identity
    }
    $snapshot = @($snapshotByIdentity.Values)
    $Handle.ProcessTreeSnapshot = $snapshot

    if (Test-ProcessRunning $Handle) {
        try { $managedProcess.StandardInput.Close() } catch {}
        try { $null = $managedProcess.WaitForExit($GraceMilliseconds) } catch {}
    }

    $remainingProcessIds = @(Get-RunningCapturedProcessIds -Snapshot $snapshot)
    if ($remainingProcessIds.Count -gt 0) {
        if ([string]::IsNullOrWhiteSpace($TaskKillPath)) { $TaskKillPath = Join-Path $env:SystemRoot "System32\taskkill.exe" }
        if (-not (Test-Path -LiteralPath $TaskKillPath -PathType Leaf)) {
            throw "Forced process-tree stop could not run because taskkill.exe is missing: $TaskKillPath"
        }
        $forceTargets = if ($remainingProcessIds -contains $managedProcessId) { @($managedProcessId) } else { @($remainingProcessIds) }
        foreach ($forceTargetId in $forceTargets) {
            $verifiedIdentity = @($snapshot | Where-Object { [int]$_.ProcessId -eq $forceTargetId -and (Test-CapturedProcessIdentityRunning -Identity $_) } | Select-Object -First 1)
            if ($verifiedIdentity.Count -eq 0) { continue }
            $taskKillInfo = New-Object System.Diagnostics.ProcessStartInfo
            $taskKillInfo.FileName = $TaskKillPath
            $taskKillInfo.Arguments = "/PID $forceTargetId /T /F"
            $taskKillInfo.UseShellExecute = $false
            $taskKillInfo.CreateNoWindow = $true
            $taskKillInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
            $taskKillProcess = [System.Diagnostics.Process]::Start($taskKillInfo)
            if ($null -eq $taskKillProcess) { throw "Forced process-tree stop did not start for PID $forceTargetId." }
            try {
                if (-not $taskKillProcess.WaitForExit($ForceWaitMilliseconds)) {
                    try { $taskKillProcess.Kill() } catch {}
                    throw "Forced process-tree stop timed out for PID $forceTargetId."
                }
            } finally {
                $taskKillProcess.Dispose()
            }
        }
        $deadline = (Get-Date).AddMilliseconds($ForceWaitMilliseconds)
        do {
            $remainingProcessIds = @(Get-RunningCapturedProcessIds -Snapshot $snapshot)
            if ($remainingProcessIds.Count -eq 0) { break }
            Start-Sleep -Milliseconds 50
        } while ((Get-Date) -lt $deadline)
    }

    $remainingProcessIds = @(Get-RunningCapturedProcessIds -Snapshot $snapshot)
    if ($remainingProcessIds.Count -gt 0 -or (Test-ProcessRunning $Handle)) {
        $remainingText = if ($remainingProcessIds.Count -gt 0) { $remainingProcessIds -join ", " } else { [string]$managedProcessId }
        throw "Blockwright process-tree exit could not be confirmed; PID(s) still running: $remainingText. Ownership evidence was retained."
    }
    $Handle.ProcessTreeSnapshot = @()
}

function Complete-ConfirmedServerStop {
    param([switch]$RemoveManagedRecord)
    if ($null -eq $script:ServerHandle) { return }
    Reset-BlockwrightTaskMonitor
    try { $null = Drain-ProcessLogs -Handle $script:ServerHandle } catch {}
    try { $script:LastExitCode = $script:ServerHandle.Process.ExitCode } catch {}
    try { $script:ServerHandle.Process.Dispose() } catch {}
    $script:ServerHandle = $null
    $script:ServerBaseUrl = $null
    $script:ServerHttpStatus = $null
    $script:ServerReady = $false
    $script:ServerIdentityVerified = $false
    $script:ServerHealthDetail = $null
    $script:ServerIdentityDetail = $null
    $script:ServerReadinessDetail = $null
    $script:ServerStartedAt = $null
    $script:LocalMcpToken = $null
    $script:ExpectedServerStop = $false
    $script:AutoRestartEligible = $false
    $script:CrashRestartDueAt = $null
    $script:CrashRestartPendingAttempt = $null
    if ($RemoveManagedRecord) { Remove-ManagedServerRecord }
}

function Stop-BlockwrightServer {
    $script:AutoRestartEligible = $false
    $script:CrashRestartDueAt = $null
    $script:CrashRestartPendingAttempt = $null
    $script:OpenWorkbenchPending = $false
    if ($null -eq $script:ServerHandle) {
        $script:LocalMcpToken = $null
        Add-ControllerLog "The server is already stopped."
        return
    }
    $stoppedProcessId = $script:ServerHandle.Process.Id
    $script:ExpectedServerStop = $true
    Add-ControllerLog "Stopping Blockwright PID $stoppedProcessId and its managed worker..."
    try {
        Stop-CapturedProcessTree -Handle $script:ServerHandle
    } catch {
        $script:ExpectedServerStop = $false
        throw
    }
    Complete-ConfirmedServerStop -RemoveManagedRecord
    Add-ControllerLog "Blockwright stopped."
}

function Start-DependencyMaintenance {
    param(
        [switch]$StartServerAfter,
        [switch]$CrashRecovery
    )
    if (Test-ProcessRunning $script:ServerHandle) {
        throw "Stop the server before installing or repairing runtime dependencies."
    }
    if (Test-ProcessRunning $script:MaintenanceHandle) {
        throw "Dependency maintenance is already running."
    }
    $appRoot = Join-Path $ResolvedPluginRoot "app"
    $packagePath = Join-Path $appRoot "package.json"
    if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
        throw "The packaged app manifest is missing: $packagePath"
    }
    $repairScript = Join-Path $ResolvedPluginRoot "scripts\windows\Invoke-BlockwrightRuntimeRepair.ps1"
    if (-not (Test-Path -LiteralPath $repairScript -PathType Leaf)) {
        throw "The shared dependency-repair helper is missing: $repairScript"
    }
    $windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    if (-not (Test-Path -LiteralPath $windowsPowerShell -PathType Leaf)) {
        throw "Windows PowerShell was not found: $windowsPowerShell"
    }
    $repairArguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $(Quote-NativeArgument $repairScript) -PluginRoot $(Quote-NativeArgument $ResolvedPluginRoot)"
    $script:StartAfterMaintenance = [bool]$StartServerAfter
    $script:StartAfterMaintenanceCrashRecovery = [bool]$CrashRecovery
    try {
        $script:MaintenanceHandle = New-CapturedProcess -FileName $windowsPowerShell -Arguments $repairArguments -WorkingDirectory $ResolvedPluginRoot -Label "dependencies"
    } catch {
        $script:StartAfterMaintenance = $false
        $script:StartAfterMaintenanceCrashRecovery = $false
        throw
    }
    Add-ControllerLog "Installing and validating packaged runtime dependencies under the shared cross-process lock (PID $($script:MaintenanceHandle.Process.Id))..."
}

function Start-BlockwrightUpdateProcess {
    param([ValidateSet("check", "install")][string]$Mode)
    if (Test-ProcessRunning $script:UpdateHandle) { throw "An update operation is already running." }
    if (Test-ProcessRunning $script:MaintenanceHandle) { throw "Wait for dependency maintenance to finish before checking for updates." }
    $updater = Join-Path $ResolvedPluginRoot "scripts\windows\Update-Blockwright.ps1"
    if (-not (Test-Path -LiteralPath $updater -PathType Leaf)) { throw "The fail-closed Blockwright updater is missing: $updater" }
    $windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    if (-not (Test-Path -LiteralPath $windowsPowerShell -PathType Leaf)) { throw "Windows PowerShell was not found: $windowsPowerShell" }
    if ($Mode -eq "install" -and (Test-ProcessRunning $script:ServerHandle)) { Stop-BlockwrightServer }
    if ($Mode -eq "check" -and (Test-Path -LiteralPath $script:UpdateCheckPath -PathType Leaf)) { Remove-Item -LiteralPath $script:UpdateCheckPath -Force }
    $updateArguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $(Quote-NativeArgument $updater) -InstallRoot $(Quote-NativeArgument $ResolvedPluginRoot) -StateRoot $(Quote-NativeArgument $script:StateRoot) -PassThru"
    if ($Mode -eq "check") {
        $updateArguments += " -CheckOnly"
    } else {
        $updateArguments += " -NoRelaunch"
    }
    $script:UpdateMode = $Mode
    $script:UpdateHandle = New-CapturedProcess -FileName $windowsPowerShell -Arguments $updateArguments -WorkingDirectory $ResolvedPluginRoot -Label "update-$Mode"
    if ($Mode -eq "check") {
        Add-ControllerLog "Checking for an update asynchronously. Any candidate must pass HTTPS, size, checksum, version, and trusted Authenticode verification; nothing will be installed without confirmation."
    } else {
        Add-ControllerLog "Installing the user-confirmed, re-downloaded, and independently re-verified Blockwright update."
    }
}

function Get-UpdateReportMessage {
    param([string]$Path, [string]$Fallback)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $Fallback }
    try {
        $report = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
        if (-not [string]::IsNullOrWhiteSpace([string]$report.message)) { return [string]$report.message }
    } catch {}
    return $Fallback
}

function Get-ManagedProcessIds {
    if (-not (Test-ProcessRunning $script:ServerHandle)) { return @() }
    $rootProcessId = [int]$script:ServerHandle.Process.Id
    return @(Get-ProcessTreeSnapshot -RootProcessId $rootProcessId | ForEach-Object { [int]$_.ProcessId })
}

function Get-ManagedListeningPorts {
    $managedIds = @(Get-ManagedProcessIds)
    if ($managedIds.Count -eq 0) { return @() }
    $ports = @()
    try {
        $connections = Get-NetTCPConnection -State Listen -ErrorAction Stop
        foreach ($connection in $connections) {
            if ($managedIds -contains [int]$connection.OwningProcess) {
                $ports += [int]$connection.LocalPort
            }
        }
    } catch {
        try {
            foreach ($line in (& netstat.exe -ano -p tcp 2>$null)) {
                if ($line -match '^\s*TCP\s+(?<local>\S+)\s+\S+\s+LISTENING\s+(?<owner>\d+)\s*$') {
                    $ownerId = [int]$Matches.owner
                    if ($managedIds -contains $ownerId -and $Matches.local -match ':(?<port>\d+)$') {
                        $ports += [int]$Matches.port
                    }
                }
            }
        } catch {}
    }
    return @($ports | Sort-Object -Unique)
}

function Read-BoundedResponseBody {
    param(
        [Parameter(Mandatory = $true)][System.IO.Stream]$Stream,
        [ValidateRange(1024, 4194304)][int]$MaximumCharacters = 32768
    )
    $reader = New-Object System.IO.StreamReader($Stream)
    try {
        $builder = New-Object System.Text.StringBuilder
        $buffer = New-Object char[] 4096
        while ($builder.Length -lt $MaximumCharacters) {
            $remaining = $MaximumCharacters - $builder.Length
            $requested = [math]::Min($buffer.Length, $remaining)
            $readCount = $reader.Read($buffer, 0, $requested)
            if ($readCount -le 0) { break }
            $null = $builder.Append($buffer, 0, $readCount)
        }
        return $builder.ToString()
    } finally {
        $reader.Dispose()
    }
}

function Test-HttpEndpoint {
    param([string]$Url)
    try {
        $request = [System.Net.HttpWebRequest]::Create($Url)
        $request.Method = "GET"
        $request.Timeout = 350
        $request.ReadWriteTimeout = 350
        $request.AllowAutoRedirect = $false
        $response = $request.GetResponse()
        $statusCode = [int]$response.StatusCode
        $body = Read-BoundedResponseBody -Stream $response.GetResponseStream()
        $response.Close()
        return [pscustomobject]@{ Responded = $true; Successful = ($statusCode -ge 200 -and $statusCode -lt 400); StatusCode = $statusCode; Body = $body }
    } catch [System.Net.WebException] {
        if ($null -ne $_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
            $body = Read-BoundedResponseBody -Stream $_.Exception.Response.GetResponseStream()
            $_.Exception.Response.Close()
            return [pscustomobject]@{ Responded = $true; Successful = ($statusCode -ge 200 -and $statusCode -lt 400); StatusCode = $statusCode; Body = $body }
        }
        return [pscustomobject]@{ Responded = $false; Successful = $false; StatusCode = $null; Body = $null }
    } catch {
        return [pscustomobject]@{ Responded = $false; Successful = $false; StatusCode = $null; Body = $null }
    }
}

function Test-LocalMcpEndpoint {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$ExpectedVersion
    )
    if ([string]::IsNullOrWhiteSpace($script:LocalMcpToken)) {
        return [pscustomobject]@{ Responded = $false; Successful = $false; StatusCode = $null; Detail = "the per-launch MCP credential is unavailable" }
    }
    try {
        $request = [System.Net.HttpWebRequest]::Create($Url)
        $request.Method = "POST"
        $request.Timeout = 1000
        $request.ReadWriteTimeout = 1000
        $request.AllowAutoRedirect = $false
        $request.ContentType = "application/json"
        $request.Accept = "application/json, text/event-stream"
        $request.Headers["Authorization"] = "Bearer $($script:LocalMcpToken)"
        $payload = [Text.Encoding]::UTF8.GetBytes((@{
            jsonrpc = "2.0"
            id = "blockwright-control-center-ready"
            method = "initialize"
            params = @{
                protocolVersion = "2025-03-26"
                capabilities = @{}
                clientInfo = @{ name = "blockwright-control-center"; version = $ControllerVersion }
            }
        } | ConvertTo-Json -Depth 8 -Compress))
        $request.ContentLength = $payload.Length
        $requestStream = $request.GetRequestStream()
        try { $requestStream.Write($payload, 0, $payload.Length) } finally { $requestStream.Dispose() }
        $response = $request.GetResponse()
        $statusCode = [int]$response.StatusCode
        $body = Read-BoundedResponseBody -Stream $response.GetResponseStream()
        $response.Close()
        try {
            $message = $body | ConvertFrom-Json
            $serverInfo = Get-FirstPropertyValue -Object $message.result -Names @("serverInfo")
            $name = [string](Get-FirstPropertyValue -Object $serverInfo -Names @("name"))
            $version = [string](Get-FirstPropertyValue -Object $serverInfo -Names @("version"))
            $verified = ($statusCode -ge 200 -and $statusCode -lt 300) -and ($name -ceq "blockwright") -and ($version -ceq $ExpectedVersion)
            $detail = if ($verified) { "authenticated MCP initialize verified" } else { "MCP initialize identity mismatch (name '$name', version '$version')" }
            return [pscustomobject]@{ Responded = $true; Successful = $verified; StatusCode = $statusCode; Detail = $detail }
        } catch {
            return [pscustomobject]@{ Responded = $true; Successful = $false; StatusCode = $statusCode; Detail = "MCP initialize did not return bounded JSON" }
        }
    } catch [System.Net.WebException] {
        $statusCode = $null
        if ($null -ne $_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
            $_.Exception.Response.Close()
        }
        return [pscustomobject]@{ Responded = ($null -ne $statusCode); Successful = $false; StatusCode = $statusCode; Detail = "authenticated MCP initialize failed" }
    } catch {
        return [pscustomobject]@{ Responded = $false; Successful = $false; StatusCode = $null; Detail = "authenticated MCP initialize was unreachable" }
    }
}

function Invoke-LocalMcpJsonRpc {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Method,
        [object]$Parameters = @{},
        [ValidateRange(1000, 60000)][int]$TimeoutMilliseconds = 30000,
        [ValidateRange(32768, 4194304)][int]$MaximumResponseCharacters = 1048576
    )
    if ([string]::IsNullOrWhiteSpace($script:LocalMcpToken)) {
        throw "The per-launch MCP credential is unavailable."
    }
    $request = [System.Net.HttpWebRequest]::Create($Url)
    $request.Method = "POST"
    $request.Timeout = $TimeoutMilliseconds
    $request.ReadWriteTimeout = $TimeoutMilliseconds
    $request.AllowAutoRedirect = $false
    $request.ContentType = "application/json"
    $request.Accept = "application/json, text/event-stream"
    $request.Headers["Authorization"] = "Bearer $($script:LocalMcpToken)"
    $payloadDocument = [ordered]@{ jsonrpc = "2.0"; id = $Id; method = $Method; params = $Parameters }
    $payload = [Text.Encoding]::UTF8.GetBytes(($payloadDocument | ConvertTo-Json -Depth 16 -Compress))
    $request.ContentLength = $payload.Length
    try {
        $requestStream = $request.GetRequestStream()
        try { $requestStream.Write($payload, 0, $payload.Length) } finally { $requestStream.Dispose() }
        $response = $request.GetResponse()
        try {
            $statusCode = [int]$response.StatusCode
            $body = Read-BoundedResponseBody -Stream $response.GetResponseStream() -MaximumCharacters $MaximumResponseCharacters
        } finally {
            $response.Close()
        }
    } catch [System.Net.WebException] {
        $statusCode = $null
        $body = ""
        if ($null -ne $_.Exception.Response) {
            try {
                $statusCode = [int]$_.Exception.Response.StatusCode
                $body = Read-BoundedResponseBody -Stream $_.Exception.Response.GetResponseStream() -MaximumCharacters 32768
            } finally {
                $_.Exception.Response.Close()
            }
        }
        $summary = ($body -replace '\s+', ' ').Trim()
        if ($summary.Length -gt 360) { $summary = $summary.Substring(0, 357) + "..." }
        throw "MCP $Method failed$(if ($null -ne $statusCode) { " with HTTP $statusCode" }).$(if ($summary) { " $summary" })"
    }
    if ($statusCode -lt 200 -or $statusCode -ge 300) { throw "MCP $Method returned HTTP $statusCode." }
    try { $message = $body | ConvertFrom-Json } catch { throw "MCP $Method did not return bounded JSON." }
    if ([string]$message.jsonrpc -ne "2.0" -or [string]$message.id -ne $Id) { throw "MCP $Method returned a mismatched JSON-RPC envelope." }
    if ($null -ne $message.PSObject.Properties["error"]) {
        $errorMessage = [string](Get-FirstPropertyValue -Object $message.error -Names @("message"))
        throw "MCP $Method returned an error.$(if ($errorMessage) { " $errorMessage" })"
    }
    return $message
}

function Invoke-PrimaryWorkflowSmokeTest {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$ExpectedVersion,
        [Parameter(Mandatory = $true)][datetime]$Deadline
    )
    $initialize = Invoke-LocalMcpJsonRpc -Url $Url -Id "blockwright-smoke-initialize" -Method "initialize" -Parameters @{
        protocolVersion = "2025-03-26"
        capabilities = @{}
        clientInfo = @{ name = "blockwright-windows-smoke"; version = $ControllerVersion }
    }
    $serverInfo = Get-FirstPropertyValue -Object $initialize.result -Names @("serverInfo")
    $serverName = [string](Get-FirstPropertyValue -Object $serverInfo -Names @("name"))
    $serverVersion = [string](Get-FirstPropertyValue -Object $serverInfo -Names @("version"))
    if ($serverName -cne "blockwright" -or $serverVersion -cne $ExpectedVersion) {
        throw "Installed MCP identity mismatch (name '$serverName', version '$serverVersion'; expected blockwright $ExpectedVersion)."
    }

    # The complete local inventory includes rich input/output schemas and is
    # currently larger than 1 MiB. Keep this probe bounded, but give the
    # inventory enough headroom to validate the real installed server.
    $toolList = Invoke-LocalMcpJsonRpc -Url $Url -Id "blockwright-smoke-tools" -Method "tools/list" -MaximumResponseCharacters 4194304
    $tools = @($toolList.result.tools)
    $toolNames = @($tools | ForEach-Object { [string]$_.name })
    $requiredTools = @("compile_build", "validate_build", "validate_build_contract", "export_build", "start_compile_task", "get_task_status", "list_tasks")
    $missingTools = @($requiredTools | Where-Object { $toolNames -notcontains $_ })
    if ($missingTools.Count -gt 0) { throw "Installed MCP tool inventory is missing: $($missingTools -join ', ')." }

    $buildInput = [ordered]@{
        name = "Installed MVP Smoke"
        edition = "java"
        version = "26.2"
        style = "nordic"
        buildingType = "house"
        dimensions = @{ width = 9; depth = 9; height = 7 }
        seed = "blockwright-windows-mvp-smoke-v1"
        blockBudget = 5000
    }
    $compileParameters = @{ name = "compile_build"; arguments = $buildInput }
    $compile = Invoke-LocalMcpJsonRpc -Url $Url -Id "blockwright-smoke-compile" -Method "tools/call" -Parameters $compileParameters
    if ([bool]$compile.result.isError) { throw "Installed compile_build returned a tool error." }
    $build = $compile.result.structuredContent.build
    if ($null -eq $build -or [string]$build.id -notmatch '^bw_[a-f0-9]{12}$' -or [string]$build.hash -notmatch '^[a-f0-9]{64}$') {
        throw "Installed compile_build did not return a canonical build identity."
    }
    if ([int]$build.blockCount -le 0 -or -not [bool]$build.validation.valid -or [string]$build.contract.status -ne "valid") {
        throw "Installed compile_build did not produce a non-empty, valid build and contract."
    }

    $replay = Invoke-LocalMcpJsonRpc -Url $Url -Id "blockwright-smoke-replay" -Method "tools/call" -Parameters $compileParameters
    $replayBuild = $replay.result.structuredContent.build
    if ([bool]$replay.result.isError -or [string]$replayBuild.hash -cne [string]$build.hash -or [int]$replayBuild.blockCount -ne [int]$build.blockCount) {
        throw "Installed compile_build did not reproduce the same deterministic build hash and block count."
    }

    $validation = Invoke-LocalMcpJsonRpc -Url $Url -Id "blockwright-smoke-validation" -Method "tools/call" -Parameters @{
        name = "validate_build"
        arguments = @{ build = [string]$build.id }
    }
    if ([bool]$validation.result.isError -or -not [bool]$validation.result.structuredContent.validation.valid -or
        [string]$validation.result.structuredContent.hash -cne [string]$build.hash) {
        throw "Installed validate_build did not reproduce the compiled build's valid hash-bound result."
    }

    $contractValidation = Invoke-LocalMcpJsonRpc -Url $Url -Id "blockwright-smoke-contract" -Method "tools/call" -Parameters @{
        name = "validate_build_contract"
        arguments = @{ build = [string]$build.id }
    }
    $contract = $contractValidation.result.structuredContent.contract
    if ([bool]$contractValidation.result.isError -or [string]$contract.status -ne "valid" -or [string]$contract.buildHash -cne [string]$build.hash) {
        throw "Installed validate_build_contract did not reproduce the compiled build's valid hash-bound contract."
    }

    $export = Invoke-LocalMcpJsonRpc -Url $Url -Id "blockwright-smoke-export" -Method "tools/call" -Parameters @{
        name = "export_build"
        arguments = @{ build = [string]$build.id; format = "schem" }
    }
    $exportResult = $export.result.structuredContent
    if ([bool]$export.result.isError -or [string]$exportResult.format -ne "schem" -or
        [string]$exportResult.filename -notmatch '\.schem$' -or [int]$exportResult.bytes -le 0 -or [int]$exportResult.schematicVersion -ne 3) {
        throw "Installed export_build did not produce a non-empty Sponge Schematic v3 artifact."
    }

    $taskStart = Invoke-LocalMcpJsonRpc -Url $Url -Id "blockwright-smoke-task-start" -Method "tools/call" -Parameters @{
        name = "start_compile_task"
        arguments = $buildInput
    }
    $startedTask = $taskStart.result.structuredContent.task
    $taskId = [string]$startedTask.id
    if ([bool]$taskStart.result.isError -or [string]::IsNullOrWhiteSpace($taskId)) {
        throw "Installed start_compile_task did not return a queued task identity."
    }
    $terminalTask = $null
    $taskBuild = $null
    $taskStatusPolls = 0
    while ((Get-Date) -lt $Deadline) {
        $taskStatusPolls++
        $taskStatus = Invoke-LocalMcpJsonRpc -Url $Url -Id "blockwright-smoke-task-status-$taskStatusPolls" -Method "tools/call" -Parameters @{
            name = "get_task_status"
            arguments = @{ taskId = $taskId }
        }
        if ([bool]$taskStatus.result.isError) { throw "Installed get_task_status returned a tool error." }
        $currentTask = $taskStatus.result.structuredContent.task
        if ([string]$currentTask.id -cne $taskId) { throw "Installed get_task_status returned a mismatched task identity." }
        $taskState = [string]$currentTask.state
        if ($taskState -in @("completed", "cancelled", "failed", "interrupted")) {
            if ($taskState -cne "completed" -or -not [bool]$currentTask.resultAvailable) {
                throw "Installed asynchronous compile task ended in '$taskState' without an available result."
            }
            $terminalTask = $currentTask
            $taskBuild = $taskStatus.result.structuredContent.build
            break
        }
        Start-Sleep -Milliseconds 100
    }
    if ($null -eq $terminalTask) { throw "Installed asynchronous compile task did not complete within the smoke-test bound." }
    if ($null -eq $taskBuild -or [string]$taskBuild.id -cne [string]$build.id -or
        [string]$taskBuild.hash -cne [string]$build.hash -or [int]$taskBuild.blockCount -ne [int]$build.blockCount) {
        throw "Installed asynchronous compile task did not reproduce the synchronous build identity."
    }

    return [pscustomobject][ordered]@{
        passed = $true
        protocolVersion = [string]$initialize.result.protocolVersion
        serverName = $serverName
        serverVersion = $serverVersion
        toolCount = $tools.Count
        requiredTools = $requiredTools
        buildId = [string]$build.id
        buildHash = [string]$build.hash
        blockCount = [int]$build.blockCount
        deterministicReplay = $true
        validationValid = $true
        contractStatus = [string]$contract.status
        exportFormat = [string]$exportResult.format
        exportFilename = [string]$exportResult.filename
        exportBytes = [int]$exportResult.bytes
        dataVersion = [int]$exportResult.dataVersion
        schematicVersion = [int]$exportResult.schematicVersion
        asyncTaskId = $taskId
        asyncTaskPolls = $taskStatusPolls
        asyncTaskState = [string]$terminalTask.state
        asyncTaskResultAvailable = [bool]$terminalTask.resultAvailable
        asyncTaskBuildId = [string]$taskBuild.id
        asyncTaskBuildHash = [string]$taskBuild.hash
        asyncTaskBlockCount = [int]$taskBuild.blockCount
    }
}

function ConvertTo-HealthInfo {
    param([string]$Body)
    if ([string]::IsNullOrWhiteSpace($Body)) {
        return [pscustomobject]@{ Service = $null; Status = $null; Version = $null; Summary = "empty /health response"; Parsed = $false }
    }
    try {
        $health = $Body | ConvertFrom-Json
        $service = Get-FirstPropertyValue -Object $health -Names @("service")
        $status = Get-FirstPropertyValue -Object $health -Names @("status")
        $version = Get-FirstPropertyValue -Object $health -Names @("version", "appVersion")
        $uptime = Get-FirstPropertyValue -Object $health -Names @("uptimeSeconds", "uptime")
        $parts = @()
        if ($null -ne $service) { $parts += "service $service" }
        if ($null -ne $status) { $parts += "status $status" }
        if ($null -ne $version) { $parts += "version $version" }
        if ($null -ne $uptime) { $parts += "server uptime $uptime s" }
        $summary = if ($parts.Count -gt 0) { $parts -join ", " } else { "health response contained no version" }
        return [pscustomobject]@{ Service = [string]$service; Status = [string]$status; Version = [string]$version; Summary = $summary; Parsed = $true }
    } catch {}
    $compact = ($Body -replace '\s+', ' ').Trim()
    if ($compact.Length -gt 180) { $compact = $compact.Substring(0, 177) + "..." }
    return [pscustomobject]@{ Service = $null; Status = $null; Version = $null; Summary = $compact; Parsed = $false }
}

function ConvertTo-ReadinessInfo {
    param([string]$Body)
    if ([string]::IsNullOrWhiteSpace($Body)) {
        return [pscustomobject]@{ Service = $null; Status = $null; Version = $null; Parsed = $false }
    }
    try {
        $ready = $Body | ConvertFrom-Json
        return [pscustomobject]@{
            Service = [string](Get-FirstPropertyValue -Object $ready -Names @("service"))
            Status = [string](Get-FirstPropertyValue -Object $ready -Names @("status"))
            Version = [string](Get-FirstPropertyValue -Object $ready -Names @("version", "appVersion"))
            Parsed = $true
        }
    } catch {
        return [pscustomobject]@{ Service = $null; Status = $null; Version = $null; Parsed = $false }
    }
}

function ConvertTo-ReadinessFailureSummary {
    param([string]$Body)
    if ([string]::IsNullOrWhiteSpace($Body)) { return "readiness check failed without details" }
    $messages = @()
    try {
        $readyDocument = $Body | ConvertFrom-Json
        $explicitFailures = Get-FirstPropertyValue -Object $readyDocument -Names @("failedChecks", "failures", "errors", "missing")
        if ($null -ne $explicitFailures) {
            foreach ($failureItem in @($explicitFailures) | Select-Object -First 4) {
                if ($failureItem -is [string]) {
                    $messages += [string]$failureItem
                    continue
                }
                $failureId = Get-FirstPropertyValue -Object $failureItem -Names @("id", "name", "check", "code")
                $failureMessage = Get-FirstPropertyValue -Object $failureItem -Names @("message", "detail", "reason", "summary")
                if ($null -ne $failureId -and $null -ne $failureMessage) { $messages += "$failureId`: $failureMessage" }
                elseif ($null -ne $failureId) { $messages += [string]$failureId }
                elseif ($null -ne $failureMessage) { $messages += [string]$failureMessage }
            }
        }

        if ($messages.Count -eq 0) {
            $checkItems = Get-FirstPropertyValue -Object $readyDocument -Names @("checks", "results")
            $namedChecks = @()
            if ($null -ne $checkItems -and $checkItems -isnot [System.Array] -and $checkItems -isnot [string]) {
                foreach ($checkProperty in $checkItems.PSObject.Properties) {
                    $namedChecks += [pscustomobject]@{ Id = $checkProperty.Name; Value = $checkProperty.Value }
                }
            } else {
                foreach ($checkItemValue in @($checkItems)) {
                    $namedChecks += [pscustomobject]@{ Id = $null; Value = $checkItemValue }
                }
            }
            foreach ($namedCheck in $namedChecks) {
                $checkItem = $namedCheck.Value
                if ($null -eq $checkItem) { continue }
                $statusValue = Get-FirstPropertyValue -Object $checkItem -Names @("status", "level", "severity")
                $okValue = Get-FirstPropertyValue -Object $checkItem -Names @("ok", "passed", "ready")
                $isFailure = ($okValue -is [bool] -and -not $okValue) -or ([string]$statusValue -match '^(fail|failed|error|fatal|invalid|missing|blocked|unhealthy)$')
                if (-not $isFailure) { continue }
                $failureId = $namedCheck.Id
                if ([string]::IsNullOrWhiteSpace([string]$failureId)) {
                    $failureId = Get-FirstPropertyValue -Object $checkItem -Names @("id", "name", "check", "code")
                }
                $failureMessage = Get-FirstPropertyValue -Object $checkItem -Names @("message", "detail", "reason", "summary")
                if ($null -ne $failureId -and $null -ne $failureMessage) { $messages += "$failureId`: $failureMessage" }
                elseif ($null -ne $failureId) { $messages += [string]$failureId }
                elseif ($null -ne $failureMessage) { $messages += [string]$failureMessage }
                if ($messages.Count -ge 4) { break }
            }
        }

        if ($messages.Count -eq 0) {
            $documentMessage = Get-FirstPropertyValue -Object $readyDocument -Names @("message", "detail", "reason", "status")
            if ($null -ne $documentMessage) { $messages += [string]$documentMessage }
        }
    } catch {
        $messages += (($Body -replace '\s+', ' ').Trim())
    }
    if ($messages.Count -eq 0) { $messages += "readiness check failed" }
    $summary = ($messages -join "; ")
    if ($summary.Length -gt 260) { $summary = $summary.Substring(0, 257) + "..." }
    return $summary
}

function Update-EndpointDiscovery {
    if (-not (Test-ProcessRunning $script:ServerHandle)) { return }
    if (((Get-Date) - $script:LastNetworkScan).TotalSeconds -lt 1.5) { return }
    $script:LastNetworkScan = Get-Date

    $candidateUrls = @()
    if (-not [string]::IsNullOrWhiteSpace($script:ServerBaseUrl)) {
        $candidateUrls += $script:ServerBaseUrl
    }
    foreach ($listeningPort in @(Get-ManagedListeningPorts)) {
        $candidateUrls += "http://127.0.0.1:$listeningPort"
    }
    foreach ($candidateUrl in @($candidateUrls | Select-Object -Unique)) {
        $newEndpoint = $candidateUrl.TrimEnd('/')
        $readyProbe = Test-HttpEndpoint -Url "$newEndpoint/ready"
        if ($readyProbe.Responded -and $readyProbe.StatusCode -ne 404) {
            $script:ServerBaseUrl = $newEndpoint
            $script:ServerHttpStatus = $readyProbe.StatusCode
            $expectedVersion = Get-ExpectedAppVersion
            $readyInfo = ConvertTo-ReadinessInfo $readyProbe.Body
            $readinessVerified = $readyProbe.Successful -and $readyInfo.Parsed -and
                ($readyInfo.Service -ceq "blockwright") -and ($readyInfo.Status -ceq "ready") -and
                (-not [string]::IsNullOrWhiteSpace($expectedVersion)) -and ($readyInfo.Version -ceq $expectedVersion)
            if ($readinessVerified) {
                $script:ServerReadinessDetail = $null
            } elseif (-not $readyProbe.Successful) {
                $script:ServerReadinessDetail = ConvertTo-ReadinessFailureSummary $readyProbe.Body
            } elseif (-not $readyInfo.Parsed) {
                $script:ServerReadinessDetail = "/ready returned HTTP $($readyProbe.StatusCode), but its bounded response was not valid JSON"
            } else {
                $script:ServerReadinessDetail = "/ready identity mismatch (service '$($readyInfo.Service)', status '$($readyInfo.Status)', version '$($readyInfo.Version)'; expected blockwright, ready, $expectedVersion)"
            }

            if (-not $script:ServerIdentityVerified -or ((Get-Date) - $script:LastHealthScan).TotalSeconds -ge 5) {
                $script:LastHealthScan = Get-Date
                $healthProbe = Test-HttpEndpoint -Url "$newEndpoint/health"
                if ($healthProbe.Successful) {
                    $healthInfo = ConvertTo-HealthInfo $healthProbe.Body
                    $healthVerified = $healthInfo.Parsed -and ($healthInfo.Service -ceq "blockwright") -and
                        ($healthInfo.Status -ceq "ok") -and (-not [string]::IsNullOrWhiteSpace($expectedVersion)) -and
                        ($healthInfo.Version -ceq $expectedVersion)
                    if ($healthVerified) {
                        $mcpProbe = Test-LocalMcpEndpoint -Url "$newEndpoint/mcp" -ExpectedVersion $expectedVersion
                        $script:ServerIdentityVerified = [bool]$mcpProbe.Successful
                        $script:ServerIdentityDetail = "$($healthInfo.Summary); $($mcpProbe.Detail)"
                    } elseif (-not $healthInfo.Parsed) {
                        $script:ServerIdentityVerified = $false
                        $script:ServerIdentityDetail = "/health did not return valid bounded JSON"
                    } else {
                        $script:ServerIdentityVerified = $false
                        $script:ServerIdentityDetail = "/health identity mismatch (service '$($healthInfo.Service)', status '$($healthInfo.Status)', version '$($healthInfo.Version)'; expected blockwright, ok, $expectedVersion)"
                    }
                } else {
                    $script:ServerIdentityVerified = $false
                    $script:ServerIdentityDetail = "/health did not identify this Blockwright package"
                }
            }
            $script:ServerReady = $readinessVerified -and $script:ServerIdentityVerified
            if ($script:ServerReady) { $script:AutoRestartEligible = $true }
            $script:ServerHealthDetail = @($script:ServerReadinessDetail, $script:ServerIdentityDetail) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
            $script:ServerHealthDetail = $script:ServerHealthDetail -join " | "
            return
        }

        # Compatibility with packages created before /ready was added.
        if ($readyProbe.StatusCode -eq 404) {
            $legacyProbe = Test-HttpEndpoint -Url $newEndpoint
            if ($legacyProbe.Responded -and $legacyProbe.StatusCode -lt 500) {
                $script:ServerBaseUrl = $newEndpoint
                $script:ServerHttpStatus = $legacyProbe.StatusCode
                $script:ServerReady = $false
                $script:ServerIdentityVerified = $false
                $script:ServerReadinessDetail = "legacy endpoint responded, but /ready and /health identity checks are unavailable"
                $script:ServerIdentityDetail = $null
                $script:ServerHealthDetail = $script:ServerReadinessDetail
                return
            }
        }
    }
    $script:ServerHttpStatus = $null
    $script:ServerReady = $false
    $script:ServerIdentityVerified = $false
}

function Request-BlockwrightCrashRestart {
    if (-not $script:AutoRestartEligible -or $script:ExitRequested) {
        $script:CrashRestartDueAt = $null
        $script:CrashRestartPendingAttempt = $null
        return [pscustomobject]@{ Status = "NotScheduled"; Attempt = $null; Message = "Automatic restart was not armed because the server had not reached verified health in this session." }
    }
    $now = Get-Date
    $decision = Get-BlockwrightCrashRestartDecision -History @($script:CrashRestartHistory) -Now $now -Limit $script:CrashRestartLimit -WindowSeconds $script:CrashRestartWindowSeconds
    $script:CrashRestartHistory.Clear()
    foreach ($item in @($decision.Recent)) { $script:CrashRestartHistory.Add([datetime]$item) }
    if (-not $decision.Allowed) {
        $script:CrashRestartDueAt = $null
        $script:CrashRestartPendingAttempt = $null
        $script:AutoRestartEligible = $false
        return [pscustomobject]@{ Status = "BudgetExhausted"; Attempt = $decision.Attempts; Message = "Automatic restart stopped after $($decision.Limit) crash restarts within $($decision.WindowSeconds) seconds." }
    }
    $script:CrashRestartHistory.Add($now)
    $attempt = $decision.Attempts + 1
    $script:CrashRestartPendingAttempt = $attempt
    $script:CrashRestartDueAt = $now.AddSeconds($script:CrashRestartDelaySeconds)
    return [pscustomobject]@{ Status = "Scheduled"; Attempt = $attempt; Message = "Automatic restart $attempt of $($decision.Limit) is scheduled in $($script:CrashRestartDelaySeconds) seconds." }
}

function Invoke-PendingCrashRestart {
    if ($null -eq $script:CrashRestartDueAt -or (Get-Date) -lt $script:CrashRestartDueAt -or $script:ExitRequested) { return }
    $attempt = $script:CrashRestartPendingAttempt
    $script:CrashRestartDueAt = $null
    $script:CrashRestartPendingAttempt = $null
    try {
        Add-ControllerLog "Starting crash-recovery attempt $attempt of $($script:CrashRestartLimit)."
        Start-BlockwrightServer -NoAutomaticRepair -CrashRecovery
    } catch {
        $script:AutoRestartEligible = $false
        Add-ControllerLog "Crash-recovery attempt $attempt could not start: $($_.Exception.Message)"
        Show-BlockwrightSupervisorNotification -Key "restart-start-failed" -Title "Blockwright restart failed" -Message "Open the Control Center for diagnostics." -Level Error
    }
}

function Complete-ExitedProcesses {
    if ($null -ne $script:ServerHandle) {
        $null = Drain-ProcessLogs -Handle $script:ServerHandle
        if (-not (Test-ProcessRunning $script:ServerHandle) -and (Test-CapturedProcessTreeRunning $script:ServerHandle)) {
            try {
                Add-ControllerLog "The server root process exited while an owned descendant was still running; cleaning up the captured process tree before recovery."
                Stop-CapturedProcessTree -Handle $script:ServerHandle -GraceMilliseconds 250
                $script:ServerCrashCleanupFailureNotified = $false
            } catch {
                if (-not $script:ServerCrashCleanupFailureNotified) {
                    $script:ServerCrashCleanupFailureNotified = $true
                    Add-ControllerLog "Crash cleanup could not be confirmed; ownership evidence was retained and automatic restart is paused: $($_.Exception.Message)"
                    Show-BlockwrightSupervisorNotification -Key "crash-cleanup-failed" -Title "Blockwright cleanup needs attention" -Message "An owned process could not be confirmed stopped. Automatic restart is paused." -Level Error -ThrottleSeconds 300
                }
                return
            }
        }
        if (-not (Test-ProcessRunning $script:ServerHandle) -and -not (Test-CapturedProcessTreeRunning $script:ServerHandle)) {
            try { $script:LastExitCode = $script:ServerHandle.Process.ExitCode } catch {}
            $externalOwnedStop = -not $script:ExpectedServerStop -and -not (Test-Path -LiteralPath $script:ManagedRecordPath -PathType Leaf)
            $unexpectedExit = -not $script:ExpectedServerStop -and -not $externalOwnedStop
            Add-ControllerLog "The server process exited with code $script:LastExitCode."
            if ($externalOwnedStop) { Add-ControllerLog "Automatic restart was not scheduled because an external ownership-verified stop removed the managed-process record." }
            $restart = $null
            if ($unexpectedExit) {
                $restart = Request-BlockwrightCrashRestart
                Add-ControllerLog $restart.Message
                try { Write-CrashRecord -ExitCode $script:LastExitCode -RestartStatus $restart.Status -RestartAttempt $restart.Attempt } catch { Add-ControllerLog "Crash metadata could not be persisted: $($_.Exception.Message)" }
                if ([string]$restart.Status -ceq "Scheduled") {
                    Show-BlockwrightSupervisorNotification -Key "server-crash-$($restart.Attempt)" -Title "Blockwright stopped unexpectedly" -Message $restart.Message -Level Warning -ThrottleSeconds 5
                } else {
                    Show-BlockwrightSupervisorNotification -Key "server-crash-stopped" -Title "Blockwright needs attention" -Message $restart.Message -Level Error
                }
            }
            Remove-ManagedServerRecord
            $script:ExpectedServerStop = $false
            try { $script:ServerHandle.Process.Dispose() } catch {}
            $script:ServerHandle = $null
            $script:ServerBaseUrl = $null
            $script:ServerHttpStatus = $null
            $script:ServerReady = $false
            $script:ServerIdentityVerified = $false
            $script:ServerHealthDetail = $null
            $script:ServerIdentityDetail = $null
            $script:ServerReadinessDetail = $null
            $script:ServerStartedAt = $null
            Reset-BlockwrightTaskMonitor
            $script:LocalMcpToken = $null
            $script:ServerCrashCleanupFailureNotified = $false
            if (-not $unexpectedExit) { $script:AutoRestartEligible = $false }
        }
    }
    if ($null -ne $script:MaintenanceHandle) {
        $null = Drain-ProcessLogs -Handle $script:MaintenanceHandle
        if (-not (Test-ProcessRunning $script:MaintenanceHandle)) {
            $maintenanceExitCode = 1
            try { $maintenanceExitCode = $script:MaintenanceHandle.Process.ExitCode } catch {}
            try { $script:MaintenanceHandle.Process.Dispose() } catch {}
            $script:MaintenanceHandle = $null
            $startAfterMaintenance = $script:StartAfterMaintenance
            $restartAfterMaintenance = $script:StartAfterMaintenanceCrashRecovery
            $script:StartAfterMaintenance = $false
            $script:StartAfterMaintenanceCrashRecovery = $false
            Add-ControllerLog "Dependency maintenance finished with exit code $maintenanceExitCode."
            if ($script:UiReady) { Invoke-UiDiagnosticRefresh }
            if ($maintenanceExitCode -eq 0 -and $startAfterMaintenance) {
                try {
                    Start-BlockwrightServer -NoAutomaticRepair -CrashRecovery:$restartAfterMaintenance
                } catch {
                    $script:AutomaticStartFailure = $_.Exception.Message
                    Add-ControllerLog "Automatic start after dependency maintenance failed: $script:AutomaticStartFailure"
                    Show-BlockwrightSupervisorNotification -Key "maintenance-start-failed" -Title "Blockwright could not start" -Message "Runtime maintenance finished, but the server still needs attention." -Level Error
                }
            } elseif ($maintenanceExitCode -ne 0 -and $startAfterMaintenance) {
                Add-ControllerLog "The server was not started because dependency maintenance failed."
                Show-BlockwrightSupervisorNotification -Key "maintenance-failed" -Title "Blockwright repair failed" -Message "Open Diagnostics for details." -Level Error
            }
        }
    }
    if ($null -ne $script:UpdateHandle) {
        $null = Drain-ProcessLogs -Handle $script:UpdateHandle
        if (-not (Test-ProcessRunning $script:UpdateHandle)) {
            $updateExitCode = 1
            try { $updateExitCode = $script:UpdateHandle.Process.ExitCode } catch {}
            try { $script:UpdateHandle.Process.Dispose() } catch {}
            $completedMode = $script:UpdateMode
            $script:UpdateHandle = $null
            $script:UpdateMode = $null
            if ($completedMode -eq "check" -and $updateExitCode -eq 0 -and (Test-Path -LiteralPath $script:UpdateCheckPath -PathType Leaf)) {
                try {
                    $check = Get-Content -Raw -LiteralPath $script:UpdateCheckPath | ConvertFrom-Json
                    if ([bool]$check.updateAvailable) {
                        Add-ControllerLog "A trusted Blockwright update is available: $($check.installedVersion) -> $($check.targetVersion)."
                        Show-BlockwrightSupervisorNotification -Key "update-$($check.targetVersion)" -Title "Blockwright update available" -Message "Verified version $($check.targetVersion) is ready to install." -Level Info -ThrottleSeconds 300
                        if ($script:UiReady) {
                            $choice = [System.Windows.MessageBox]::Show(
                                "Blockwright $($check.targetVersion) is available and its installer passed checksum and trusted publisher verification.`n`nInstall it now? The installer will be downloaded and fully verified again. If the local server is running, it will be stopped first.",
                                "Verified Blockwright update available", "YesNo", "Question")
                            if ($choice -eq [System.Windows.MessageBoxResult]::Yes) {
                                try { Start-BlockwrightUpdateProcess -Mode "install" } catch {
                                    Add-ControllerLog "Update installation could not start: $($_.Exception.Message)"
                                    [System.Windows.MessageBox]::Show($_.Exception.Message, "Blockwright update", "OK", "Error") | Out-Null
                                }
                            } else {
                                Add-ControllerLog "Update installation was declined; no installed files were changed."
                            }
                        }
                    } else {
                        Add-ControllerLog "Blockwright $($check.installedVersion) is current; verified channel target is $($check.targetVersion)."
                        if ($script:UiReady) { [System.Windows.MessageBox]::Show("Blockwright $($check.installedVersion) is up to date.", "Blockwright updates", "OK", "Information") | Out-Null }
                    }
                } catch {
                    Add-ControllerLog "Update check completed, but its bounded result could not be read: $($_.Exception.Message)"
                    if ($script:UiReady) { [System.Windows.MessageBox]::Show("The update check completed but its result could not be read. See Live logs for details.", "Blockwright updates", "OK", "Warning") | Out-Null }
                }
            } elseif ($completedMode -eq "install" -and $updateExitCode -eq 0) {
                Add-ControllerLog "The verified Blockwright update installed successfully. Restart the Control Center to load the updated controller."
                Show-BlockwrightSupervisorNotification -Key "update-installed" -Title "Blockwright updated" -Message "Close and reopen the Control Center to load the updated version." -Level Info -ThrottleSeconds 300
                if ($script:UiReady) { [System.Windows.MessageBox]::Show("The verified Blockwright update installed successfully. Close and reopen the Control Center to load the new version.", "Blockwright update installed", "OK", "Information") | Out-Null }
            } else {
                $failure = Get-UpdateReportMessage -Path $script:UpdateFailurePath -Fallback "Update $completedMode exited with code $updateExitCode."
                Add-ControllerLog "Update $completedMode failed: $failure"
                Show-BlockwrightSupervisorNotification -Key "update-failed-$completedMode" -Title "Blockwright update failed" -Message "Open the Control Center for the verified failure details." -Level Error
                if ($script:UiReady) { [System.Windows.MessageBox]::Show($failure, "Blockwright update failed", "OK", "Error") | Out-Null }
            }
        }
    }
}

function Invoke-SmokeTest {
    $capturedLines = New-Object 'System.Collections.Generic.List[string]'
    $started = $false
    $healthy = $false
    $failure = $null
    $processIdValue = $null
    $smokeEndpoint = $null
    $smokeHttpStatus = $null
    $workflow = $null
    $taskPolling = $null
    try {
        Start-BlockwrightServer
        $started = (Test-ProcessRunning $script:ServerHandle) -or (Test-ProcessRunning $script:MaintenanceHandle)
        if (Test-ProcessRunning $script:ServerHandle) { $processIdValue = $script:ServerHandle.Process.Id }
        $deadline = (Get-Date).AddSeconds($SmokeTestSeconds)
        while ((Get-Date) -lt $deadline) {
            foreach ($line in @(Drain-ProcessLogs -Handle $script:ServerHandle)) { $capturedLines.Add($line) }
            foreach ($line in @(Drain-ProcessLogs -Handle $script:MaintenanceHandle)) { $capturedLines.Add($line) }
            Complete-ExitedProcesses
            if (Test-ProcessRunning $script:MaintenanceHandle) {
                Start-Sleep -Milliseconds 250
                continue
            }
            if ($null -eq $processIdValue -and (Test-ProcessRunning $script:ServerHandle)) {
                $processIdValue = $script:ServerHandle.Process.Id
            }
            if (-not (Test-ProcessRunning $script:ServerHandle)) {
                if (-not [string]::IsNullOrWhiteSpace($script:AutomaticStartFailure)) {
                    $failure = "Automatic start after dependency maintenance failed: $script:AutomaticStartFailure"
                } else {
                    $failure = "The server exited before becoming ready."
                }
                break
            }
            Update-EndpointDiscovery
            if (-not [string]::IsNullOrWhiteSpace($script:ServerBaseUrl) -and $script:ServerReady) {
                $smokeEndpoint = "$($script:ServerBaseUrl)/mcp"
                $smokeHttpStatus = $script:ServerHttpStatus
                $workflow = Invoke-PrimaryWorkflowSmokeTest -Url $smokeEndpoint -ExpectedVersion (Get-ExpectedAppVersion) -Deadline $deadline
                $originalPollInterval = $script:TaskPollIntervalSeconds
                try {
                    $script:TaskPollIntervalSeconds = 0
                    for ($pollIndex = 0; $pollIndex -lt 2; $pollIndex++) {
                        Start-BlockwrightTaskPoll
                        $pollDeadline = (Get-Date).AddSeconds(4)
                        while ($null -ne $script:TaskPollTask -and -not $script:TaskPollTask.IsCompleted -and (Get-Date) -lt $pollDeadline) {
                            Start-Sleep -Milliseconds 25
                        }
                        if ($null -eq $script:TaskPollTask -or -not $script:TaskPollTask.IsCompleted) { throw "Authenticated task polling did not complete within its smoke-test bound." }
                        Complete-BlockwrightTaskPoll
                    }
                    $taskPolling = [pscustomobject]@{
                        authenticatedMcp = $script:TaskPollBaselineEstablished
                        observedTasks = $script:TaskSnapshots.Count
                        finalAttention = $script:TaskAttentionState
                    }
                    if (-not $taskPolling.authenticatedMcp -or $taskPolling.observedTasks -lt 1) {
                        throw "Authenticated task polling did not establish a baseline containing the smoke workflow tasks."
                    }
                } finally {
                    $script:TaskPollIntervalSeconds = $originalPollInterval
                }
                $healthy = [bool]$workflow.passed
                break
            }
            Start-Sleep -Milliseconds 250
        }
        if (-not $healthy -and $null -eq $failure) {
            $smokeHttpStatus = $script:ServerHttpStatus
            if (-not [string]::IsNullOrWhiteSpace($script:ServerHealthDetail)) {
                $failure = "The server responded but was not verified: $($script:ServerHealthDetail)"
            } else {
                $failure = "No reachable local endpoint was found within $SmokeTestSeconds seconds."
            }
        }
    } catch {
        $failure = $_.Exception.Message
    } finally {
        if (Test-ProcessRunning $script:MaintenanceHandle) {
            foreach ($line in @(Drain-ProcessLogs -Handle $script:MaintenanceHandle)) { $capturedLines.Add($line) }
            Stop-CapturedProcessTree -Handle $script:MaintenanceHandle -GraceMilliseconds 1500
            try { $script:MaintenanceHandle.Process.Dispose() } catch {}
            $script:MaintenanceHandle = $null
            $script:StartAfterMaintenance = $false
        }
        if ($started -and (Test-ProcessRunning $script:ServerHandle)) {
            foreach ($line in @(Drain-ProcessLogs -Handle $script:ServerHandle)) { $capturedLines.Add($line) }
            Stop-BlockwrightServer
        }
    }

    $result = [ordered]@{
        controllerVersion = $ControllerVersion
        pluginRoot = $ResolvedPluginRoot
        started = $started
        healthy = $healthy
        processId = $processIdValue
        endpoint = $smokeEndpoint
        httpStatus = $smokeHttpStatus
        workflow = $workflow
        taskPolling = $taskPolling
        failure = $failure
        logs = @($capturedLines)
    }
    if ($Json) { $result | ConvertTo-Json -Depth 8 } else { $result | Format-List | Out-String | Write-Output }
    if ($healthy) { exit 0 }
    exit 1
}

if ($SmokeTest) {
    Invoke-SmokeTest
}

if ($interactiveSupervisor) { Repair-BlockwrightManagedRecord }

Add-Type -AssemblyName PresentationCore, PresentationFramework, WindowsBase
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$script:WpfApplication = [System.Windows.Application]::Current
$script:OwnsWpfApplication = $false
if ($interactiveSupervisor -and $null -eq $script:WpfApplication) {
    $script:WpfApplication = [System.Windows.Application]::new()
    $script:WpfApplication.ShutdownMode = [System.Windows.ShutdownMode]::OnExplicitShutdown
    $script:OwnsWpfApplication = $true
}

$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Blockwright Control Center" Width="1180" Height="790"
        MinWidth="960" MinHeight="640" WindowStartupLocation="CenterScreen"
        Background="#111713" Foreground="#F4F1E8" FontFamily="Segoe UI">
  <Window.Resources>
    <SolidColorBrush x:Key="PanelBrush" Color="#18211B"/>
    <SolidColorBrush x:Key="PanelBorderBrush" Color="#304035"/>
    <SolidColorBrush x:Key="MutedBrush" Color="#9EB0A2"/>
    <SolidColorBrush x:Key="AccentBrush" Color="#D88742"/>
    <Style TargetType="Button">
      <Setter Property="Foreground" Value="#F8F3EA"/>
      <Setter Property="Background" Value="#28372D"/>
      <Setter Property="BorderBrush" Value="#496052"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Padding" Value="14,8"/>
      <Setter Property="Margin" Value="0,0,8,0"/>
      <Setter Property="Cursor" Value="Hand"/>
    </Style>
    <Style TargetType="TabItem">
      <Setter Property="Foreground" Value="#DCE5DD"/>
      <Setter Property="Background" Value="#18211B"/>
      <Setter Property="Padding" Value="16,8"/>
    </Style>
    <Style TargetType="DataGrid">
      <Setter Property="Background" Value="#141B16"/>
      <Setter Property="Foreground" Value="#EDF3ED"/>
      <Setter Property="BorderBrush" Value="#304035"/>
      <Setter Property="GridLinesVisibility" Value="Horizontal"/>
      <Setter Property="HorizontalGridLinesBrush" Value="#26352B"/>
      <Setter Property="RowBackground" Value="#141B16"/>
      <Setter Property="AlternatingRowBackground" Value="#19221C"/>
      <Setter Property="HeadersVisibility" Value="Column"/>
      <Setter Property="IsReadOnly" Value="True"/>
      <Setter Property="AutoGenerateColumns" Value="False"/>
    </Style>
    <Style TargetType="DataGridColumnHeader">
      <Setter Property="Background" Value="#253229"/>
      <Setter Property="Foreground" Value="#D7E2D9"/>
      <Setter Property="BorderBrush" Value="#304035"/>
      <Setter Property="Padding" Value="8"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
    </Style>
    <Style TargetType="DataGridCell">
      <Setter Property="BorderThickness" Value="0"/>
      <Setter Property="Padding" Value="8,6"/>
      <Setter Property="ToolTip" Value="{Binding Detail}"/>
    </Style>
  </Window.Resources>

  <Grid Margin="18">
    <Grid.RowDefinitions>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="*"/>
      <RowDefinition Height="Auto"/>
    </Grid.RowDefinitions>

    <Grid Grid.Row="0" Margin="0,0,0,14">
      <Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
      <StackPanel>
        <TextBlock Text="BLOCKWRIGHT" Foreground="#D88742" FontWeight="Bold" FontSize="12"/>
        <TextBlock Text="Windows Control Center" FontWeight="SemiBold" FontSize="28" Margin="0,2,0,2"/>
        <TextBlock x:Name="RootText" Foreground="#9EB0A2" FontSize="12" TextTrimming="CharacterEllipsis"/>
      </StackPanel>
      <Border Grid.Column="1" Background="#18211B" BorderBrush="#304035" BorderThickness="1" CornerRadius="8" Padding="16,10">
        <StackPanel Orientation="Horizontal">
          <Ellipse x:Name="StatusDot" Width="12" Height="12" Fill="#758078" Margin="0,2,9,0" VerticalAlignment="Top"/>
          <StackPanel>
            <TextBlock x:Name="ServerStateText" Text="Stopped" FontWeight="SemiBold" FontSize="16"/>
            <TextBlock x:Name="ServerStateDetailText" Text="No managed process" Foreground="#9EB0A2" FontSize="11"/>
          </StackPanel>
        </StackPanel>
      </Border>
    </Grid>

    <WrapPanel Grid.Row="1" Margin="0,0,0,14">
      <Button x:Name="StartButton" Content="Start server" Background="#B7662F" BorderBrush="#D88742"/>
      <Button x:Name="StopButton" Content="Stop"/>
      <Button x:Name="RestartButton" Content="Restart"/>
      <Button x:Name="InstallButton" Content="Install / repair runtime"/>
      <Button x:Name="RefreshButton" Content="Run checks"/>
      <Button x:Name="UpdateButton" Content="Check for updates"/>
      <Button x:Name="OpenEndpointButton" Content="Open local app"/>
      <Button x:Name="OpenFolderButton" Content="Open plugin folder"/>
    </WrapPanel>

    <Grid Grid.Row="2" Margin="0,0,0,14">
      <Grid.ColumnDefinitions>
        <ColumnDefinition Width="*"/><ColumnDefinition Width="*"/><ColumnDefinition Width="*"/><ColumnDefinition Width="*"/><ColumnDefinition Width="*"/>
      </Grid.ColumnDefinitions>
      <Border Grid.Column="0" Background="#18211B" BorderBrush="#304035" BorderThickness="1" CornerRadius="7" Padding="12" Margin="0,0,8,0">
        <StackPanel><TextBlock Text="PROCESS" Foreground="#9EB0A2" FontSize="10"/><TextBlock x:Name="PidText" Text="--" FontSize="17" FontWeight="SemiBold"/></StackPanel>
      </Border>
      <Border Grid.Column="1" Background="#18211B" BorderBrush="#304035" BorderThickness="1" CornerRadius="7" Padding="12" Margin="0,0,8,0">
        <StackPanel><TextBlock Text="UPTIME" Foreground="#9EB0A2" FontSize="10"/><TextBlock x:Name="UptimeText" Text="--" FontSize="17" FontWeight="SemiBold"/></StackPanel>
      </Border>
      <Border Grid.Column="2" Background="#18211B" BorderBrush="#304035" BorderThickness="1" CornerRadius="7" Padding="12" Margin="0,0,8,0">
        <StackPanel><TextBlock Text="LOCAL ENDPOINT" Foreground="#9EB0A2" FontSize="10"/><TextBlock x:Name="EndpointText" Text="Not detected" FontSize="13" FontWeight="SemiBold" TextTrimming="CharacterEllipsis"/></StackPanel>
      </Border>
      <Border Grid.Column="3" Background="#18211B" BorderBrush="#304035" BorderThickness="1" CornerRadius="7" Padding="12" Margin="0,0,8,0">
        <StackPanel><TextBlock Text="ENVIRONMENT" Foreground="#9EB0A2" FontSize="10"/><TextBlock x:Name="DiagnosticSummaryText" Text="Checking..." FontSize="13" FontWeight="SemiBold"/></StackPanel>
      </Border>
      <Border Grid.Column="4" Background="#18211B" BorderBrush="#304035" BorderThickness="1" CornerRadius="7" Padding="12">
        <StackPanel><TextBlock Text="LAST EXIT" Foreground="#9EB0A2" FontSize="10"/><TextBlock x:Name="ExitCodeText" Text="--" FontSize="17" FontWeight="SemiBold"/></StackPanel>
      </Border>
    </Grid>

    <TabControl x:Name="MainTabs" Grid.Row="3" Background="#141B16" BorderBrush="#304035">
      <TabItem Header="Environment checks">
        <Grid Margin="8">
          <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/></Grid.RowDefinitions>
          <DockPanel Grid.Row="0" Margin="0,0,0,8">
            <TextBlock x:Name="DiagnosticTimestampText" Foreground="#9EB0A2" VerticalAlignment="Center"/>
            <Button x:Name="CopyDiagnosticsButton" Content="Copy diagnostics JSON" DockPanel.Dock="Right" HorizontalAlignment="Right"/>
          </DockPanel>
          <DataGrid x:Name="DiagnosticsGrid" Grid.Row="1">
            <DataGrid.Columns>
              <DataGridTextColumn Header="Status" Binding="{Binding Status}" Width="76"/>
              <DataGridTextColumn Header="Area" Binding="{Binding Area}" Width="130"/>
              <DataGridTextColumn Header="Check" Binding="{Binding Name}" Width="220"/>
              <DataGridTextColumn Header="Result" Binding="{Binding Message}" Width="*"/>
              <DataGridTextColumn Header="Details" Binding="{Binding Detail}" Width="260"/>
            </DataGrid.Columns>
          </DataGrid>
        </Grid>
      </TabItem>
      <TabItem Header="Live logs">
        <Grid Margin="8">
          <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/></Grid.RowDefinitions>
          <StackPanel Grid.Row="0" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,0,0,8">
            <Button x:Name="ClearLogsButton" Content="Clear"/>
            <Button x:Name="CopyLogsButton" Content="Copy"/>
            <Button x:Name="SaveLogsButton" Content="Save log..." Margin="0"/>
          </StackPanel>
          <TextBox x:Name="LogBox" Grid.Row="1" IsReadOnly="True" AcceptsReturn="True" TextWrapping="NoWrap"
                   VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Auto"
                   Background="#0B100C" Foreground="#CFE0D2" BorderBrush="#304035"
                   FontFamily="Consolas" FontSize="12" Padding="10"/>
        </Grid>
      </TabItem>
    </TabControl>

    <DockPanel Grid.Row="4" Margin="0,10,0,0">
      <TextBlock x:Name="FooterText" Foreground="#9EB0A2" FontSize="11"/>
      <TextBlock Text="Close hides to the tray. Use Exit from the tray to stop the owned server." Foreground="#9EB0A2" FontSize="11" DockPanel.Dock="Right" HorizontalAlignment="Right"/>
    </DockPanel>
  </Grid>
</Window>
'@

$xmlReader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
$window = [Windows.Markup.XamlReader]::Load($xmlReader)
$script:TaskbarInfo = New-Object System.Windows.Shell.TaskbarItemInfo
$window.TaskbarItemInfo = $script:TaskbarInfo
$windowIconPath = Join-Path $ResolvedPluginRoot "assets\blockwright-icon-v060.png"
if (-not (Test-Path -LiteralPath $windowIconPath -PathType Leaf)) {
    $windowIconPath = Join-Path $ResolvedPluginRoot "assets\github\blockwright-icon-v060.png"
}
if (Test-Path -LiteralPath $windowIconPath -PathType Leaf) {
    try {
        $windowIcon = New-Object System.Windows.Media.Imaging.BitmapImage
        $windowIcon.BeginInit()
        $windowIcon.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
        $windowIcon.UriSource = New-Object Uri($windowIconPath, [UriKind]::Absolute)
        $windowIcon.EndInit()
        $window.Icon = $windowIcon
    } catch {}
}
$controlNames = @(
    "RootText", "StatusDot", "ServerStateText", "ServerStateDetailText", "StartButton", "StopButton", "RestartButton",
    "InstallButton", "RefreshButton", "UpdateButton", "OpenEndpointButton", "OpenFolderButton", "PidText", "UptimeText", "EndpointText",
    "DiagnosticSummaryText", "ExitCodeText", "MainTabs", "DiagnosticTimestampText", "CopyDiagnosticsButton", "DiagnosticsGrid",
    "ClearLogsButton", "CopyLogsButton", "SaveLogsButton", "LogBox", "FooterText"
)
foreach ($controlName in $controlNames) {
    Set-Variable -Name $controlName -Value $window.FindName($controlName) -Scope Script
}

if ($ValidateUi) {
    $missingControls = @($controlNames | Where-Object { $null -eq (Get-Variable -Name $_ -Scope Script -ValueOnly) })
    $validationResult = [ordered]@{
        valid = ($missingControls.Count -eq 0)
        controllerVersion = $ControllerVersion
        controls = $controlNames.Count
        missingControls = $missingControls
        pluginRoot = $ResolvedPluginRoot
    }
    $validationResult | ConvertTo-Json -Depth 5
    $window.Close()
    if ($missingControls.Count -gt 0) { exit 1 }
    exit 0
}

$script:UiReady = $true
$script:RootText.Text = $ResolvedPluginRoot
$expectedUiVersion = Get-ExpectedAppVersion
$script:FooterText.Text = "Control Center $ControllerVersion | Blockwright $expectedUiVersion | Standalone HTTP/MCP server on 127.0.0.1:$Port"
if (-not [string]::IsNullOrWhiteSpace($script:StartupReconciliationMessage)) { Add-ControllerLog $script:StartupReconciliationMessage }

function Get-StatusBrush {
    param([string]$Status)
    $color = switch ($Status) {
        "PASS" { "#55C782" }
        "WARN" { "#E9B949" }
        "FAIL" { "#F06A6A" }
        "RUNNING" { "#55C782" }
        "STARTING" { "#E9B949" }
        default { "#758078" }
    }
    return (New-Object System.Windows.Media.BrushConverter).ConvertFromString($color)
}

function Invoke-UiDiagnosticRefresh {
    try {
        $script:RefreshButton.IsEnabled = $false
        $script:DiagnosticSummaryText.Text = "Checking..."
        $result = Invoke-BlockwrightDiagnostics
        $script:CurrentDiagnostics = $result
        $script:DiagnosticsGrid.ItemsSource = @($result.Checks)
        $script:DiagnosticSummaryText.Text = "{0} pass / {1} warn / {2} fail" -f $result.Counts.Pass, $result.Counts.Warn, $result.Counts.Fail
        $script:DiagnosticSummaryText.Foreground = Get-StatusBrush $result.Status
        $script:DiagnosticTimestampText.Text = "Last checked: " + (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        $script:LastDiagnosticRefresh = Get-Date
        Add-ControllerLog "Environment checks completed: $($result.Status)."
    } catch {
        $script:DiagnosticSummaryText.Text = "Checks failed"
        $script:DiagnosticSummaryText.Foreground = Get-StatusBrush "FAIL"
        Add-ControllerLog "Environment checks failed: $($_.Exception.Message)"
    } finally {
        $script:RefreshButton.IsEnabled = $true
    }
}

function Initialize-BlockwrightJumpList {
    if (-not $interactiveSupervisor -or $null -eq $script:WpfApplication) { return }
    try {
        $jumpList = [System.Windows.Shell.JumpList]::new()
        $jumpList.ShowFrequentCategory = $false
        $jumpList.ShowRecentCategory = $false
        $iconPath = Join-Path $ResolvedPluginRoot "assets\blockwright-v060.ico"
        if (-not (Test-Path -LiteralPath $iconPath -PathType Leaf)) { $iconPath = $null }
        foreach ($definition in @(Get-BlockwrightJumpActionDefinitions)) {
            $spec = Get-BlockwrightJumpLaunchSpec -InstallRoot $ResolvedPluginRoot -Action ([string]$definition.Key)
            $jumpTask = [System.Windows.Shell.JumpTask]::new()
            $jumpTask.Title = [string]$spec.Title
            $jumpTask.Description = [string]$spec.Description
            $jumpTask.ApplicationPath = [string]$spec.ApplicationPath
            $jumpTask.Arguments = [string]$spec.Arguments
            $jumpTask.WorkingDirectory = [string]$spec.WorkingDirectory
            $jumpTask.CustomCategory = "Blockwright"
            $jumpTask.IconResourcePath = if ([string]::IsNullOrWhiteSpace($iconPath)) { [string]$spec.ApplicationPath } else { $iconPath }
            $jumpTask.IconResourceIndex = 0
            $jumpList.JumpItems.Add($jumpTask)
        }
        [System.Windows.Shell.JumpList]::SetJumpList($script:WpfApplication, $jumpList)
        $jumpList.Apply()
        $script:JumpList = $jumpList
    } catch {
        Add-ControllerLog "Windows Jump List actions are unavailable in this session. The tray and Control Center actions remain available."
    }
}

function Update-BlockwrightTaskbarState {
    if ($null -eq $script:TaskbarInfo) { return }
    $serverRunning = Test-ProcessRunning $script:ServerHandle
    $maintenanceRunning = Test-ProcessRunning $script:MaintenanceHandle
    $updateRunning = Test-ProcessRunning $script:UpdateHandle
    if ($null -ne $script:TaskAttentionUntil -and (Get-Date) -ge [datetime]$script:TaskAttentionUntil) {
        $script:TaskAttentionState = $null
        $script:TaskAttentionUntil = $null
    }
    $busy = $maintenanceRunning -or $updateRunning -or ($serverRunning -and -not $script:ServerReady) -or $null -ne $script:CrashRestartDueAt
    $failed = -not $serverRunning -and -not $busy -and $null -ne $script:LastExitCode -and [int]$script:LastExitCode -ne 0
    if ($busy) {
        $script:TaskbarInfo.ProgressState = [System.Windows.Shell.TaskbarItemProgressState]::Indeterminate
        $script:TaskbarInfo.ProgressValue = 0.5
    } elseif ([string]$script:TaskAttentionState -ceq "failed") {
        $script:TaskbarInfo.ProgressState = [System.Windows.Shell.TaskbarItemProgressState]::Error
        $script:TaskbarInfo.ProgressValue = 1.0
    } elseif ($null -ne $script:ActiveTaskSnapshot) {
        $completedUnits = $script:ActiveTaskSnapshot.progress.work.completedUnits
        $totalUnits = $script:ActiveTaskSnapshot.progress.work.totalUnits
        if ($null -ne $completedUnits -and $null -ne $totalUnits -and [double]$totalUnits -gt 0) {
            $script:TaskbarInfo.ProgressState = [System.Windows.Shell.TaskbarItemProgressState]::Normal
            $script:TaskbarInfo.ProgressValue = [math]::Max(0.0, [math]::Min(1.0, ([double]$completedUnits / [double]$totalUnits)))
        } else {
            $script:TaskbarInfo.ProgressState = [System.Windows.Shell.TaskbarItemProgressState]::Indeterminate
            $script:TaskbarInfo.ProgressValue = 0.5
        }
    } elseif ([string]$script:TaskAttentionState -ceq "completed") {
        $script:TaskbarInfo.ProgressState = [System.Windows.Shell.TaskbarItemProgressState]::Normal
        $script:TaskbarInfo.ProgressValue = 1.0
    } elseif ($failed) {
        $script:TaskbarInfo.ProgressState = [System.Windows.Shell.TaskbarItemProgressState]::Error
        $script:TaskbarInfo.ProgressValue = 1.0
    } else {
        $script:TaskbarInfo.ProgressState = [System.Windows.Shell.TaskbarItemProgressState]::None
        $script:TaskbarInfo.ProgressValue = 0.0
    }
}

function Show-BlockwrightWindow {
    if ($null -eq $window) { return }
    if (-not $window.IsVisible) { $window.Show() }
    $window.ShowInTaskbar = $true
    if ($window.WindowState -eq [System.Windows.WindowState]::Minimized) { $window.WindowState = [System.Windows.WindowState]::Normal }
    $null = $window.Activate()
    $window.Topmost = $true
    $window.Topmost = $false
    $window.Focus() | Out-Null
    $script:TaskAttentionState = $null
    $script:TaskAttentionUntil = $null
}

function Open-BlockwrightSettingsLocation {
    if (-not (Test-Path -LiteralPath $script:StateRoot -PathType Container)) { $null = New-Item -ItemType Directory -Path $script:StateRoot -Force }
    Start-Process explorer.exe -ArgumentList (Quote-NativeArgument $script:StateRoot)
}

function Prepare-BlockwrightSchematic {
    param([Parameter(Mandatory = $true)][string]$Path)
    $schematicPath = [System.IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $schematicPath -PathType Leaf) -or [System.IO.Path]::GetExtension($schematicPath) -ine ".schem") {
        throw "The associated .schem file is missing or invalid."
    }
    [System.Windows.Clipboard]::SetText($schematicPath)
    Add-ControllerLog "A validated schematic path was copied to the clipboard; use Import in the workbench to select it."
}

function Request-OpenBlockwrightWorkbench {
    if ((Test-ProcessRunning $script:ServerHandle) -and $script:ServerReady -and -not [string]::IsNullOrWhiteSpace($script:ServerBaseUrl)) {
        Start-Process $script:ServerBaseUrl
        return
    }
    $script:OpenWorkbenchPending = $true
    Show-BlockwrightWindow
    if (-not (Test-ProcessRunning $script:ServerHandle) -and -not (Test-ProcessRunning $script:MaintenanceHandle)) {
        try { Start-BlockwrightServer } catch {
            $script:OpenWorkbenchPending = $false
            Add-ControllerLog "The workbench could not be opened because Blockwright did not start: $($_.Exception.Message)"
            Show-BlockwrightSupervisorNotification -Key "workbench-start-failed" -Title "Blockwright could not start" -Message "Open Diagnostics for details." -Level Error
        }
    }
}

function Invoke-BlockwrightLaunchAction {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("activate", "new-build", "settings", "diagnostics", "open-schematic")][string]$Action,
        [string]$SchematicPath
    )
    switch ($Action) {
        "activate" { Show-BlockwrightWindow }
        "new-build" { Request-OpenBlockwrightWorkbench }
        "settings" { Show-BlockwrightWindow; Open-BlockwrightSettingsLocation }
        "diagnostics" { Show-BlockwrightWindow; $script:MainTabs.SelectedIndex = 0; Invoke-UiDiagnosticRefresh }
        "open-schematic" { Show-BlockwrightWindow; Prepare-BlockwrightSchematic -Path $SchematicPath }
    }
}

function Invoke-BlockwrightActivationMessage {
    param([Parameter(Mandatory = $true)][string]$Message)
    try {
        $activation = $Message | ConvertFrom-Json
        if ([int]$activation.schemaVersion -ne 1) { throw "Unsupported activation message version." }
        $action = [string]$activation.action
        if ($action -notin @("activate", "new-build", "settings", "diagnostics", "open-schematic")) { throw "Unsupported activation action." }
        Invoke-BlockwrightLaunchAction -Action $action -SchematicPath ([string]$activation.schematicPath)
    } catch {
        Add-ControllerLog "An activation request was rejected: $($_.Exception.Message)"
        Show-BlockwrightSupervisorNotification -Key "activation-rejected" -Title "Blockwright request rejected" -Message "The forwarded file or request was invalid." -Level Warning
    }
}

function Request-BlockwrightExit {
    if ((Test-ProcessRunning $script:UpdateHandle) -and $script:UpdateMode -eq "install") {
        Show-BlockwrightWindow
        [System.Windows.MessageBox]::Show("Wait for the verified update installation to finish before exiting the Control Center.", "Blockwright update in progress", "OK", "Information") | Out-Null
        return
    }
    $script:ExitRequested = $true
    Show-BlockwrightWindow
    $window.Close()
}

function Update-BlockwrightTrayState {
    if ($null -eq $script:NotifyIcon) { return }
    $serverRunning = Test-ProcessRunning $script:ServerHandle
    $maintenanceRunning = Test-ProcessRunning $script:MaintenanceHandle
    $updateRunning = Test-ProcessRunning $script:UpdateHandle
    $activeTaskState = if ($null -eq $script:ActiveTaskSnapshot) { $null } else { [string]$script:ActiveTaskSnapshot.state }
    $status = if ($maintenanceRunning) { "Runtime maintenance in progress" } elseif ($updateRunning) { "Update $($script:UpdateMode) in progress" } elseif ($activeTaskState) { "Task $activeTaskState" } elseif ($serverRunning -and $script:ServerReady) { "Running and verified" } elseif ($serverRunning) { "Starting / not verified" } elseif ($null -ne $script:CrashRestartDueAt) { "Restart scheduled" } else { "Stopped" }
    $script:TrayItems.Status.Text = "Status: $status"
    $script:TrayItems.Start.Enabled = (-not $serverRunning -and -not $maintenanceRunning)
    $script:TrayItems.Stop.Enabled = $serverRunning
    $script:TrayItems.Restart.Enabled = ($serverRunning -and -not $maintenanceRunning)
    $script:TrayItems.Update.Enabled = (-not $maintenanceRunning -and -not $updateRunning)
    $toolTip = "Blockwright - $status"
    if ($toolTip.Length -gt 63) { $toolTip = $toolTip.Substring(0, 63) }
    $script:NotifyIcon.Text = $toolTip
}

function Initialize-BlockwrightTrayIcon {
    $iconPath = Join-Path $ResolvedPluginRoot "assets\blockwright-v060.ico"
    if (-not (Test-Path -LiteralPath $iconPath -PathType Leaf)) {
        $iconPath = Join-Path $ResolvedPluginRoot "installer\windows\assets\blockwright-v060.ico"
    }
    if (Test-Path -LiteralPath $iconPath -PathType Leaf) {
        $sourceTrayIcon = New-Object System.Drawing.Icon($iconPath)
        try { $script:TrayIconResource = [System.Drawing.Icon]$sourceTrayIcon.Clone() } finally { $sourceTrayIcon.Dispose() }
        $trayIcon = $script:TrayIconResource
    } else {
        $trayIcon = [System.Drawing.SystemIcons]::Application
    }
    $script:TrayMenu = New-Object System.Windows.Forms.ContextMenuStrip
    $openItem = $script:TrayMenu.Items.Add("Open Blockwright")
    $newBuildItem = $script:TrayMenu.Items.Add("New build / Open workbench")
    $null = $script:TrayMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
    $statusItem = $script:TrayMenu.Items.Add("Status: Starting")
    $statusItem.Enabled = $false
    $startItem = $script:TrayMenu.Items.Add("Start")
    $stopItem = $script:TrayMenu.Items.Add("Stop")
    $restartItem = $script:TrayMenu.Items.Add("Restart")
    $null = $script:TrayMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
    $updateItem = $script:TrayMenu.Items.Add("Check for updates")
    $diagnosticsItem = $script:TrayMenu.Items.Add("Diagnostics")
    $stateItem = $script:TrayMenu.Items.Add("Settings / Open state location")
    $null = $script:TrayMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
    $exitItem = $script:TrayMenu.Items.Add("Exit")
    $script:TrayItems = @{ Status = $statusItem; Start = $startItem; Stop = $stopItem; Restart = $restartItem; Update = $updateItem }

    $openItem.Add_Click({ Show-BlockwrightWindow })
    $newBuildItem.Add_Click({ Request-OpenBlockwrightWorkbench })
    $startItem.Add_Click({
        try { Start-BlockwrightServer; Update-UiState } catch {
            Add-ControllerLog "Tray start failed: $($_.Exception.Message)"
            Show-BlockwrightSupervisorNotification -Key "tray-start-failed" -Title "Blockwright could not start" -Message "Open Diagnostics for details." -Level Error
        }
    })
    $stopItem.Add_Click({ try { Stop-BlockwrightServer; Update-UiState } catch { Add-ControllerLog "Tray stop failed: $($_.Exception.Message)" } })
    $restartItem.Add_Click({
        try { Stop-BlockwrightServer; Start-BlockwrightServer; Update-UiState } catch {
            Add-ControllerLog "Tray restart failed: $($_.Exception.Message)"
            Show-BlockwrightSupervisorNotification -Key "tray-restart-failed" -Title "Blockwright could not restart" -Message "Open Diagnostics for details." -Level Error
        }
    })
    $updateItem.Add_Click({
        try { Start-BlockwrightUpdateProcess -Mode "check"; Update-UiState } catch {
            Add-ControllerLog "Tray update check could not start: $($_.Exception.Message)"
            Show-BlockwrightSupervisorNotification -Key "tray-update-failed" -Title "Update check could not start" -Message "Open the Control Center for details." -Level Error
        }
    })
    $diagnosticsItem.Add_Click({ Show-BlockwrightWindow; $script:MainTabs.SelectedIndex = 0; Invoke-UiDiagnosticRefresh })
    $stateItem.Add_Click({ Open-BlockwrightSettingsLocation })
    $exitItem.Add_Click({ Request-BlockwrightExit })

    $script:NotifyIcon = New-Object System.Windows.Forms.NotifyIcon
    $script:NotifyIcon.Icon = $trayIcon
    $script:NotifyIcon.ContextMenuStrip = $script:TrayMenu
    $script:NotifyIcon.Visible = $true
    $script:NotifyIcon.Text = "Blockwright Control Center"
    $script:NotifyIcon.Add_DoubleClick({ Show-BlockwrightWindow })
    $script:NotifyIcon.Add_BalloonTipClicked({ Show-BlockwrightWindow })
    Update-BlockwrightTrayState
}

function Update-UiState {
    if ($interactiveSupervisor) {
        $activationMessage = Receive-BlockwrightActivationMessage -PipeName $script:SupervisorIdentity.PipeName
        if (-not [string]::IsNullOrWhiteSpace($activationMessage)) { Invoke-BlockwrightActivationMessage -Message $activationMessage }
    }
    Complete-ExitedProcesses
    Complete-BlockwrightTaskPoll
    Invoke-PendingCrashRestart
    if (-not [string]::IsNullOrWhiteSpace($script:PersistentLogFailure) -and -not $script:PersistentLogFailureNotified) {
        $script:PersistentLogFailureNotified = $true
        Show-BlockwrightSupervisorNotification -Key "persistent-log-failed" -Title "Blockwright logging needs attention" -Message "Persistent logging is unavailable; visible logs remain in the Control Center." -Level Warning -ThrottleSeconds 300
    } elseif ([string]::IsNullOrWhiteSpace($script:PersistentLogFailure)) {
        $script:PersistentLogFailureNotified = $false
    }
    if (Test-ProcessRunning $script:ServerHandle) {
        $null = Drain-ProcessLogs -Handle $script:ServerHandle
        Update-CapturedProcessTreeSnapshot -Handle $script:ServerHandle
        Update-EndpointDiscovery
    }
    if (Test-ProcessRunning $script:MaintenanceHandle) {
        $null = Drain-ProcessLogs -Handle $script:MaintenanceHandle
    }

    $serverRunning = Test-ProcessRunning $script:ServerHandle
    $maintenanceRunning = Test-ProcessRunning $script:MaintenanceHandle
    $updateRunning = Test-ProcessRunning $script:UpdateHandle
    $endpointHealthy = $serverRunning -and -not [string]::IsNullOrWhiteSpace($script:ServerBaseUrl) -and $script:ServerReady
    if ($endpointHealthy) { Start-BlockwrightTaskPoll }
    if ($endpointHealthy -and $script:OpenWorkbenchPending) {
        $script:OpenWorkbenchPending = $false
        try { Start-Process $script:ServerBaseUrl } catch { Add-ControllerLog "The verified local workbench could not be opened: $($_.Exception.Message)" }
    }

    $script:StartButton.IsEnabled = (-not $serverRunning -and -not $maintenanceRunning)
    $script:StopButton.IsEnabled = $serverRunning
    $script:RestartButton.IsEnabled = ($serverRunning -and -not $maintenanceRunning)
    $script:InstallButton.IsEnabled = (-not $serverRunning -and -not $maintenanceRunning -and -not $updateRunning)
    $script:UpdateButton.IsEnabled = (-not $maintenanceRunning -and -not $updateRunning)
    $script:OpenEndpointButton.IsEnabled = $endpointHealthy

    if ($maintenanceRunning) {
        $script:ServerStateText.Text = "Maintaining runtime"
        $script:ServerStateDetailText.Text = "Dependency repair is running under the shared lock"
        $script:StatusDot.Fill = Get-StatusBrush "STARTING"
    } elseif ($endpointHealthy) {
        $script:ServerStateText.Text = "Running"
        if ([string]::IsNullOrWhiteSpace($script:ServerHealthDetail)) {
            $script:ServerStateDetailText.Text = "Ready check HTTP $script:ServerHttpStatus"
        } else {
            $script:ServerStateDetailText.Text = "Ready check HTTP $script:ServerHttpStatus | $script:ServerHealthDetail"
        }
        $script:StatusDot.Fill = Get-StatusBrush "RUNNING"
    } elseif ($serverRunning) {
        if ($null -ne $script:ServerHttpStatus -and -not [string]::IsNullOrWhiteSpace($script:ServerHealthDetail)) {
            $script:ServerStateText.Text = "Not verified"
            $script:ServerStateDetailText.Text = "Readiness HTTP $script:ServerHttpStatus | $script:ServerHealthDetail"
        } else {
            $script:ServerStateText.Text = "Starting"
            $script:ServerStateDetailText.Text = "Waiting for the local endpoint"
        }
        $script:StatusDot.Fill = Get-StatusBrush "STARTING"
    } else {
        $script:ServerStateText.Text = "Stopped"
        $script:ServerStateDetailText.Text = "No managed process"
        $script:StatusDot.Fill = Get-StatusBrush "STOPPED"
    }

    if ($serverRunning) {
        $script:PidText.Text = [string]$script:ServerHandle.Process.Id
        $elapsed = (Get-Date) - $script:ServerStartedAt
        $script:UptimeText.Text = "{0:00}:{1:00}:{2:00}" -f [int]$elapsed.TotalHours, $elapsed.Minutes, $elapsed.Seconds
    } else {
        $script:PidText.Text = "--"
        $script:UptimeText.Text = "--"
    }
    if ($serverRunning -and -not [string]::IsNullOrWhiteSpace($script:ServerBaseUrl)) {
        $script:EndpointText.Text = "$($script:ServerBaseUrl)/mcp"
        if ($endpointHealthy) { $script:EndpointText.Foreground = Get-StatusBrush "PASS" } else { $script:EndpointText.Foreground = Get-StatusBrush "WARN" }
    } else {
        $script:EndpointText.Text = "Not detected"
        $script:EndpointText.Foreground = Get-StatusBrush "INFO"
    }
    if ($null -eq $script:LastExitCode) { $script:ExitCodeText.Text = "--" } else { $script:ExitCodeText.Text = [string]$script:LastExitCode }

    if (((Get-Date) - $script:LastDiagnosticRefresh).TotalSeconds -ge 30 -and -not $maintenanceRunning) {
        Invoke-UiDiagnosticRefresh
    }
    Update-BlockwrightTaskbarState
    Update-BlockwrightTrayState
}

$script:StartButton.Add_Click({
    try {
        Start-BlockwrightServer
        $script:MainTabs.SelectedIndex = 1
        Update-UiState
    } catch {
        Add-ControllerLog "Start failed: $($_.Exception.Message)"
        [System.Windows.MessageBox]::Show($_.Exception.Message, "Blockwright could not start", "OK", "Error") | Out-Null
    }
})
$script:StopButton.Add_Click({ try { Stop-BlockwrightServer; Update-UiState } catch { Add-ControllerLog "Stop failed: $($_.Exception.Message)" } })
$script:RestartButton.Add_Click({
    try {
        Stop-BlockwrightServer
        Start-BlockwrightServer
        $script:MainTabs.SelectedIndex = 1
        Update-UiState
    } catch {
        Add-ControllerLog "Restart failed: $($_.Exception.Message)"
        [System.Windows.MessageBox]::Show($_.Exception.Message, "Blockwright could not restart", "OK", "Error") | Out-Null
    }
})
$script:InstallButton.Add_Click({
    try {
        Start-DependencyMaintenance
        $script:MainTabs.SelectedIndex = 1
        Update-UiState
    } catch {
        Add-ControllerLog "Dependency maintenance failed to start: $($_.Exception.Message)"
        [System.Windows.MessageBox]::Show($_.Exception.Message, "Runtime maintenance", "OK", "Error") | Out-Null
    }
})
$script:RefreshButton.Add_Click({ Invoke-UiDiagnosticRefresh })
$script:UpdateButton.Add_Click({
    try {
        Start-BlockwrightUpdateProcess -Mode "check"
        $script:MainTabs.SelectedIndex = 1
        Update-UiState
    } catch {
        Add-ControllerLog "Update check could not start: $($_.Exception.Message)"
        [System.Windows.MessageBox]::Show($_.Exception.Message, "Blockwright updates", "OK", "Error") | Out-Null
    }
})
$script:OpenEndpointButton.Add_Click({
    if (-not [string]::IsNullOrWhiteSpace($script:ServerBaseUrl)) {
        Start-Process $script:ServerBaseUrl
    }
})
$script:OpenFolderButton.Add_Click({ Start-Process explorer.exe -ArgumentList (Quote-NativeArgument $ResolvedPluginRoot) })
$script:ClearLogsButton.Add_Click({ $script:LogBox.Clear(); Add-ControllerLog "Log view cleared." })
$script:CopyLogsButton.Add_Click({ if (-not [string]::IsNullOrWhiteSpace($script:LogBox.Text)) { [System.Windows.Clipboard]::SetText($script:LogBox.Text) } })
$script:CopyDiagnosticsButton.Add_Click({
    if ($null -ne $script:CurrentDiagnostics) {
        $copyObject = [ordered]@{
            controllerVersion = $ControllerVersion
            generatedAt = (Get-Date).ToUniversalTime().ToString("o")
            pluginRoot = $ResolvedPluginRoot
            status = $script:CurrentDiagnostics.Status
            counts = $script:CurrentDiagnostics.Counts
            checks = $script:CurrentDiagnostics.Checks
            raw = $script:CurrentDiagnostics.Raw
        }
        [System.Windows.Clipboard]::SetText(($copyObject | ConvertTo-Json -Depth 20))
        Add-ControllerLog "Diagnostics copied to the clipboard."
    }
})
$script:SaveLogsButton.Add_Click({
    $dialog = New-Object Microsoft.Win32.SaveFileDialog
    $dialog.Title = "Save Blockwright log"
    $dialog.Filter = "Log files (*.log)|*.log|Text files (*.txt)|*.txt|All files (*.*)|*.*"
    $dialog.FileName = "blockwright-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss")
    if ($dialog.ShowDialog()) {
        [System.IO.File]::WriteAllText($dialog.FileName, $script:LogBox.Text, (New-Object System.Text.UTF8Encoding($false)))
        Add-ControllerLog "Saved the visible log to $($dialog.FileName)."
    }
})

if (-not [string]::IsNullOrWhiteSpace($CaptureUiPath)) {
    $capturePath = [System.IO.Path]::GetFullPath($CaptureUiPath)
    if ([System.IO.Path]::GetExtension($capturePath) -ne ".png") { throw "Control Center UI capture output must be a .png file." }
    $captureParent = Split-Path -Parent $capturePath
    if (-not (Test-Path -LiteralPath $captureParent -PathType Container)) { $null = New-Item -ItemType Directory -Path $captureParent -Force }
    $script:RootText.Text = "Render-only preview | stopped | no server or update operation started"
    Invoke-UiDiagnosticRefresh
    Update-UiState
    $script:DiagnosticsGrid.Columns[3].Width = New-Object System.Windows.Controls.DataGridLength(440)
    $script:DiagnosticsGrid.Columns[4].Width = New-Object System.Windows.Controls.DataGridLength(260)
    $captureSize = New-Object System.Windows.Size(1180, 760)
    $captureVisual = $window.Content
    $captureVisual.Measure($captureSize)
    $captureVisual.Arrange((New-Object System.Windows.Rect(0, 0, 1180, 760)))
    $captureVisual.UpdateLayout()
    $bitmap = New-Object System.Windows.Media.Imaging.RenderTargetBitmap(1180, 760, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
    $bitmap.Render($captureVisual)
    $encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
    $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $captureStream = [System.IO.File]::Open($capturePath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try { $encoder.Save($captureStream) } finally { $captureStream.Dispose() }
    Write-Output $capturePath
    $window.Close()
    exit 0
}

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(750)
$timer.Add_Tick({ Update-UiState })
if ($interactiveSupervisor) {
    Initialize-BlockwrightJumpList
    Initialize-BlockwrightTrayIcon
}
$script:StartHidden = $interactiveSupervisor -and $StartMinimized -and -not $script:RequestedActivation.Explicit
if ($script:StartHidden) {
    $window.ShowActivated = $false
    $window.ShowInTaskbar = $false
    $window.WindowState = [System.Windows.WindowState]::Minimized
}

$window.Add_ContentRendered({
    Add-ControllerLog "Control Center $ControllerVersion is ready."
    Add-ControllerLog "Persistent sanitized logs: $script:PersistentLogPath (up to $script:PersistentLogArchiveCount rotating archives)."
    Invoke-UiDiagnosticRefresh
    Update-UiState
    $timer.Start()
    if ($script:RequestedActivation.Explicit) {
        try { Invoke-BlockwrightLaunchAction -Action $script:RequestedActivation.Action -SchematicPath $OpenSchematic } catch {
            Add-ControllerLog "The requested Blockwright launch action could not be completed. Open the Control Center for details."
            Show-BlockwrightSupervisorNotification -Key "initial-action-failed" -Title "Blockwright request could not be completed" -Message "Open the Control Center for details." -Level Warning
        }
    }
    if ($script:StartHidden) {
        try {
            if (-not (Test-ProcessRunning $script:ServerHandle)) { Start-BlockwrightServer }
            Add-ControllerLog "Background startup mode is active; the owned engine will remain available from the tray."
        } catch {
            Add-ControllerLog "Background startup could not start the owned engine: $($_.Exception.Message)"
            Show-BlockwrightSupervisorNotification -Key "background-start-failed" -Title "Blockwright could not start" -Message "Open Diagnostics from the tray for details." -Level Error
        }
        $window.WindowState = [System.Windows.WindowState]::Normal
        $window.Hide()
    }
})
$window.Add_Closing({
    param($sender, $eventArgs)
    if (-not $script:ExitRequested) {
        $eventArgs.Cancel = $true
        $window.ShowInTaskbar = $false
        $window.Hide()
        if (-not $script:HideToTrayNoticeShown) {
            $script:HideToTrayNoticeShown = $true
            Show-BlockwrightSupervisorNotification -Key "close-to-tray" -Title "Blockwright is still running" -Message "Use the tray icon to reopen it or choose Exit to stop the owned server." -Level Info -ThrottleSeconds 3600
        }
        return
    }
    if (Test-ProcessRunning $script:UpdateHandle) {
        if ($script:UpdateMode -eq "install") {
            $eventArgs.Cancel = $true
            $script:ExitRequested = $false
            [System.Windows.MessageBox]::Show("Wait for the verified update installation to finish before exiting the Control Center.", "Blockwright update in progress", "OK", "Information") | Out-Null
            return
        }
        Add-ControllerLog "Stopping the in-progress update check before exit..."
        try { Stop-CapturedProcessTree -Handle $script:UpdateHandle -GraceMilliseconds 1500 } catch {
            $eventArgs.Cancel = $true
            $script:ExitRequested = $false
            Add-ControllerLog "Exit was cancelled because update-check cleanup could not be confirmed: $($_.Exception.Message)"
            return
        }
    }
    $timer.Stop()
    $script:AutoRestartEligible = $false
    $script:CrashRestartDueAt = $null
    if (Test-ProcessRunning $script:MaintenanceHandle) {
        Add-ControllerLog "Stopping dependency maintenance before exit..."
        try { Stop-CapturedProcessTree -Handle $script:MaintenanceHandle -GraceMilliseconds 1500 } catch {
            $eventArgs.Cancel = $true
            $script:ExitRequested = $false
            $timer.Start()
            Add-ControllerLog "Exit was cancelled because dependency-maintenance cleanup could not be confirmed: $($_.Exception.Message)"
            return
        }
    }
    if (Test-ProcessRunning $script:ServerHandle) {
        try { Stop-BlockwrightServer } catch {
            $eventArgs.Cancel = $true
            $script:ExitRequested = $false
            $timer.Start()
            Add-ControllerLog "Exit was cancelled because the owned server could not be confirmed stopped: $($_.Exception.Message)"
            [System.Windows.MessageBox]::Show("Blockwright did not exit because its owned server could not be confirmed stopped. See Live logs for details.", "Blockwright still running", "OK", "Error") | Out-Null
            return
        }
    }
})

try {
    $null = $window.ShowDialog()
} finally {
    Reset-BlockwrightTaskMonitor
    Stop-BlockwrightActivationListener
    if ($null -ne $script:NotifyIcon) { try { $script:NotifyIcon.Visible = $false; $script:NotifyIcon.Dispose() } catch {} }
    if ($null -ne $script:TrayMenu) { try { $script:TrayMenu.Dispose() } catch {} }
    if ($null -ne $script:TrayIconResource) { try { $script:TrayIconResource.Dispose() } catch {} }
    if ($script:SupervisorMutexOwned -and $null -ne $script:SupervisorMutex) { try { $script:SupervisorMutex.ReleaseMutex() } catch {} }
    if ($null -ne $script:SupervisorMutex) { try { $script:SupervisorMutex.Dispose() } catch {} }
    if ($script:OwnsWpfApplication -and $null -ne $script:WpfApplication) { try { $script:WpfApplication.Shutdown() } catch {} }
}
