[CmdletBinding()]
param(
    [string]$PluginRoot,
    [switch]$Diagnostics,
    [switch]$Json,
    [switch]$ValidateUi,
    [switch]$SmokeTest,
    [string]$CaptureUiPath,
    [string]$OpenSchematic,
    [ValidateRange(1024, 65535)]
    [int]$Port = 32147,
    [ValidateRange(5, 180)]
    [int]$SmokeTestSeconds = 30
)

$ErrorActionPreference = "Stop"

$ControllerVersion = "1.0.0"
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
if (-not $PSBoundParameters.ContainsKey("Port")) {
    $Port = [int](Get-BlockwrightConfiguration -InstallRoot $ResolvedPluginRoot -StateRoot $script:StateRoot).port
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
    Push-Location $appRoot
    try {
        $npmOutput = @(& $npmPath ls --omit=dev --depth=0 --json 2>&1)
        $npmExitCode = $LASTEXITCODE
    } finally {
        Pop-Location
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
$script:CurrentDiagnostics = $null
$script:UiReady = $false
$script:StartAfterMaintenance = $false
$script:AutomaticStartFailure = $null
$script:ManagedToken = [guid]::NewGuid().ToString("N")
$script:ExpectedServerStop = $false
$script:LocalMcpToken = $null
$script:ManagedRecordPath = Get-BlockwrightManagedRecordPath -InstallRoot $ResolvedPluginRoot -StateRoot $script:StateRoot
$script:UpdateCheckPath = Join-Path $script:StateRoot "updates\last-check.json"
$script:UpdateFailurePath = Join-Path $script:StateRoot "updates\last-failure.json"
$script:UpdateSuccessPath = Join-Path $script:StateRoot "updates\last-success.json"

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

function Write-CrashRecord {
    param([object]$ExitCode)
    $crashRoot = Join-Path $script:StateRoot "crashes"
    $null = New-Item -ItemType Directory -Path $crashRoot -Force
    $record = [ordered]@{
        schemaVersion = 1
        recordedAt = [datetimeoffset]::UtcNow.ToString("o")
        version = Get-ExpectedAppVersion
        exitCode = $ExitCode
        port = $Port
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
    return [pscustomobject]@{ Process = $process; Pump = $pump; Label = $Label }
}

function Add-ControllerLog {
    param([string]$Message)
    $line = "[{0:HH:mm:ss.fff}] [control] {1}" -f (Get-Date), $Message
    if ($script:UiReady -and $null -ne $script:LogBox) {
        $script:LogBox.AppendText($line + [Environment]::NewLine)
        $script:LogBox.ScrollToEnd()
    } else {
        Write-Verbose $line
    }
}

function Add-ProcessLogLine {
    param([string]$Line)
    if ($Line -match '(https?://(?:127\.0\.0\.1|localhost):\d+)') {
        $script:ServerBaseUrl = $Matches[1].Replace("localhost", "127.0.0.1")
    }
    if ($script:UiReady -and $null -ne $script:LogBox) {
        $script:LogBox.AppendText($Line + [Environment]::NewLine)
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
        $lines.Add($line)
        Add-ProcessLogLine -Line $line
    }
    return @($lines)
}

function Test-ProcessRunning {
    param([object]$Handle)
    if ($null -eq $Handle -or $null -eq $Handle.Process) { return $false }
    try { return -not $Handle.Process.HasExited } catch { return $false }
}

function Start-BlockwrightServer {
    param([switch]$NoAutomaticRepair)
    if (Test-ProcessRunning $script:ServerHandle) {
        Add-ControllerLog "The server is already running."
        return
    }
    if (Test-ProcessRunning $script:MaintenanceHandle) {
        throw "Wait for dependency maintenance to finish before starting the server."
    }
    $script:AutomaticStartFailure = $null

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
        Start-DependencyMaintenance -StartServerAfter
        return
    }
    Add-ControllerLog $dependencyStatus.Message

    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
    } catch {
        throw "Local port $Port is already in use. Stop the other service or launch this controller with -Port and another available port."
    } finally {
        if ($null -ne $listener) { try { $listener.Stop() } catch {} }
    }

    $dataRoot = Join-Path $appRoot "data\java"
    $script:ServerBaseUrl = "http://127.0.0.1:$Port"
    $script:ServerHttpStatus = $null
    $script:ServerReady = $false
    $script:ServerIdentityVerified = $false
    $script:ServerHealthDetail = $null
    $script:ServerIdentityDetail = $null
    $script:ServerReadinessDetail = $null
    $script:LastHealthScan = [datetime]::MinValue
    $script:LastExitCode = $null
    $script:ServerStartedAt = Get-Date
    $entryArguments = Quote-NativeArgument $entryPath
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
        throw
    }
    $script:ExpectedServerStop = $false
    Write-ManagedServerRecord
    Add-ControllerLog "Production entry: $entryPath (NODE_ENV=production, __PORT=$Port, PORT=$Port)."
    Add-ControllerLog "Started the standalone Blockwright HTTP/MCP server on 127.0.0.1:$Port (PID $($script:ServerHandle.Process.Id)). Codex-managed session servers are separate."
}

function Stop-CapturedProcessTree {
    param(
        [object]$Handle,
        [int]$GraceMilliseconds = 3500
    )
    if (-not (Test-ProcessRunning $Handle)) { return }
    $managedProcess = $Handle.Process
    $managedProcessId = $managedProcess.Id
    try { $managedProcess.StandardInput.Close() } catch {}
    try { $null = $managedProcess.WaitForExit($GraceMilliseconds) } catch {}
    if (-not $managedProcess.HasExited) {
        $taskKillPath = Join-Path $env:SystemRoot "System32\taskkill.exe"
        $taskKillInfo = New-Object System.Diagnostics.ProcessStartInfo
        $taskKillInfo.FileName = $taskKillPath
        $taskKillInfo.Arguments = "/PID $managedProcessId /T /F"
        $taskKillInfo.UseShellExecute = $false
        $taskKillInfo.CreateNoWindow = $true
        $taskKillInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
        $taskKillProcess = [System.Diagnostics.Process]::Start($taskKillInfo)
        $null = $taskKillProcess.WaitForExit(5000)
        $taskKillProcess.Dispose()
    }
}

function Stop-BlockwrightServer {
    if (-not (Test-ProcessRunning $script:ServerHandle)) {
        $script:LocalMcpToken = $null
        Add-ControllerLog "The server is already stopped."
        return
    }
    $stoppedProcessId = $script:ServerHandle.Process.Id
    $script:ExpectedServerStop = $true
    Add-ControllerLog "Stopping Blockwright PID $stoppedProcessId and its managed worker..."
    Stop-CapturedProcessTree -Handle $script:ServerHandle
    $null = Drain-ProcessLogs -Handle $script:ServerHandle
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
    Remove-ManagedServerRecord
    Add-ControllerLog "Blockwright stopped."
}

function Start-DependencyMaintenance {
    param([switch]$StartServerAfter)
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
    $script:MaintenanceHandle = New-CapturedProcess -FileName $windowsPowerShell -Arguments $repairArguments -WorkingDirectory $ResolvedPluginRoot -Label "dependencies"
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
    $knownIds = New-Object 'System.Collections.Generic.List[int]'
    $knownIds.Add($rootProcessId)
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
    return @($knownIds)
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
        [ValidateRange(1024, 131072)][int]$MaximumCharacters = 32768
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

function Complete-ExitedProcesses {
    if ($null -ne $script:ServerHandle) {
        $null = Drain-ProcessLogs -Handle $script:ServerHandle
        if (-not (Test-ProcessRunning $script:ServerHandle)) {
            try { $script:LastExitCode = $script:ServerHandle.Process.ExitCode } catch {}
            Add-ControllerLog "The server process exited with code $script:LastExitCode."
            if (-not $script:ExpectedServerStop) { Write-CrashRecord -ExitCode $script:LastExitCode }
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
            $script:LocalMcpToken = $null
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
            $script:StartAfterMaintenance = $false
            Add-ControllerLog "Dependency maintenance finished with exit code $maintenanceExitCode."
            if ($script:UiReady) { Invoke-UiDiagnosticRefresh }
            if ($maintenanceExitCode -eq 0 -and $startAfterMaintenance) {
                try {
                    Start-BlockwrightServer -NoAutomaticRepair
                } catch {
                    $script:AutomaticStartFailure = $_.Exception.Message
                    Add-ControllerLog "Automatic start after dependency maintenance failed: $script:AutomaticStartFailure"
                }
            } elseif ($maintenanceExitCode -ne 0 -and $startAfterMaintenance) {
                Add-ControllerLog "The server was not started because dependency maintenance failed."
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
                if ($script:UiReady) { [System.Windows.MessageBox]::Show("The verified Blockwright update installed successfully. Close and reopen the Control Center to load the new version.", "Blockwright update installed", "OK", "Information") | Out-Null }
            } else {
                $failure = Get-UpdateReportMessage -Path $script:UpdateFailurePath -Fallback "Update $completedMode exited with code $updateExitCode."
                Add-ControllerLog "Update $completedMode failed: $failure"
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
                $healthy = $true
                $smokeEndpoint = "$($script:ServerBaseUrl)/mcp"
                $smokeHttpStatus = $script:ServerHttpStatus
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

Add-Type -AssemblyName PresentationCore, PresentationFramework, WindowsBase

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
      <TextBlock Text="Closing this window stops only the server process started here." Foreground="#9EB0A2" FontSize="11" DockPanel.Dock="Right" HorizontalAlignment="Right"/>
    </DockPanel>
  </Grid>
</Window>
'@

$xmlReader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
$window = [Windows.Markup.XamlReader]::Load($xmlReader)
$windowIconPath = Join-Path $ResolvedPluginRoot "assets\blockwright-icon-v060.png"
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

function Update-UiState {
    Complete-ExitedProcesses
    if (Test-ProcessRunning $script:ServerHandle) {
        $null = Drain-ProcessLogs -Handle $script:ServerHandle
        Update-EndpointDiscovery
    }
    if (Test-ProcessRunning $script:MaintenanceHandle) {
        $null = Drain-ProcessLogs -Handle $script:MaintenanceHandle
    }

    $serverRunning = Test-ProcessRunning $script:ServerHandle
    $maintenanceRunning = Test-ProcessRunning $script:MaintenanceHandle
    $updateRunning = Test-ProcessRunning $script:UpdateHandle
    $endpointHealthy = $serverRunning -and -not [string]::IsNullOrWhiteSpace($script:ServerBaseUrl) -and $script:ServerReady

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

$window.Add_ContentRendered({
    Add-ControllerLog "Control Center $ControllerVersion is ready."
    if (-not [string]::IsNullOrWhiteSpace($OpenSchematic)) {
        try {
            $schematicPath = [System.IO.Path]::GetFullPath($OpenSchematic)
            if (-not (Test-Path -LiteralPath $schematicPath -PathType Leaf) -or [System.IO.Path]::GetExtension($schematicPath) -ne ".schem") { throw "The associated .schem file is missing or invalid." }
            [System.Windows.Clipboard]::SetText($schematicPath)
            Add-ControllerLog "Schematic selected: $schematicPath. Its path was copied to the clipboard; use Import in the workbench to select it."
        } catch { Add-ControllerLog "Associated schematic could not be prepared: $($_.Exception.Message)" }
    }
    Invoke-UiDiagnosticRefresh
    Update-UiState
    $timer.Start()
})
$window.Add_Closing({
    param($sender, $eventArgs)
    if (Test-ProcessRunning $script:UpdateHandle) {
        if ($script:UpdateMode -eq "install") {
            $eventArgs.Cancel = $true
            [System.Windows.MessageBox]::Show("Wait for the verified update installation to finish before closing the Control Center.", "Blockwright update in progress", "OK", "Information") | Out-Null
            return
        }
        Add-ControllerLog "Stopping the in-progress update check before closing..."
        Stop-CapturedProcessTree -Handle $script:UpdateHandle -GraceMilliseconds 1500
    }
    $timer.Stop()
    if (Test-ProcessRunning $script:MaintenanceHandle) {
        Add-ControllerLog "Stopping dependency maintenance before closing..."
        Stop-CapturedProcessTree -Handle $script:MaintenanceHandle -GraceMilliseconds 1500
    }
    if (Test-ProcessRunning $script:ServerHandle) {
        Stop-BlockwrightServer
    }
})

$null = $window.ShowDialog()
