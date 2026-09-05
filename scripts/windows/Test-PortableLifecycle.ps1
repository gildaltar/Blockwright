[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PortableZip,
    [string]$TestRoot,
    [ValidateRange(20, 180)][int]$SmokeTestSeconds = 60
)

$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") { throw "Portable lifecycle tests require Windows." }
$resolvedPortableZip = [System.IO.Path]::GetFullPath($PortableZip)
if (-not (Test-Path -LiteralPath $resolvedPortableZip -PathType Leaf)) { throw "Portable ZIP is missing: $resolvedPortableZip" }
$deleteTestRoot = [string]::IsNullOrWhiteSpace($TestRoot)
if ($deleteTestRoot) { $TestRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("Blockwright Portable Lifecycle " + [guid]::NewGuid().ToString("N")) }
$resolvedTestRoot = [System.IO.Path]::GetFullPath($TestRoot)
$portableRoot = Join-Path $resolvedTestRoot "Blockwright"
$windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$tarExecutable = Join-Path $env:SystemRoot "System32\tar.exe"
$uninstallRegistrationKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{2D75D5A7-BC78-4BBE-B0BC-5B8D0366C4B4}_is1"
$perUserInstallRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Programs\Blockwright"))
$perUserStateRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Blockwright"))
$codexConfigPath = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE ".codex\config.toml"))
$schematicExtensionKey = "HKCU:\Software\Classes\.schem"
$schematicProgIdKey = "HKCU:\Software\Classes\Blockwright.Schematic.1"
$previousStateRoot = $env:BLOCKWRIGHT_STATE_ROOT
$previousStateDirectory = $env:BLOCKWRIGHT_STATE_DIR
$previousPath = $env:PATH
$testSucceeded = $false

function Quote-NativeArgument {
    param([Parameter(Mandatory = $true)][string]$Value)
    return '"' + $Value.Replace('"', '\"') + '"'
}

function Invoke-NativeProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FileName,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [ValidateRange(1000, 600000)][int]$TimeoutMilliseconds = 300000
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
        throw "$FileName exceeded the $TimeoutMilliseconds ms portable-test limit."
    }
    $result = [pscustomobject]@{
        ExitCode = $process.ExitCode
        StandardOutput = $stdoutTask.Result
        StandardError = $stderrTask.Result
    }
    $process.Dispose()
    return $result
}

function Get-OptionalFileSnapshot {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return [pscustomobject]@{ Exists = $false; Length = 0; Sha256 = $null } }
    $item = Get-Item -LiteralPath $Path
    return [pscustomobject]@{ Exists = $true; Length = [long]$item.Length; Sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }
}

function Assert-FileSnapshotUnchanged {
    param(
        [Parameter(Mandatory = $true)][object]$Before,
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Label
    )
    $after = Get-OptionalFileSnapshot -Path $Path
    if ([bool]$Before.Exists -ne [bool]$after.Exists -or [long]$Before.Length -ne [long]$after.Length -or [string]$Before.Sha256 -cne [string]$after.Sha256) {
        throw "Portable first launch changed $Label outside the extracted package."
    }
}

function Get-DirectoryTreeSnapshot {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return '{"exists":false}' }
    $resolvedRoot = [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
    $items = @(
        Get-Item -LiteralPath $resolvedRoot -Force
        Get-ChildItem -LiteralPath $resolvedRoot -Force -Recurse | Sort-Object FullName
    )
    $records = New-Object 'System.Collections.Generic.List[object]'
    foreach ($item in $items) {
        $fullName = [System.IO.Path]::GetFullPath([string]$item.FullName)
        $relativePath = if ($fullName.Equals($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) { "." } else { $fullName.Substring($resolvedRoot.Length).TrimStart('\') }
        $records.Add([pscustomobject][ordered]@{
            path = $relativePath
            kind = if ($item.PSIsContainer) { "directory" } else { "file" }
            length = if ($item.PSIsContainer) { $null } else { [long]$item.Length }
            lastWriteUtcTicks = [long]$item.LastWriteTimeUtc.Ticks
            attributes = [string]$item.Attributes
        })
    }
    return ([pscustomobject][ordered]@{ exists = $true; entries = $records.ToArray() } | ConvertTo-Json -Depth 6 -Compress)
}

function Assert-DirectoryTreeUnchanged {
    param(
        [Parameter(Mandatory = $true)][string]$Before,
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Label
    )
    if ((Get-DirectoryTreeSnapshot -Path $Path) -cne $Before) { throw "Portable first launch changed $Label outside the extracted package." }
}

function Get-RegistrationSnapshot {
    if (-not (Test-Path -LiteralPath $uninstallRegistrationKey)) { return [pscustomobject]@{ Exists = $false; InstallLocation = $null; UninstallString = $null; DisplayVersion = $null } }
    $value = Get-ItemProperty -LiteralPath $uninstallRegistrationKey
    return [pscustomobject]@{
        Exists = $true
        InstallLocation = [string]$value.InstallLocation
        UninstallString = [string]$value.UninstallString
        DisplayVersion = [string]$value.DisplayVersion
    }
}

function Assert-RegistrationUnchanged {
    param([Parameter(Mandatory = $true)][object]$Before)
    $after = Get-RegistrationSnapshot
    if ([bool]$Before.Exists -ne [bool]$after.Exists -or [string]$Before.InstallLocation -cne [string]$after.InstallLocation -or
        [string]$Before.UninstallString -cne [string]$after.UninstallString -or [string]$Before.DisplayVersion -cne [string]$after.DisplayVersion) {
        throw "Portable first launch changed the per-user installer registration."
    }
}

function Get-RegistrySubtreeSnapshot {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return '{"exists":false}' }
    $keys = @(
        Get-Item -LiteralPath $Path
        Get-ChildItem -LiteralPath $Path -Recurse | Sort-Object Name
    )
    $records = New-Object 'System.Collections.Generic.List[object]'
    foreach ($key in $keys) {
        try {
            $values = New-Object 'System.Collections.Generic.List[object]'
            foreach ($valueName in @($key.GetValueNames() | Sort-Object)) {
                $value = $key.GetValue($valueName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
                $values.Add([pscustomobject][ordered]@{
                    name = [string]$valueName
                    kind = [string]$key.GetValueKind($valueName)
                    value = $value
                })
            }
            $records.Add([pscustomobject][ordered]@{ name = [string]$key.Name; values = $values.ToArray() })
        } finally {
            $key.Dispose()
        }
    }
    return ([pscustomobject][ordered]@{ exists = $true; keys = $records.ToArray() } | ConvertTo-Json -Depth 12 -Compress)
}

function Get-FreePort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try { $listener.Start(); return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() }
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
        throw "Portable packaged diagnostics failed with exit $($diagnosticProcess.ExitCode). $($diagnosticProcess.StandardOutput) $($diagnosticProcess.StandardError)"
    }
    try { $report = $diagnosticProcess.StandardOutput | ConvertFrom-Json } catch { throw "Portable packaged diagnostics did not return machine-readable JSON." }
    if ([string]$report.summary.status -ne "healthy" -or [int]$report.summary.errors -ne 0 -or [int]$report.summary.warnings -ne 0 -or [string]$report.summary.mode -ne "plugin") {
        throw "Portable packaged diagnostics did not report a healthy plugin payload."
    }
    $requiredChecks = New-Object 'System.Collections.Generic.List[object]'
    foreach ($requiredId in @("plugin_manifest", "plugin_payload", "npm_version", "mcp_launch")) {
        $matches = @($report.checks | Where-Object { [string]$_.id -eq $requiredId })
        if ($matches.Count -ne 1 -or [string]$matches[0].status -ne "pass") { throw "Portable packaged diagnostic check '$requiredId' did not pass exactly once." }
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

function Test-AutomaticTestRoot {
    if (-not $deleteTestRoot) { return $false }
    if ([System.IO.Path]::GetFileName($resolvedTestRoot) -notmatch '^Blockwright Portable Lifecycle [a-f0-9]{32}$') { return $false }
    $expectedParent = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
    $actualParent = [System.IO.Path]::GetFullPath((Split-Path -Parent $resolvedTestRoot)).TrimEnd('\')
    return $actualParent.Equals($expectedParent, [StringComparison]::OrdinalIgnoreCase)
}

$registrationBefore = Get-RegistrationSnapshot
$perUserConfigPath = Join-Path $perUserStateRoot "config.json"
$perUserInstallStatePath = Join-Path $perUserStateRoot "install-state.json"
$perUserConfigBefore = Get-OptionalFileSnapshot -Path $perUserConfigPath
$perUserInstallStateBefore = Get-OptionalFileSnapshot -Path $perUserInstallStatePath
$perUserInstallerStatusPath = Join-Path $perUserStateRoot "integration\installer-status.txt"
$perUserCodexMarkerPath = Join-Path $perUserStateRoot "integration\codex.json"
$perUserAssociationMarkerPath = Join-Path $perUserStateRoot "integration\schem-association.json"
$perUserInstallerStatusBefore = Get-OptionalFileSnapshot -Path $perUserInstallerStatusPath
$perUserCodexMarkerBefore = Get-OptionalFileSnapshot -Path $perUserCodexMarkerPath
$perUserAssociationMarkerBefore = Get-OptionalFileSnapshot -Path $perUserAssociationMarkerPath
$codexConfigBefore = Get-OptionalFileSnapshot -Path $codexConfigPath
$schematicExtensionBefore = Get-RegistrySubtreeSnapshot -Path $schematicExtensionKey
$schematicProgIdBefore = Get-RegistrySubtreeSnapshot -Path $schematicProgIdKey
$perUserInstallExistedBefore = Test-Path -LiteralPath $perUserInstallRoot -PathType Container
$perUserStateTreeBefore = Get-DirectoryTreeSnapshot -Path $perUserStateRoot
$perUserInstallTreeBefore = Get-DirectoryTreeSnapshot -Path $perUserInstallRoot

try {
    $null = New-Item -ItemType Directory -Path $resolvedTestRoot -Force
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($resolvedPortableZip)
    try {
        $entryCount = $archive.Entries.Count
        if ($entryCount -lt 1) { throw "Portable ZIP is empty." }
        foreach ($entry in $archive.Entries) {
            $name = ([string]$entry.FullName).Replace('\', '/')
            if (-not $name.StartsWith("Blockwright/", [StringComparison]::Ordinal) -or $name.StartsWith("/", [StringComparison]::Ordinal) -or
                $name -match '^[A-Za-z]:' -or @($name.Split('/') | Where-Object { $_ -eq '..' }).Count -gt 0) {
                throw "Portable ZIP contains an entry outside the single Blockwright root: $name"
            }
        }
    } finally {
        $archive.Dispose()
    }
    if (-not (Test-Path -LiteralPath $tarExecutable -PathType Leaf)) { throw "Windows tar.exe is required to exercise portable extraction." }
    $extract = Invoke-NativeProcess -FileName $tarExecutable -Arguments @("-xf", $resolvedPortableZip, "-C", $resolvedTestRoot)
    if ($extract.ExitCode -ne 0) { throw "Portable ZIP extraction failed with exit $($extract.ExitCode). $($extract.StandardError.Trim())" }

    foreach ($required in @(
        "portable.flag",
        "runtime\node\node.exe",
        "runtime\node\npm.cmd",
        "runtime\node\node_modules\npm\bin\npm-cli.js",
        "app\dist\server.js",
        ".codex-plugin\plugin.json",
        ".mcp.json",
        "mcp\server.mjs",
        "scripts\diagnose.mjs",
        "scripts\windows\Launch-Blockwright-Mcp.cmd",
        "scripts\windows\Start-Blockwright-Portable.cmd",
        "scripts\windows\Blockwright-ControlCenter.ps1",
        "release-manifest.json"
    )) {
        if (-not (Test-Path -LiteralPath (Join-Path $portableRoot $required) -PathType Leaf)) { throw "Extracted portable payload is missing $required." }
    }
    Import-Module (Join-Path $portableRoot "scripts\windows\Blockwright-Paths.psm1") -Force
    $portableStateRoot = [System.IO.Path]::GetFullPath((Join-Path $portableRoot "data\state"))
    $resolvedPortableState = Get-BlockwrightStateRoot -InstallRoot $portableRoot
    if (-not $resolvedPortableState.Equals($portableStateRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Portable state did not resolve beside the extracted package." }

    Remove-Item Env:BLOCKWRIGHT_STATE_ROOT -ErrorAction SilentlyContinue
    Remove-Item Env:BLOCKWRIGHT_STATE_DIR -ErrorAction SilentlyContinue
    $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\Wbem;$env:SystemRoot\System32\WindowsPowerShell\v1.0"
    $diagnosticEvidence = Invoke-PackagedDiagnostics -PackageRoot $portableRoot
    $port = Get-FreePort
    $controller = Join-Path $portableRoot "scripts\windows\Blockwright-ControlCenter.ps1"
    $smoke = Invoke-NativeProcess -FileName $windowsPowerShell -Arguments @(
        "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", $controller,
        "-PluginRoot", $portableRoot, "-Port", [string]$port, "-SmokeTest", "-SmokeTestSeconds", [string]$SmokeTestSeconds, "-Json"
    ) -TimeoutMilliseconds (($SmokeTestSeconds + 120) * 1000)
    if ($smoke.ExitCode -ne 0) { throw "Portable private-runtime smoke test failed with exit $($smoke.ExitCode). $($smoke.StandardOutput) $($smoke.StandardError)" }
    try { $smokeEvidence = $smoke.StandardOutput | ConvertFrom-Json } catch { throw "Portable smoke test did not return machine-readable JSON." }
    if (-not [bool]$smokeEvidence.healthy -or -not [bool]$smokeEvidence.workflow.passed -or
        -not [bool]$smokeEvidence.workflow.deterministicReplay -or -not [bool]$smokeEvidence.workflow.validationValid -or
        [string]$smokeEvidence.workflow.contractStatus -ne "valid" -or [string]$smokeEvidence.workflow.exportFormat -ne "schem" -or
        [int]$smokeEvidence.workflow.exportBytes -le 0 -or [int]$smokeEvidence.workflow.schematicVersion -ne 3) {
        throw "Portable primary workflow evidence is incomplete or invalid."
    }
    if (-not (Test-Path -LiteralPath $portableStateRoot -PathType Container)) { throw "Portable first launch did not create package-local state." }
    if (Test-Path -LiteralPath (Join-Path $portableStateRoot "run\managed-server.json") -PathType Leaf) { throw "Portable smoke test left its managed server record behind." }
    $portProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
    try { $portProbe.Start() } catch { throw "Portable smoke test left its loopback port in use." } finally { try { $portProbe.Stop() } catch {} }
    $lingeringProcesses = @(Get-CimInstance Win32_Process | Where-Object {
        -not [string]::IsNullOrWhiteSpace([string]$_.ExecutablePath) -and
        [System.IO.Path]::GetFullPath([string]$_.ExecutablePath).StartsWith(($portableRoot.TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)
    })
    if ($lingeringProcesses.Count -gt 0) { throw "Portable smoke test left $($lingeringProcesses.Count) packaged process(es) running." }

    Assert-RegistrationUnchanged -Before $registrationBefore
    Assert-FileSnapshotUnchanged -Before $perUserConfigBefore -Path $perUserConfigPath -Label "per-user configuration"
    Assert-FileSnapshotUnchanged -Before $perUserInstallStateBefore -Path $perUserInstallStatePath -Label "per-user install state"
    Assert-FileSnapshotUnchanged -Before $perUserInstallerStatusBefore -Path $perUserInstallerStatusPath -Label "per-user installer integration status"
    Assert-FileSnapshotUnchanged -Before $perUserCodexMarkerBefore -Path $perUserCodexMarkerPath -Label "per-user Codex ownership marker"
    Assert-FileSnapshotUnchanged -Before $perUserAssociationMarkerBefore -Path $perUserAssociationMarkerPath -Label "per-user schematic-association ownership marker"
    Assert-FileSnapshotUnchanged -Before $codexConfigBefore -Path $codexConfigPath -Label "Codex MCP configuration"
    if ((Get-RegistrySubtreeSnapshot -Path $schematicExtensionKey) -cne $schematicExtensionBefore -or
        (Get-RegistrySubtreeSnapshot -Path $schematicProgIdKey) -cne $schematicProgIdBefore) {
        throw "Portable first launch changed per-user .schem association ownership."
    }
    if ([bool](Test-Path -LiteralPath $perUserInstallRoot -PathType Container) -ne [bool]$perUserInstallExistedBefore) { throw "Portable first launch changed the per-user install directory presence." }
    Assert-DirectoryTreeUnchanged -Before $perUserStateTreeBefore -Path $perUserStateRoot -Label "the per-user Blockwright state tree"
    Assert-DirectoryTreeUnchanged -Before $perUserInstallTreeBefore -Path $perUserInstallRoot -Label "the per-user Blockwright installation tree"

    $testSucceeded = $true
    [pscustomobject][ordered]@{
        valid = $true
        archive = [System.IO.Path]::GetFileName($resolvedPortableZip)
        sha256 = (Get-FileHash -LiteralPath $resolvedPortableZip -Algorithm SHA256).Hash.ToLowerInvariant()
        archiveEntries = $entryCount
        privateRuntime = "pass"
        diagnostics = "pass"
        diagnosticEvidence = $diagnosticEvidence
        portableState = "pass"
        primaryWorkflow = "pass"
        workflowEvidence = $smokeEvidence.workflow
        stop = "pass"
        perUserLeakCheck = "pass"
    } | ConvertTo-Json -Depth 8 -Compress
} finally {
    $env:PATH = $previousPath
    if ([string]::IsNullOrWhiteSpace($previousStateRoot)) { Remove-Item Env:BLOCKWRIGHT_STATE_ROOT -ErrorAction SilentlyContinue } else { $env:BLOCKWRIGHT_STATE_ROOT = $previousStateRoot }
    if ([string]::IsNullOrWhiteSpace($previousStateDirectory)) { Remove-Item Env:BLOCKWRIGHT_STATE_DIR -ErrorAction SilentlyContinue } else { $env:BLOCKWRIGHT_STATE_DIR = $previousStateDirectory }
    $managedRecord = Join-Path $portableRoot "data\state\run\managed-server.json"
    if (Test-Path -LiteralPath $managedRecord -PathType Leaf) {
        try {
            Import-Module (Join-Path $portableRoot "scripts\windows\Blockwright-Paths.psm1") -Force
            $null = Stop-BlockwrightManagedProcess -InstallRoot $portableRoot -StateRoot (Join-Path $portableRoot "data\state") -Confirm:$false
        } catch { Write-Warning "Portable lifecycle cleanup could not stop the ownership-verified managed process. $($_.Exception.Message)" }
    }
    if ($deleteTestRoot -and $testSucceeded -and (Test-AutomaticTestRoot) -and (Test-Path -LiteralPath $resolvedTestRoot -PathType Container)) {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    } elseif ($deleteTestRoot -and -not $testSucceeded -and (Test-Path -LiteralPath $resolvedTestRoot -PathType Container)) {
        Write-Warning "Portable lifecycle evidence was retained after failure at $resolvedTestRoot."
    }
}
