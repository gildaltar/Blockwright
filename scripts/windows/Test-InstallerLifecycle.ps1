[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$CurrentInstaller,
    [string]$PreviousInstaller,
    [string]$TestRoot,
    [switch]$TestCodexIntegration,
    [ValidateRange(20, 180)][int]$SmokeTestSeconds = 60
)

$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") { throw "Installer lifecycle tests require Windows." }
$deleteTestRoot = [string]::IsNullOrWhiteSpace($TestRoot)
if ($deleteTestRoot) { $TestRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("Blockwright Installer Lifecycle " + [guid]::NewGuid().ToString("N")) }
$resolvedTestRoot = [System.IO.Path]::GetFullPath($TestRoot)
$installRoot = Join-Path $resolvedTestRoot "installed app"
$stateRoot = Join-Path $resolvedTestRoot "state"
$logRoot = Join-Path $resolvedTestRoot "logs"
$uninstallRegistrationKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{2D75D5A7-BC78-4BBE-B0BC-5B8D0366C4B4}_is1"
$previousStateRoot = $env:BLOCKWRIGHT_STATE_ROOT
$previousAppData = $env:APPDATA
$previousInstallerTestStateRoot = $env:BLOCKWRIGHT_INSTALLER_TEST_STATE_ROOT
$previousInstallerTestRoamingRoot = $env:BLOCKWRIGHT_INSTALLER_TEST_ROAMING_ROOT
$windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$codexProbePath = Join-Path $resolvedTestRoot "Probe-BlockwrightCodex.ps1"
$installerInvocationCount = 0
$uninstallerInvocationCount = 0
$lifecycleSucceeded = $false

function Quote-NativeArgument {
    param([Parameter(Mandatory = $true)][string]$Value)
    return '"' + $Value.Replace('"', '\"') + '"'
}

function Invoke-NativeProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FileName,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [ValidateRange(1000, 600000)][int]$TimeoutMilliseconds = 120000
    )
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FileName
    $startInfo.Arguments = (@($Arguments | ForEach-Object { Quote-NativeArgument -Value ([string]$_) }) -join " ")
    $startInfo.WorkingDirectory = $resolvedTestRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw "Could not start $FileName." }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutMilliseconds)) {
        try { $process.Kill() } catch {}
        throw "$FileName exceeded the $TimeoutMilliseconds ms lifecycle-test limit."
    }
    $result = [pscustomobject]@{
        ExitCode = $process.ExitCode
        StandardOutput = $stdoutTask.Result
        StandardError = $stderrTask.Result
    }
    $process.Dispose()
    return $result
}

function Initialize-CodexProbe {
    $probeSource = @'
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Name)
$ErrorActionPreference = "Continue"
$previousLastExitCode = $global:LASTEXITCODE
try {
    $command = Get-Command codex -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $command) {
        $result = [ordered]@{ started = $false; exitCode = $null; output = @(); failure = "Codex CLI was not found." }
    } else {
        $global:LASTEXITCODE = $null
        $output = @(& $command.Source mcp get $Name --json 2>&1)
        $nativeExitCode = $global:LASTEXITCODE
        $result = [ordered]@{
            started = ($null -ne $nativeExitCode)
            exitCode = if ($null -eq $nativeExitCode) { $null } else { [int]$nativeExitCode }
            output = @($output | ForEach-Object { [string]$_ })
            failure = $null
        }
    }
} catch {
    $result = [ordered]@{ started = $false; exitCode = $null; output = @(); failure = $_.Exception.Message }
} finally {
    $global:LASTEXITCODE = $previousLastExitCode
}
$result | ConvertTo-Json -Depth 5 -Compress
'@
    [System.IO.File]::WriteAllText($codexProbePath, $probeSource, (New-Object System.Text.UTF8Encoding($false)))
}

function Invoke-CodexProbe {
    $probe = Invoke-NativeProcess -FileName $windowsPowerShell -Arguments @(
        "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", $codexProbePath, "-Name", "blockwright-local"
    )
    if ($probe.ExitCode -ne 0) { throw "Codex lifecycle probe failed with exit $($probe.ExitCode). $($probe.StandardOutput) $($probe.StandardError)" }
    try { return $probe.StandardOutput | ConvertFrom-Json } catch { throw "Codex lifecycle probe did not return machine-readable JSON. $($probe.StandardOutput)" }
}

function Assert-CodexConfigurationAbsent {
    param([Parameter(Mandatory = $true)][string]$Operation)
    $probe = Invoke-CodexProbe
    $detail = (@($probe.output | ForEach-Object { [string]$_ }) -join " ").Trim()
    $expectedNotFound = [bool]$probe.started -and [int]$probe.exitCode -eq 1 -and
        $detail.IndexOf("No MCP server named", [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $detail.IndexOf("blockwright-local", [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $detail.IndexOf("found", [StringComparison]::OrdinalIgnoreCase) -ge 0
    if (-not $expectedNotFound) { throw "$Operation did not leave blockwright-local absent. Exit=$($probe.exitCode) Failure=$($probe.failure) Output=$detail" }
}

function Assert-CodexConfigurationPresent {
    param([Parameter(Mandatory = $true)][string]$Operation)
    $probe = Invoke-CodexProbe
    if (-not [bool]$probe.started -or [int]$probe.exitCode -ne 0) {
        throw "$Operation did not leave a readable blockwright-local entry. Exit=$($probe.exitCode) Failure=$($probe.failure) Output=$(@($probe.output) -join ' ')"
    }
    try { $configuration = (@($probe.output) -join [Environment]::NewLine) | ConvertFrom-Json } catch { throw "$Operation returned unreadable blockwright-local JSON." }
    $expectedCommand = Join-Path $env:SystemRoot "System32\cmd.exe"
    $expectedArguments = @("/d", "/s", "/c", (Join-Path $installRoot "scripts\windows\Launch-Blockwright-Mcp.cmd"))
    $actualArguments = @($configuration.transport.args | ForEach-Object { [string]$_ })
    $argumentsMatch = $actualArguments.Count -eq $expectedArguments.Count -and
        (($actualArguments -join "`0").Equals(($expectedArguments -join "`0"), [StringComparison]::OrdinalIgnoreCase))
    if ([string]$configuration.transport.type -cne "stdio" -or
        -not ([string]$configuration.transport.command).Equals($expectedCommand, [StringComparison]::OrdinalIgnoreCase) -or -not $argumentsMatch) {
        throw "$Operation persisted an unexpected blockwright-local transport."
    }
}

function Assert-SmokeStopped {
    param([Parameter(Mandatory = $true)][object]$Smoke)
    $smokeProcessId = [int]$Smoke.processId
    if ($smokeProcessId -le 0) { throw "Installed smoke evidence did not identify the process it started." }
    if ($null -ne (Get-Process -Id $smokeProcessId -ErrorAction SilentlyContinue)) { throw "Installed smoke left PID $smokeProcessId running." }
    $installPrefix = $installRoot.TrimEnd('\') + '\'
    $lingeringProcesses = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
        -not [string]::IsNullOrWhiteSpace([string]$_.ExecutablePath) -and
        [System.IO.Path]::GetFullPath([string]$_.ExecutablePath).StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase)
    })
    if ($lingeringProcesses.Count -gt 0) { throw "Installed smoke left $($lingeringProcesses.Count) packaged process(es) running." }
    try { $smokeUri = [uri]$Smoke.endpoint } catch { throw "Installed smoke returned an invalid endpoint URI." }
    if ($smokeUri.Port -lt 1024 -or $smokeUri.Port -gt 65535) { throw "Installed smoke returned an invalid endpoint port." }
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $smokeUri.Port)
    try { $listener.Start() } catch { throw "Installed smoke left loopback port $($smokeUri.Port) in use." } finally { try { $listener.Stop() } catch {} }
}

function Get-PluginManifestReferenceEvidence {
    param([Parameter(Mandatory = $true)][string]$PackageRoot)
    $manifestPath = Join-Path $PackageRoot ".codex-plugin\plugin.json"
    $manifest = [System.IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json
    $references = [ordered]@{
        skills = [string]$manifest.skills
        mcpServers = [string]$manifest.mcpServers
        composerIcon = [string]$manifest.interface.composerIcon
        logo = [string]$manifest.interface.logo
        logoDark = [string]$manifest.interface.logoDark
    }
    for ($index = 0; $index -lt @($manifest.interface.screenshots).Count; $index++) {
        $references["screenshot[$index]"] = [string]$manifest.interface.screenshots[$index]
    }
    $rootPrefix = ([System.IO.Path]::GetFullPath($PackageRoot)).TrimEnd('\') + '\'
    $evidence = New-Object 'System.Collections.Generic.List[object]'
    foreach ($entry in $references.GetEnumerator()) {
        if ([string]::IsNullOrWhiteSpace([string]$entry.Value)) { throw "Packaged plugin manifest reference '$($entry.Key)' is empty." }
        $resolved = [System.IO.Path]::GetFullPath((Join-Path $PackageRoot ([string]$entry.Value)))
        if (-not $resolved.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Packaged plugin manifest reference '$($entry.Key)' escapes the package root." }
        if (-not (Test-Path -LiteralPath $resolved)) { throw "Packaged plugin manifest reference '$($entry.Key)' is missing: $($entry.Value)" }
        $item = Get-Item -LiteralPath $resolved
        $evidence.Add([pscustomobject][ordered]@{
            name = [string]$entry.Key
            path = [string]$entry.Value
            kind = if ($item.PSIsContainer) { "directory" } else { "file" }
            sha256 = if ($item.PSIsContainer) { $null } else { (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant() }
        })
    }
    return $evidence.ToArray()
}

function Invoke-PackagedDiagnostics {
    param([Parameter(Mandatory = $true)][string]$PackageRoot)
    $node = Join-Path $PackageRoot "runtime\node\node.exe"
    $diagnosticScript = Join-Path $PackageRoot "scripts\diagnose.mjs"
    $diagnosticProcess = Invoke-NativeProcess -FileName $node -Arguments @($diagnosticScript, "--root", $PackageRoot, "--json")
    if ($diagnosticProcess.ExitCode -ne 0) {
        throw "Installed packaged diagnostics failed with exit $($diagnosticProcess.ExitCode). $($diagnosticProcess.StandardOutput) $($diagnosticProcess.StandardError)"
    }
    try { $report = $diagnosticProcess.StandardOutput | ConvertFrom-Json } catch { throw "Installed packaged diagnostics did not return machine-readable JSON." }
    if ([string]$report.summary.status -ne "healthy" -or [int]$report.summary.errors -ne 0 -or [int]$report.summary.warnings -ne 0 -or [string]$report.summary.mode -ne "plugin") {
        throw "Installed packaged diagnostics did not report a healthy plugin payload."
    }
    $requiredChecks = New-Object 'System.Collections.Generic.List[object]'
    foreach ($requiredId in @("plugin_manifest", "plugin_payload", "npm_version", "mcp_launch")) {
        $matches = @($report.checks | Where-Object { [string]$_.id -eq $requiredId })
        if ($matches.Count -ne 1 -or [string]$matches[0].status -ne "pass") { throw "Installed packaged diagnostic check '$requiredId' did not pass exactly once." }
        $requiredChecks.Add([pscustomobject][ordered]@{ id = $requiredId; status = [string]$matches[0].status; message = [string]$matches[0].message })
    }
    $manifestReferences = Get-PluginManifestReferenceEvidence -PackageRoot $PackageRoot
    return [pscustomobject][ordered]@{
        status = [string]$report.summary.status
        mode = [string]$report.summary.mode
        errors = [int]$report.summary.errors
        warnings = [int]$report.summary.warnings
        passed = [int]$report.summary.passed
        requiredChecks = $requiredChecks.ToArray()
        pluginManifestReferences = @($manifestReferences)
    }
}

function Invoke-Installer {
    param([string]$Path)
    $script:installerInvocationCount++
    $logPath = Join-Path $logRoot ("setup-{0:D2}.log" -f $script:installerInvocationCount)
    $arguments = '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CURRENTUSER /DIR="' + $installRoot + '" /LOG="' + $logPath + '"'
    if ($TestCodexIntegration) { $arguments += ' /TASKS="codexintegration"' }
    $process = Start-Process -FilePath ([System.IO.Path]::GetFullPath($Path)) -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw "Installer $Path exited with code $($process.ExitCode)." }
}

function Invoke-Uninstaller {
    param([switch]$RemoveUserData)
    $uninstaller = Join-Path $installRoot "unins000.exe"
    if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw "Inno uninstaller is missing: $uninstaller" }
    $script:uninstallerInvocationCount++
    $logPath = Join-Path $logRoot ("uninstall-{0:D2}.log" -f $script:uninstallerInvocationCount)
    $arguments = '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="' + $logPath + '"'
    if ($RemoveUserData) { $arguments += " /REMOVEUSERDATA" }
    $process = Start-Process -FilePath $uninstaller -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw "Uninstaller exited with code $($process.ExitCode)." }
    for ($attempt = 0; $attempt -lt 50 -and (Test-Path -LiteralPath $installRoot); $attempt++) { Start-Sleep -Milliseconds 100 }
}

function Get-FreePort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try { $listener.Start(); return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() }
}

function Set-ConfigurationPreservationProbe {
    $configurationPath = Join-Path $stateRoot "config.json"
    $configuration = [System.IO.File]::ReadAllText($configurationPath) | ConvertFrom-Json
    $configuration.port = Get-FreePort
    $configuration.updateMetadataUri = "https://example.invalid/blockwright-test/latest.json"
    $configuration.trustedPublisherThumbprint = "ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    [System.IO.File]::WriteAllText($configurationPath, (($configuration | ConvertTo-Json -Depth 10) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    return [pscustomobject]@{ Port = [int]$configuration.port; MetadataUri = [string]$configuration.updateMetadataUri; Thumbprint = [string]$configuration.trustedPublisherThumbprint }
}

function Assert-ConfigurationPreserved {
    param([Parameter(Mandatory = $true)]$Expected, [Parameter(Mandatory = $true)][string]$Operation)
    $actual = [System.IO.File]::ReadAllText((Join-Path $stateRoot "config.json")) | ConvertFrom-Json
    if ([int]$actual.port -ne $Expected.Port -or [string]$actual.updateMetadataUri -ne $Expected.MetadataUri -or [string]$actual.trustedPublisherThumbprint -ne $Expected.Thumbprint) {
        throw "$Operation reset or rewrote the user's existing Blockwright configuration."
    }
}

if (Test-Path -LiteralPath $uninstallRegistrationKey) {
    $existingRegistration = Get-ItemProperty -LiteralPath $uninstallRegistrationKey
    throw "Installer lifecycle tests require a disposable Windows profile with no existing Blockwright AppId registration. Existing install location: $($existingRegistration.InstallLocation)"
}

try {
    $null = New-Item -ItemType Directory -Path $resolvedTestRoot -Force
    $null = New-Item -ItemType Directory -Path $logRoot -Force
    if (-not (Test-Path -LiteralPath $windowsPowerShell -PathType Leaf)) { throw "Windows PowerShell 5.1 was not found: $windowsPowerShell" }
    $env:BLOCKWRIGHT_STATE_ROOT = $stateRoot
    $env:APPDATA = Join-Path $resolvedTestRoot "roaming"
    $env:BLOCKWRIGHT_INSTALLER_TEST_STATE_ROOT = $stateRoot
    $env:BLOCKWRIGHT_INSTALLER_TEST_ROAMING_ROOT = $env:APPDATA
    if ($TestCodexIntegration) {
        Initialize-CodexProbe
        Assert-CodexConfigurationAbsent -Operation "Lifecycle preflight"
    }
    $configurationProbe = $null
    if (-not [string]::IsNullOrWhiteSpace($PreviousInstaller)) {
        Invoke-Installer -Path $PreviousInstaller
        foreach ($requiredStateEntry in @("config.json", "install-state.json")) {
            if (-not (Test-Path -LiteralPath (Join-Path $stateRoot $requiredStateEntry) -PathType Leaf)) { throw "Previous installer did not initialize fixture state at the validated lifecycle root: $requiredStateEntry" }
        }
        $configurationProbe = Set-ConfigurationPreservationProbe
    }
    Invoke-Installer -Path $CurrentInstaller
    if (-not (Test-Path -LiteralPath $uninstallRegistrationKey)) { throw "Current installer did not create the expected per-user AppId registration." }
    $fixtureRegistration = Get-ItemProperty -LiteralPath $uninstallRegistrationKey
    if (-not ([System.IO.Path]::GetFullPath([string]$fixtureRegistration.InstallLocation)).TrimEnd('\').Equals($installRoot.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) { throw "Installer lifecycle fixture registered an unexpected install location." }
    foreach ($requiredStateEntry in @("config.json", "install-state.json")) {
        if (-not (Test-Path -LiteralPath (Join-Path $stateRoot $requiredStateEntry) -PathType Leaf)) { throw "Current installer did not initialize fixture state at the validated lifecycle root: $requiredStateEntry" }
    }
    if ($null -ne $configurationProbe) { Assert-ConfigurationPreserved -Expected $configurationProbe -Operation "Upgrade" }
    if ($null -eq $configurationProbe) { $configurationProbe = Set-ConfigurationPreservationProbe }
    Invoke-Installer -Path $CurrentInstaller
    Assert-ConfigurationPreserved -Expected $configurationProbe -Operation "Same-version repair"
    $integrationStatusPath = Join-Path $stateRoot "integration\installer-status.txt"
    if (-not (Test-Path -LiteralPath $integrationStatusPath -PathType Leaf)) { throw "Installer did not persist its optional-integration result status." }
    $integrationStatus = [ordered]@{}
    foreach ($line in [System.IO.File]::ReadAllLines($integrationStatusPath)) {
        $separator = $line.IndexOf('=')
        if ($separator -gt 0) { $integrationStatus[$line.Substring(0, $separator)] = $line.Substring($separator + 1) }
    }
    $expectedCodexIntegrationStatus = if ($TestCodexIntegration) { "pass" } else { "not-selected" }
    if ([string]$integrationStatus.schemaVersion -ne "1" -or [string]$integrationStatus.codexintegration -ne $expectedCodexIntegrationStatus -or [string]$integrationStatus.schemassociation -ne "not-selected") {
        throw "Installer persisted unexpected optional-integration status for the default lifecycle fixture."
    }
    if ($TestCodexIntegration) { Assert-CodexConfigurationPresent -Operation "Installed Codex integration" }
    foreach ($required in @(
        "Blockwright.exe",
        "runtime\node\node.exe",
        "runtime\node\npm.cmd",
        "runtime\node\node_modules\npm\bin\npm-cli.js",
        "app\dist\server.js",
        ".codex-plugin\plugin.json",
        ".mcp.json",
        "mcp\server.mjs",
        "scripts\diagnose.mjs",
        "scripts\windows\Launch-Blockwright-Mcp.cmd",
        "scripts\windows\Blockwright-ControlCenter.ps1",
        "release-manifest.json"
    )) {
        if (-not (Test-Path -LiteralPath (Join-Path $installRoot $required))) { throw "Installed payload is missing $required." }
    }
    $releaseManifest = Get-Content -Raw -LiteralPath (Join-Path $installRoot "release-manifest.json") | ConvertFrom-Json
    $nativeLauncher = Join-Path $installRoot "Blockwright.exe"
    $expectedLauncherStatus = switch ([string]$releaseManifest.launcher.authenticode) {
        "not-signed" { "NotSigned" }
        "valid" { "Valid" }
        default { throw "Installed release manifest has an unsupported native launcher trust state." }
    }
    $launcherValidationArguments = @("-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "..\release\Test-BlockwrightLauncherBinary.ps1"), "-Artifact", $nativeLauncher, "-Version", ([string]$releaseManifest.version), "-ExpectedAuthenticodeStatus", $expectedLauncherStatus)
    if ($expectedLauncherStatus -eq "Valid") { $launcherValidationArguments += @("-ExpectedThumbprint", ([string]$releaseManifest.launcher.signerThumbprint), "-RequireTimestamp") }
    $launcherValidation = Invoke-NativeProcess -FileName $windowsPowerShell -Arguments $launcherValidationArguments
    if ($launcherValidation.ExitCode -ne 0) { throw "Installed native launcher validation failed: $($launcherValidation.StandardError)" }
    $launcherEvidence = $launcherValidation.StandardOutput | ConvertFrom-Json
    if ([string]$launcherEvidence.sha256 -cne ([string]$releaseManifest.launcher.sha256).ToLowerInvariant()) { throw "Installed Blockwright.exe does not match release-manifest.json." }
    $diagnosticEvidence = Invoke-PackagedDiagnostics -PackageRoot $installRoot
    $updaterSelfTest = @(& $windowsPowerShell -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installRoot "scripts\windows\Update-Blockwright.ps1") -InstallRoot $installRoot -StateRoot $stateRoot -SelfTest 2>&1)
    $updaterSelfTestResult = ($updaterSelfTest -join "`n") | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or -not $updaterSelfTestResult.DowngradeRejected -or -not $updaterSelfTestResult.OversizeDownloadRejected -or -not $updaterSelfTestResult.PreservationStateTransitions) { throw "Installed updater downgrade/ProductVersion/bounded-download/execution-state self-test failed: $($updaterSelfTest -join ' ')" }
    $smokeProcess = Invoke-NativeProcess -FileName $nativeLauncher -Arguments @("-PluginRoot", $installRoot, "-SmokeTest", "-SmokeTestSeconds", [string]$SmokeTestSeconds, "-Json") -TimeoutMilliseconds (($SmokeTestSeconds + 120) * 1000)
    if ($smokeProcess.ExitCode -ne 0) { throw "Installed private-runtime smoke test failed: $($smokeProcess.StandardOutput) $($smokeProcess.StandardError)" }
    $smoke = $smokeProcess.StandardOutput | ConvertFrom-Json
    if (-not $smoke.healthy) { throw "Installed server did not become ready." }
    if (-not [bool]$smoke.workflow.passed -or [int]$smoke.workflow.toolCount -lt 4 -or
        -not [bool]$smoke.workflow.deterministicReplay -or -not [bool]$smoke.workflow.validationValid -or
        [string]$smoke.workflow.contractStatus -ne "valid" -or [string]$smoke.workflow.exportFormat -ne "schem" -or
        [int]$smoke.workflow.exportBytes -le 0 -or [int]$smoke.workflow.schematicVersion -ne 3) {
        throw "Installed primary workflow smoke evidence is incomplete or invalid."
    }
    if (Test-Path -LiteralPath (Join-Path $stateRoot "run\managed-server.json") -PathType Leaf) {
        throw "Installed smoke test left its managed server record behind after stop."
    }
    Assert-SmokeStopped -Smoke $smoke

    $null = New-Item -ItemType Directory -Path (Join-Path $stateRoot "projects") -Force
    $null = New-Item -ItemType Directory -Path (Join-Path $stateRoot "exports") -Force
    [System.IO.File]::WriteAllText((Join-Path $stateRoot "projects\preserve.blockwright"), "preserve")
    [System.IO.File]::WriteAllText((Join-Path $stateRoot "exports\preserve.schem"), "preserve")
    [System.IO.File]::WriteAllText((Join-Path $stateRoot "palettes.json"), "preserve")
    $legacyPaletteRoot = Join-Path $env:APPDATA "Blockwright"
    $null = New-Item -ItemType Directory -Path $legacyPaletteRoot -Force
    [System.IO.File]::WriteAllText((Join-Path $legacyPaletteRoot "palettes.json"), "preserve")
    Invoke-Uninstaller
    if ($TestCodexIntegration) { Assert-CodexConfigurationAbsent -Operation "Default uninstall" }
    if (Test-Path -LiteralPath $installRoot) { throw "Default uninstall left the installer-owned application directory behind." }
    if (-not (Test-Path -LiteralPath (Join-Path $stateRoot "projects\preserve.blockwright"))) { throw "Default uninstall removed a user project." }
    if (-not (Test-Path -LiteralPath (Join-Path $stateRoot "exports\preserve.schem"))) { throw "Default uninstall removed a user export." }
    if (-not (Test-Path -LiteralPath (Join-Path $stateRoot "palettes.json"))) { throw "Default uninstall removed user palettes." }
    if (-not (Test-Path -LiteralPath (Join-Path $legacyPaletteRoot "palettes.json"))) { throw "Default uninstall removed the legacy user palette file." }

    Invoke-Installer -Path $CurrentInstaller
    if ($TestCodexIntegration) { Assert-CodexConfigurationPresent -Operation "Reinstalled Codex integration" }
    Invoke-Uninstaller -RemoveUserData
    if ($TestCodexIntegration) { Assert-CodexConfigurationAbsent -Operation "Explicit-cleanup uninstall" }
    if (Test-Path -LiteralPath $installRoot) { throw "Explicit-cleanup uninstall left the application directory behind." }
    if (Test-Path -LiteralPath $stateRoot) { throw "Explicit-cleanup uninstall left Blockwright state behind." }
    if (Test-Path -LiteralPath $legacyPaletteRoot) { throw "Explicit-cleanup uninstall left the exact legacy palette directory behind." }
    if (Test-Path -LiteralPath $uninstallRegistrationKey) { throw "Explicit-cleanup uninstall left the stable AppId registration behind." }
    $lifecycleSucceeded = $true
    [pscustomobject]@{
        valid = $true
        install = "pass"
        upgrade = if ($PreviousInstaller) { "pass" } else { "not-exercised" }
        repair = "pass"
        configurationPreserved = "pass"
        diagnostics = "pass"
        diagnosticEvidence = $diagnosticEvidence
        installerIntegrationStatus = [pscustomobject]$integrationStatus
        codexIntegration = if ($TestCodexIntegration) { "pass" } else { "not-exercised" }
        readiness = "pass"
        primaryWorkflow = "pass"
        workflowEvidence = $smoke.workflow
        stop = "pass"
        updaterVersionGuards = "pass"
        uninstallPreservesUserContent = "pass"
        explicitCleanup = "pass"
    } | ConvertTo-Json -Depth 8 -Compress
} finally {
    $fallbackUninstaller = Join-Path $installRoot "unins000.exe"
    if ((Test-Path -LiteralPath $uninstallRegistrationKey) -and (Test-Path -LiteralPath $fallbackUninstaller -PathType Leaf)) {
        try {
            $fallbackLog = Join-Path $logRoot "uninstall-recovery.log"
            $fallbackArguments = '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="' + $fallbackLog + '"'
            $fallbackProcess = Start-Process -FilePath $fallbackUninstaller -ArgumentList $fallbackArguments -Wait -PassThru -WindowStyle Hidden
            if ($fallbackProcess.ExitCode -ne 0) { Write-Warning "Fixture uninstaller recovery exited with code $($fallbackProcess.ExitCode); the fixture directory will be preserved." }
        } catch {
            Write-Warning "Fixture uninstaller recovery failed; the fixture directory will be preserved. $($_.Exception.Message)"
        }
    }
    $env:BLOCKWRIGHT_STATE_ROOT = $previousStateRoot
    $env:APPDATA = $previousAppData
    $env:BLOCKWRIGHT_INSTALLER_TEST_STATE_ROOT = $previousInstallerTestStateRoot
    $env:BLOCKWRIGHT_INSTALLER_TEST_ROAMING_ROOT = $previousInstallerTestRoamingRoot
    if ($deleteTestRoot -and $lifecycleSucceeded -and -not (Test-Path -LiteralPath $uninstallRegistrationKey) -and (Test-Path -LiteralPath $resolvedTestRoot -PathType Container) -and $resolvedTestRoot.StartsWith([System.IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    } elseif ($deleteTestRoot -and -not $lifecycleSucceeded) {
        Write-Warning "Lifecycle fixture and setup logs were retained at $resolvedTestRoot because the test did not complete successfully."
    } elseif ($deleteTestRoot -and (Test-Path -LiteralPath $uninstallRegistrationKey)) {
        Write-Warning "Lifecycle fixture was retained at $resolvedTestRoot because its stable AppId registration still exists. Repair/uninstall it before deleting those files."
    }
}
