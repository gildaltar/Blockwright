[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") { throw "Windows distribution tests require Windows." }
$testRoot = [System.IO.Path]::GetFullPath((Join-Path ([System.IO.Path]::GetTempPath()) ("Blockwright Windows Distribution Test " + [guid]::NewGuid().ToString("N"))))
$installRoot = Join-Path $testRoot "Blockwright"
$stateRoot = Join-Path $testRoot "state"
$bundlePath = Join-Path $testRoot "support.zip"
$expandedBundle = Join-Path $testRoot "expanded-support"
$associationTestRoot = "HKCU:\Software\Blockwright Installer Tests\$([guid]::NewGuid().ToString('N'))"
$results = New-Object 'System.Collections.Generic.List[object]'
$previousStateRoot = $env:BLOCKWRIGHT_STATE_ROOT
$previousAppData = $env:APPDATA
$previousFakeCodexState = $env:BLOCKWRIGHT_FAKE_CODEX_STATE
$previousFakeCodexGetMode = $env:BLOCKWRIGHT_FAKE_CODEX_GET_MODE
$previousFakeCodexAddMode = $env:BLOCKWRIGHT_FAKE_CODEX_ADD_MODE
$previousFakeCodexRemoveMode = $env:BLOCKWRIGHT_FAKE_CODEX_REMOVE_MODE

function Assert-Condition {
    param([Parameter(Mandatory = $true)][bool]$Condition, [Parameter(Mandatory = $true)][string]$Message)
    if (-not $Condition) { throw $Message }
}

function Add-Pass {
    param([string]$Name, [string]$Detail)
    $results.Add([pscustomobject]@{ name = $Name; status = "pass"; detail = $Detail })
}

function Get-FreePort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try { $listener.Start(); return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() }
}

try {
    $null = New-Item -ItemType Directory -Path (Join-Path $installRoot "runtime\node") -Force
    $null = New-Item -ItemType Directory -Path (Join-Path $installRoot "config") -Force
    $null = New-Item -ItemType Directory -Path (Join-Path $installRoot "mcp") -Force
    $null = New-Item -ItemType Directory -Path (Join-Path $installRoot "scripts\windows") -Force
    [System.IO.File]::WriteAllText((Join-Path $installRoot "runtime\node\node.exe"), "fixture")
    [System.IO.File]::WriteAllText((Join-Path $installRoot "runtime\node\npm.cmd"), "fixture")
    [System.IO.File]::WriteAllText((Join-Path $installRoot "config\defaults.json"), '{"schemaVersion":1,"port":32147,"bindAddress":"127.0.0.1","stateMode":"per-user"}')
    [System.IO.File]::WriteAllText((Join-Path $installRoot "mcp\server.mjs"), "// fixture")
    [System.IO.File]::WriteAllText((Join-Path $installRoot "scripts\windows\Launch-Blockwright-Mcp.cmd"), "@echo off`r`n")
    [System.IO.File]::WriteAllText((Join-Path $installRoot "scripts\windows\Open-BlockwrightSchematic.ps1"), 'param([string]$Path)')
    $env:BLOCKWRIGHT_STATE_ROOT = $stateRoot
    $env:APPDATA = Join-Path $testRoot "legacy-appdata"

    $releaseScriptRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\release"))
    $scriptFiles = @(
        Get-ChildItem -LiteralPath $PSScriptRoot -File | Where-Object { $_.Extension -in @(".ps1", ".psm1") }
        Get-ChildItem -LiteralPath $releaseScriptRoot -File | Where-Object { $_.Extension -eq ".ps1" }
    )
    foreach ($scriptFile in $scriptFiles) {
        $tokens = $null
        $parseErrors = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile($scriptFile.FullName, [ref]$tokens, [ref]$parseErrors)
        Assert-Condition ($parseErrors.Count -eq 0) "PowerShell parsing failed for $($scriptFile.Name): $($parseErrors.Message -join '; ')"
    }
    Add-Pass "powershell-parse" "$($scriptFiles.Count) Windows scripts/modules parse under Windows PowerShell."

    $installerSource = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot "..\..\installer\windows\Blockwright.iss"))
    Assert-Condition (-not $installerSource.Contains('-Confirm:$false')) "Inno invokes PowerShell -File with a boolean common-parameter value that Windows PowerShell treats as a string."
    Assert-Condition ($installerSource.Contains("PrivilegesRequired=lowest")) "Installer is not pinned to per-user, lowest-privilege execution."
    Assert-Condition (-not $installerSource.Contains("PrivilegesRequiredOverridesAllowed")) "Installer permits a command-line or dialog override that can elevate user-writable uninstall hooks."
    Assert-Condition (-not $installerSource.Contains("Check: ShouldRemoveUserData")) "Installer still records the user-data cleanup choice during installation rather than evaluating the uninstaller command line."
    foreach ($required in @("-Unattended", "CurUninstallStepChanged", "usUninstall", "UninstallArgumentPresent('/REMOVEUSERDATA')", "-RemoveUserProjectsAndExports", "-InstalledUninstall", "GetInstallerStateRoot", "GetInstallerRoamingRoot", "-PreserveExistingConfiguration", "PrivilegesRequired=lowest", "RaiseException")) {
        Assert-Condition ($installerSource.Contains($required)) "Installer cleanup routing contract is missing: $required"
    }
    Assert-Condition (-not $installerSource.Contains("[UninstallRun]")) "Installer still records mutable integration/state cleanup commands instead of running one ordered uninstall-time sequence."
    $runSectionStart = $installerSource.IndexOf("[Run]")
    $codeSectionStart = $installerSource.IndexOf("[Code]")
    Assert-Condition ($runSectionStart -ge 0 -and $codeSectionStart -gt $runSectionStart) "Installer [Run]/[Code] sections could not be isolated."
    $runSection = $installerSource.Substring($runSectionStart, $codeSectionStart - $runSectionStart)
    foreach ($forbiddenPostCopyScript in @("Initialize-Blockwright.ps1", "Register-BlockwrightCodex.ps1", "Set-BlockwrightSchematicAssociation.ps1")) {
        Assert-Condition (-not $runSection.Contains($forbiddenPostCopyScript)) "Installer still launches $forbiddenPostCopyScript from unchecked [Run] processing."
    }
    foreach ($requiredResultContract in @("RunSetupPowerShellScript", "ssPostInstall", "ResultCode", "RaiseException", "CodexIntegrationStatus := 'failed'", "SchematicAssociationStatus := 'failed'", "installer-status.txt", "SuppressibleMsgBox")) {
        Assert-Condition ($installerSource.Contains($requiredResultContract)) "Installer post-install result contract is missing: $requiredResultContract"
    }
    Assert-Condition ($installerSource.Contains("'Configuring Blockwright', True")) "Required initialization is not wired as a checked, setup-failing post-install action."
    Add-Pass "installer-postinstall-results" "Required initialization checks its launch and exit status; selected optional integrations record failures and surface an actionable warning instead of silently reporting success."

    $installerCiSource = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot "..\..\.github\workflows\windows-installer-ci.yml"))
    Assert-Condition ($installerCiSource.Contains('Join-Path (Resolve-Path ".\release\windows\.work").Path "fixtures"')) "Prior-version CI fixture output is not isolated beneath release/windows/.work."
    Assert-Condition ($installerCiSource.Contains('-PreviousInstaller ".\release\windows\.work\fixtures\Blockwright-0.0.1-windows-x64-setup.exe"')) "Installer lifecycle is not consuming the isolated prior-version fixture."
    Assert-Condition (-not $installerCiSource.Contains('-PreviousInstaller ".\release\windows\Blockwright-0.0.1-windows-x64-setup.exe"')) "Installer lifecycle still consumes a top-level release-inventory fixture."
    Add-Pass "ci-fixture-isolation" "The 0.0.1 upgrade fixture stays beneath release/windows/.work/fixtures and cannot enter the uploaded public artifact wildcard."
    $uninstallCode = $installerSource.Substring($installerSource.IndexOf("procedure CurUninstallStepChanged"))
    $codexCleanupIndex = $uninstallCode.IndexOf("Register-BlockwrightCodex.ps1")
    $associationCleanupIndex = $uninstallCode.IndexOf("Set-BlockwrightSchematicAssociation.ps1")
    $stateCleanupIndex = $uninstallCode.IndexOf("Remove-BlockwrightOwnedState.ps1")
    Assert-Condition ($codexCleanupIndex -ge 0 -and $associationCleanupIndex -gt $codexCleanupIndex -and $stateCleanupIndex -gt $associationCleanupIndex) "Uninstall deletes integration markers before using them to reverse owned Codex/.schem integration."
    Add-Pass "installer-cleanup-routing" "Uninstall-time code pins state roots, reverses owned integrations before deleting their markers, reads the actual /REMOVEUSERDATA command line, and fails closed."

    $releaseConfigPath = Join-Path $releaseScriptRoot "windows-release.json"
    $releaseConfig = [System.IO.File]::ReadAllText($releaseConfigPath) | ConvertFrom-Json
    Assert-Condition ($releaseConfig.innoSetup.sha256 -eq "4d11e8050b6185e0d49bd9e8cc661a7a59f44959a621d31d11033124c4e8a7b0") "Inno Setup bootstrapper SHA-256 is not pinned to the reviewed official 6.7.1 bytes."
    Assert-Condition ($releaseConfig.innoSetup.compilerSha256 -eq "eb6f4410c8db367a5f74127e8025ad2ccacc0afabbe783959d237df3050f97fb") "Inno Setup compiler SHA-256 is not pinned."
    $acquisitionSource = [System.IO.File]::ReadAllText((Join-Path $releaseScriptRoot "Install-PinnedInnoSetup.ps1"))
    $compilerWrapperSource = [System.IO.File]::ReadAllText((Join-Path $releaseScriptRoot "Invoke-PinnedInnoCompile.ps1"))
    foreach ($required in @("ExpectedBytes", "MaximumBytes", "TimeoutSeconds", "InfiniteTimeSpan", "SHA256", "Get-AuthenticodeSignature", "publisherThumbprint", "publisherSubject", "ProductVersion")) {
        Assert-Condition ($acquisitionSource.Contains($required)) "Pinned Inno Setup acquisition contract is missing: $required"
    }
    Assert-Condition ($compilerWrapperSource.Contains("Test-PinnedInnoSetup.ps1")) "The compiler execution boundary does not immediately verify the pinned compiler."
    if (-not [string]::IsNullOrWhiteSpace($env:BLOCKWRIGHT_PINNED_ISCC_PATH)) {
        $verifiedCompiler = & (Join-Path $releaseScriptRoot "Test-PinnedInnoSetup.ps1") -CompilerPath $env:BLOCKWRIGHT_PINNED_ISCC_PATH -PassThru
        Assert-Condition ([bool]$verifiedCompiler.Valid) "The acquired official Inno Setup compiler did not pass exact-byte and publisher verification."

        $wrongPublisherConfig = Join-Path $testRoot "wrong-publisher-config.json"
        $microsoftExecutable = Join-Path $PSHOME "powershell.exe"
        $mutatedConfig = [System.IO.File]::ReadAllText($releaseConfigPath) | ConvertFrom-Json
        $mutatedConfig.innoSetup.compilerSizeBytes = (Get-Item -LiteralPath $microsoftExecutable).Length
        $mutatedConfig.innoSetup.compilerSha256 = (Get-FileHash -LiteralPath $microsoftExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
        [System.IO.File]::WriteAllText($wrongPublisherConfig, (($mutatedConfig | ConvertTo-Json -Depth 20) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
        $wrongPublisherRejected = $false
        try { & (Join-Path $releaseScriptRoot "Test-PinnedInnoSetup.ps1") -CompilerPath $microsoftExecutable -ConfigPath $wrongPublisherConfig -PassThru | Out-Null } catch { $wrongPublisherRejected = $_.Exception.Message -match "thumbprint|publisher" }
        Assert-Condition $wrongPublisherRejected "A validly Authenticode-signed compiler from the wrong publisher was not rejected."
    }
    if (-not [string]::IsNullOrWhiteSpace($env:BLOCKWRIGHT_PINNED_INNO_INSTALLER_PATH)) {
        $corruptInstaller = Join-Path $testRoot "corrupt-innosetup.exe"
        [System.IO.File]::Copy($env:BLOCKWRIGHT_PINNED_INNO_INSTALLER_PATH, $corruptInstaller)
        $stream = [System.IO.File]::Open($corruptInstaller, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        try { $originalByte = $stream.ReadByte(); $stream.Position = 0; $stream.WriteByte(($originalByte -bxor 1)) } finally { $stream.Dispose() }
        $corruptRoot = Join-Path $testRoot "corrupt-toolchain"
        $corruptRejected = $false
        try { & (Join-Path $releaseScriptRoot "Install-PinnedInnoSetup.ps1") -DestinationRoot $corruptRoot -InstallerPath $corruptInstaller -PassThru | Out-Null } catch { $corruptRejected = $_.Exception.Message -match "SHA-256" }
        Assert-Condition $corruptRejected "A byte-corrupted Inno Setup bootstrapper was not rejected before execution."
        Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $corruptRoot "compiler\ISCC.exe"))) "The byte-corrupted Inno Setup bootstrapper reached execution."
    }
    Add-Pass "pinned-inno-toolchain" "Bootstrapper and compiler bytes, download bounds, product version, Authenticode status, exact publisher, and immediate pre-execution verification are enforced."

    Import-Module (Join-Path $PSScriptRoot "Blockwright-Paths.psm1") -Force
    Assert-Condition ((Get-BlockwrightPrivateNode -InstallRoot $installRoot) -eq (Join-Path $installRoot "runtime\node\node.exe")) "Private Node runtime resolution failed."
    $validLifecycleState = Join-Path ([System.IO.Path]::GetTempPath()) "Blockwright Installer Lifecycle 0123456789abcdef0123456789abcdef\state"
    $validLifecycleRoaming = Join-Path ([System.IO.Path]::GetTempPath()) "Blockwright Installer Lifecycle 0123456789abcdef0123456789abcdef\roaming"
    Assert-Condition (Test-BlockwrightInstalledStateRoot -Candidate $validLifecycleState) "Narrow disposable installer lifecycle state root was not accepted."
    Assert-Condition (Test-BlockwrightInstalledRoamingRoot -Candidate $validLifecycleRoaming) "Narrow disposable installer lifecycle roaming root was not accepted."
    Assert-Condition (-not (Test-BlockwrightInstalledStateRoot -Candidate $stateRoot)) "An arbitrary environment-selected state root was accepted as installed application state."
    $port = Get-FreePort
    $initialization = & (Join-Path $PSScriptRoot "Initialize-Blockwright.ps1") -InstallRoot $installRoot -StateRoot $stateRoot -Port $port -PassThru
    Assert-Condition ((Test-Path -LiteralPath $initialization.Configuration -PathType Leaf)) "First-run configuration was not created."
    Assert-Condition ((Get-BlockwrightConfiguration -InstallRoot $installRoot -StateRoot $stateRoot).port -eq $port) "Configured first-run port was not reloaded."
    $configurationBeforeRepair = [System.IO.File]::ReadAllText($initialization.Configuration)
    $null = & (Join-Path $PSScriptRoot "Initialize-Blockwright.ps1") -InstallRoot $installRoot -StateRoot $stateRoot -Port (Get-FreePort) -PreserveExistingConfiguration -PassThru
    Assert-Condition ([System.IO.File]::ReadAllText($initialization.Configuration).Equals($configurationBeforeRepair, [StringComparison]::Ordinal)) "Repair initialization rewrote existing user configuration."
    Add-Pass "first-run" "Per-user state and a validated loopback port were configured; repair initialization preserved the existing config bytes."

    $fakeCodexState = Join-Path $testRoot "fake-codex-state.json"
    $fakeCodexScript = Join-Path $testRoot "fake-codex.ps1"
    $fakeCodexCommand = Join-Path $testRoot "fake-codex.cmd"
    $env:BLOCKWRIGHT_FAKE_CODEX_STATE = $fakeCodexState
    $fakeCodexSource = @'
$ErrorActionPreference = "Stop"
$arguments = @($args | ForEach-Object { [string]$_ })
$statePath = $env:BLOCKWRIGHT_FAKE_CODEX_STATE
if ($arguments.Count -ge 3 -and $arguments[0] -eq "mcp" -and $arguments[1] -eq "get") {
    if ($env:BLOCKWRIGHT_FAKE_CODEX_GET_MODE -eq "unexpected-failure") {
        [Console]::Error.WriteLine("Codex configuration is unreadable in this fixture.")
        exit 2
    }
    if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
        [Console]::Error.WriteLine("Error: No MCP server named '$($arguments[2])' found.")
        exit 1
    }
    [Console]::Out.WriteLine([System.IO.File]::ReadAllText($statePath))
    exit 0
}
if ($arguments.Count -ge 5 -and $arguments[0] -eq "mcp" -and $arguments[1] -eq "add") {
    if ($env:BLOCKWRIGHT_FAKE_CODEX_ADD_MODE -eq "no-persist") { exit 0 }
    $transportArguments = if ($arguments.Count -gt 5) { @($arguments[5..($arguments.Count - 1)]) } else { @() }
    $configuration = [ordered]@{
        transport = [ordered]@{
            type = "stdio"
            command = $arguments[4]
            args = $transportArguments
        }
    }
    [System.IO.File]::WriteAllText($statePath, (($configuration | ConvertTo-Json -Depth 5) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    exit 0
}
if ($arguments.Count -ge 3 -and $arguments[0] -eq "mcp" -and $arguments[1] -eq "remove") {
    if ($env:BLOCKWRIGHT_FAKE_CODEX_REMOVE_MODE -eq "no-op") { exit 0 }
    if (Test-Path -LiteralPath $statePath -PathType Leaf) { Remove-Item -LiteralPath $statePath -Force }
    exit 0
}
[Console]::Error.WriteLine("Unsupported fake Codex arguments: $($arguments -join ' ')")
exit 2
'@
    [System.IO.File]::WriteAllText($fakeCodexScript, $fakeCodexSource, [Text.UTF8Encoding]::new($false))
    $fakeCodexCommandSource = '@echo off' + "`r`n" + '"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $fakeCodexScript + '" %*' + "`r`n" + 'exit /b %ERRORLEVEL%' + "`r`n"
    [System.IO.File]::WriteAllText($fakeCodexCommand, $fakeCodexCommandSource, [Text.UTF8Encoding]::new($false))
    $codexRegistrationScript = Join-Path $PSScriptRoot "Register-BlockwrightCodex.ps1"
    $codexRegistration = & $codexRegistrationScript -InstallRoot $installRoot -StateRoot $stateRoot -CodexExecutable $fakeCodexCommand -Confirm:$false -PassThru
    Assert-Condition ($codexRegistration.Status -eq "Registered") "Expected-not-found native stderr terminated Codex registration before the add operation."
    $codexMarkerPath = Join-Path $stateRoot "integration\codex.json"
    Assert-Condition ((Test-Path -LiteralPath $fakeCodexState -PathType Leaf) -and (Test-Path -LiteralPath $codexMarkerPath -PathType Leaf)) "Codex registration did not persist both CLI and ownership state."
    $codexAlreadyRegistered = & $codexRegistrationScript -InstallRoot $installRoot -StateRoot $stateRoot -CodexExecutable $fakeCodexCommand -Confirm:$false -PassThru
    Assert-Condition ($codexAlreadyRegistered.Status -eq "AlreadyRegistered") "A marker-proven exact Codex registration was not recognized idempotently."
    $windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $codexRemovalOutput = @(& $windowsPowerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $codexRegistrationScript -InstallRoot $installRoot -StateRoot $stateRoot -CodexExecutable $fakeCodexCommand -Remove 2>&1)
    $codexRemovalExitCode = $LASTEXITCODE
    Assert-Condition ($codexRemovalExitCode -eq 0) "Owned Codex cleanup failed with exit $codexRemovalExitCode. $($codexRemovalOutput -join ' ')"
    Assert-Condition (-not (Test-Path -LiteralPath $fakeCodexState) -and -not (Test-Path -LiteralPath $codexMarkerPath)) "Owned Codex cleanup left CLI or marker state behind."

    $null = & $codexRegistrationScript -InstallRoot $installRoot -StateRoot $stateRoot -CodexExecutable $fakeCodexCommand -Confirm:$false -PassThru
    $env:BLOCKWRIGHT_FAKE_CODEX_REMOVE_MODE = "no-op"
    $savedErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $global:LASTEXITCODE = $null
        $noOpRemovalOutput = @(& $windowsPowerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $codexRegistrationScript -InstallRoot $installRoot -StateRoot $stateRoot -CodexExecutable $fakeCodexCommand -Remove 2>&1)
        $noOpRemovalExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedErrorActionPreference
        Remove-Item Env:BLOCKWRIGHT_FAKE_CODEX_REMOVE_MODE -ErrorAction SilentlyContinue
    }
    Assert-Condition ($noOpRemovalExitCode -ne 0) "A Codex remove command that returned success without removing the entry was accepted."
    Assert-Condition ((Test-Path -LiteralPath $fakeCodexState -PathType Leaf) -and (Test-Path -LiteralPath $codexMarkerPath -PathType Leaf)) "Failed removal did not retain both the external entry and ownership marker for a safe retry."
    $retryRemovalOutput = @(& $windowsPowerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $codexRegistrationScript -InstallRoot $installRoot -StateRoot $stateRoot -CodexExecutable $fakeCodexCommand -Remove 2>&1)
    Assert-Condition ($LASTEXITCODE -eq 0) "Codex cleanup could not be retried after a no-op removal: $($retryRemovalOutput -join ' ')"
    Assert-Condition (-not (Test-Path -LiteralPath $fakeCodexState) -and -not (Test-Path -LiteralPath $codexMarkerPath)) "Retried Codex cleanup left CLI or marker state behind."

    $env:BLOCKWRIGHT_FAKE_CODEX_ADD_MODE = "no-persist"
    $missingPostconditionRejected = $false
    try {
        & $codexRegistrationScript -InstallRoot $installRoot -StateRoot $stateRoot -CodexExecutable $fakeCodexCommand -Confirm:$false -PassThru | Out-Null
    } catch {
        $missingPostconditionRejected = $_.Exception.Message -match "did not persist the exact Blockwright MCP configuration"
    } finally {
        Remove-Item Env:BLOCKWRIGHT_FAKE_CODEX_ADD_MODE -ErrorAction SilentlyContinue
    }
    Assert-Condition $missingPostconditionRejected "A zero-exit Codex add that persisted no entry was accepted."
    Assert-Condition (-not (Test-Path -LiteralPath $fakeCodexState) -and -not (Test-Path -LiteralPath $codexMarkerPath)) "Failed post-add verification created ownership state."

    $markerFailureStateRoot = Join-Path $testRoot "codex-marker-failure-state"
    $null = New-Item -ItemType Directory -Path $markerFailureStateRoot -Force
    [System.IO.File]::WriteAllText((Join-Path $markerFailureStateRoot "integration"), "marker directory blocked")
    $markerFailureRolledBack = $false
    try {
        & $codexRegistrationScript -InstallRoot $installRoot -StateRoot $markerFailureStateRoot -CodexExecutable $fakeCodexCommand -Confirm:$false -PassThru | Out-Null
    } catch {
        $markerFailureRolledBack = $_.Exception.Message -match "newly added Codex entry was rolled back"
    }
    Assert-Condition $markerFailureRolledBack "Codex registration did not report rollback when ownership-marker persistence failed."
    Assert-Condition (-not (Test-Path -LiteralPath $fakeCodexState)) "Codex registration left an unowned external entry after marker persistence failed."

    $null = & $codexRegistrationScript -InstallRoot $installRoot -StateRoot $stateRoot -CodexExecutable $fakeCodexCommand -Confirm:$false -PassThru
    Remove-Item -LiteralPath $codexMarkerPath -Force
    $unownedExactEntryRejected = $false
    try {
        & $codexRegistrationScript -InstallRoot $installRoot -StateRoot $stateRoot -CodexExecutable $fakeCodexCommand -Confirm:$false -PassThru | Out-Null
    } catch {
        $unownedExactEntryRejected = $_.Exception.Message -match "no ownership marker"
    }
    Assert-Condition $unownedExactEntryRejected "An exact external Codex entry without an ownership marker was silently adopted."
    Assert-Condition ((Test-Path -LiteralPath $fakeCodexState -PathType Leaf) -and -not (Test-Path -LiteralPath $codexMarkerPath)) "Unowned-entry rejection changed external or ownership state."
    Remove-Item -LiteralPath $fakeCodexState -Force
    $previousTestLastExitCode = $global:LASTEXITCODE
    try {
        $global:LASTEXITCODE = 0
        $missingExecutableRejected = $false
        try {
            & $codexRegistrationScript -InstallRoot $installRoot -StateRoot $stateRoot -CodexExecutable (Join-Path $testRoot "missing-codex.exe") -Confirm:$false -PassThru | Out-Null
        } catch {
            $missingExecutableRejected = $_.Exception.Message -match "could not be started|trustworthy exit code"
        }
        Assert-Condition $missingExecutableRejected "A missing Codex executable reused a stale zero LASTEXITCODE and was misreported as registered."
    } finally {
        $global:LASTEXITCODE = $previousTestLastExitCode
    }
    $env:BLOCKWRIGHT_FAKE_CODEX_GET_MODE = "unexpected-failure"
    $unexpectedProbeRejected = $false
    try {
        & $codexRegistrationScript -InstallRoot $installRoot -StateRoot $stateRoot -CodexExecutable $fakeCodexCommand -Confirm:$false -PassThru | Out-Null
    } catch {
        $unexpectedProbeRejected = $_.Exception.Message -match "MCP probe.+failed with exit code 2"
    } finally {
        Remove-Item Env:BLOCKWRIGHT_FAKE_CODEX_GET_MODE -ErrorAction SilentlyContinue
    }
    Assert-Condition $unexpectedProbeRejected "An unexpected Codex probe failure was misclassified as an absent MCP entry."
    Assert-Condition (-not (Test-Path -LiteralPath $fakeCodexState) -and -not (Test-Path -LiteralPath $codexMarkerPath)) "A failed Codex probe mutated CLI or ownership state."
    Add-Pass "codex-native-stderr-registration" "Expected not-found stderr proceeds to marker-proven registration; add/remove postconditions, marker-failure rollback, unowned exact-entry rejection, retryable cleanup, missing executables, and unexpected probes fail closed."

    $associationClassesRoot = Join-Path $associationTestRoot "Classes"
    $testExtensionKey = Join-Path $associationClassesRoot ".schem"
    $testOpenWithKey = Join-Path $testExtensionKey "OpenWithProgids"
    $null = New-Item -Path $testOpenWithKey -Force
    $null = New-ItemProperty -LiteralPath $testOpenWithKey -Name "Existing.Schematic.App" -PropertyType String -Value "" -Force
    Assert-Condition (Test-Path -LiteralPath $testOpenWithKey) "Disposable association fixture did not create the pre-existing OpenWithProgids subkey."
    $association = & (Join-Path $PSScriptRoot "Set-BlockwrightSchematicAssociation.ps1") -InstallRoot $installRoot -StateRoot $stateRoot -RegistryClassesRoot $associationClassesRoot -Confirm:$false -PassThru
    Assert-Condition ($association.Status -eq "Associated") "Disposable .schem association fixture was not registered."
    $associationMarker = [System.IO.File]::ReadAllText((Join-Path $stateRoot "integration\schem-association.json")) | ConvertFrom-Json
    Assert-Condition (-not [bool]$associationMarker.extensionKeyCreated) "Association marker did not record the pre-existing extension key."
    $associationRemoval = & (Join-Path $PSScriptRoot "Set-BlockwrightSchematicAssociation.ps1") -InstallRoot $installRoot -StateRoot $stateRoot -RegistryClassesRoot $associationClassesRoot -Remove -Confirm:$false -PassThru
    Assert-Condition ($associationRemoval.Status -eq "Removed") "Disposable .schem association fixture was not removed."
    $remainingAssociationPaths = @(if (Test-Path -LiteralPath $associationTestRoot) { Get-ChildItem -LiteralPath $associationTestRoot -Recurse | ForEach-Object { $_.Name } }) -join ","
    Assert-Condition (Test-Path -LiteralPath $testOpenWithKey) "Association cleanup deleted a pre-existing OpenWithProgids subkey. Remaining registry items: $remainingAssociationPaths"
    Assert-Condition ($null -ne (Get-ItemProperty -LiteralPath $testOpenWithKey -Name "Existing.Schematic.App" -ErrorAction SilentlyContinue)) "Association cleanup deleted a pre-existing non-default extension value."
    $restoredExtension = Get-Item -LiteralPath $testExtensionKey
    try { $defaultValueStillPresent = @($restoredExtension.GetValueNames()) -contains "" } finally { $restoredExtension.Dispose() }
    Assert-Condition (-not $defaultValueStillPresent) "Association cleanup created a default value that was absent before registration."
    Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $associationClassesRoot "Blockwright.Schematic.1"))) "Association cleanup left its owned ProgID behind."

    $rollbackClassesRoot = Join-Path $associationTestRoot "RollbackClasses"
    $rollbackExtensionKey = Join-Path $rollbackClassesRoot ".schem"
    $rollbackProgramKey = Join-Path $rollbackClassesRoot "Blockwright.Schematic.1"
    $null = New-Item -Path $rollbackExtensionKey -Force
    Set-Item -Path $rollbackExtensionKey -Value "Existing.Rollback.Schematic"
    $associationFailureStateRoot = Join-Path $testRoot "association-marker-failure-state"
    $null = New-Item -ItemType Directory -Path $associationFailureStateRoot -Force
    [System.IO.File]::WriteAllText((Join-Path $associationFailureStateRoot "integration"), "marker directory blocked")
    $associationMarkerFailureRolledBack = $false
    try {
        & (Join-Path $PSScriptRoot "Set-BlockwrightSchematicAssociation.ps1") -InstallRoot $installRoot -StateRoot $associationFailureStateRoot -RegistryClassesRoot $rollbackClassesRoot -Confirm:$false -PassThru | Out-Null
    } catch {
        $associationMarkerFailureRolledBack = $_.Exception.Message -match "prior .schem association was restored"
    }
    Assert-Condition $associationMarkerFailureRolledBack "A schematic-association marker failure did not report successful registry rollback."
    $rollbackExtension = Get-Item -LiteralPath $rollbackExtensionKey
    try { $rollbackDefault = [string]$rollbackExtension.GetValue("", $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } finally { $rollbackExtension.Dispose() }
    Assert-Condition ($rollbackDefault -ceq "Existing.Rollback.Schematic") "Schematic-association rollback did not restore the exact prior extension default."
    Assert-Condition (-not (Test-Path -LiteralPath $rollbackProgramKey)) "Schematic-association rollback left its partially created ProgID behind."
    Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $associationFailureStateRoot "integration\schem-association.json") -PathType Leaf)) "Schematic-association rollback left an ownership marker behind."

    $associationSource = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot "Set-BlockwrightSchematicAssociation.ps1"))
    foreach ($required in @("previousDefaultPresent", "extensionKeyCreated", 'DeleteValue("", $false)', "SubKeyCount", "ValueCount", "Undo-PartialAssociation", "Restore-OwnedAssociationForRetry")) { Assert-Condition ($associationSource.Contains($required)) "Association ownership contract is missing: $required" }
    Add-Pass "reversible-schem-association" "Removal restored only the prior default association and preserved unrelated extension state; marker-persistence failure rolled back the prior default and partial ProgID."

    [System.IO.File]::WriteAllText((Join-Path $stateRoot "logs\controller.log"), "user=$env:USERNAME home=$env:USERPROFILE Authorization: Bearer secret-token api_key=do-not-leak C:\Unrelated\private\world")
    [System.IO.File]::WriteAllText((Join-Path $stateRoot "projects\keep.blockwright"), "private project contents")
    [System.IO.File]::WriteAllText((Join-Path $stateRoot "exports\keep.schem"), "private schematic contents")
    [System.IO.File]::WriteAllText((Join-Path $stateRoot "palettes.json"), "private palette contents")
    $legacyPaletteRoot = Join-Path $env:APPDATA "Blockwright"
    $null = New-Item -ItemType Directory -Path $legacyPaletteRoot -Force
    [System.IO.File]::WriteAllText((Join-Path $legacyPaletteRoot "palettes.json"), "legacy private palette contents")
    $support = & (Join-Path $PSScriptRoot "New-BlockwrightSupportBundle.ps1") -InstallRoot $installRoot -StateRoot $stateRoot -OutputPath $bundlePath -PassThru
    Assert-Condition ((Test-Path -LiteralPath $support.Path -PathType Leaf)) "Support bundle was not created."
    Expand-Archive -LiteralPath $bundlePath -DestinationPath $expandedBundle
    $bundleText = @(Get-ChildItem -LiteralPath $expandedBundle -Recurse -File | ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName }) -join "`n"
    Assert-Condition ($bundleText -notmatch 'secret-token|do-not-leak|private project contents|private schematic contents|private palette contents') "Support bundle leaked a token or user content."
    Assert-Condition ($bundleText -match '%REDACTED_TOKEN%|%REDACTED_SECRET%') "Support bundle did not record redaction markers."
    Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $expandedBundle "projects"))) "Projects were included in the support bundle."
    Add-Pass "support-redaction" "Allowlisted diagnostics were redacted; projects, exports, worlds, and schematics were excluded."

    $installedOverrideRejected = $false
    try { & (Join-Path $PSScriptRoot "Remove-BlockwrightOwnedState.ps1") -InstallRoot $installRoot -StateRoot $stateRoot -InstalledUninstall -Confirm:$false -PassThru | Out-Null } catch { $installedOverrideRejected = $_.Exception.Message -match "Installed uninstall refused" }
    Assert-Condition $installedOverrideRejected "Installed uninstall accepted an arbitrary environment-selected state root."
    $cleanup = & (Join-Path $PSScriptRoot "Remove-BlockwrightOwnedState.ps1") -InstallRoot $installRoot -StateRoot $stateRoot -Confirm:$false -PassThru
    Assert-Condition ((Test-Path -LiteralPath (Join-Path $stateRoot "projects\keep.blockwright") -PathType Leaf)) "Default cleanup removed a user project."
    Assert-Condition ((Test-Path -LiteralPath (Join-Path $stateRoot "exports\keep.schem") -PathType Leaf)) "Default cleanup removed a user export."
    Assert-Condition ((Test-Path -LiteralPath (Join-Path $stateRoot "palettes.json") -PathType Leaf)) "Default cleanup removed user palettes."
    Assert-Condition ((Test-Path -LiteralPath (Join-Path $legacyPaletteRoot "palettes.json") -PathType Leaf)) "Default cleanup removed legacy user palettes."
    Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $stateRoot "config.json"))) "Default cleanup left installer-owned configuration behind."
    Assert-Condition ($cleanup.Preserved.Count -eq 3) "Default cleanup did not report projects, exports, and palettes as preserved."
    Add-Pass "safe-uninstall-cleanup" "Installer-owned state was removed while projects, exports, and palettes remained."

    $explicitCleanup = & (Join-Path $PSScriptRoot "Remove-BlockwrightOwnedState.ps1") -InstallRoot $installRoot -StateRoot $stateRoot -RemoveUserProjectsAndExports -Confirm:$false -PassThru
    Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $stateRoot "projects"))) "Explicit cleanup left projects behind."
    Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $stateRoot "exports"))) "Explicit cleanup left exports behind."
    Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $stateRoot "palettes.json"))) "Explicit cleanup left palettes behind."
    Assert-Condition (-not (Test-Path -LiteralPath $legacyPaletteRoot)) "Explicit cleanup left the now-empty exact legacy palette directory behind."
    Assert-Condition ([bool]$explicitCleanup.UserContentRemoved) "Explicit cleanup did not report user-content removal."
    Add-Pass "explicit-user-cleanup" "Projects, exports, current palettes, and the exact legacy palette file were removed only under the explicit destructive switch."

    $updateRejected = $false
    $updaterSelfTest = (& (Join-Path $PSScriptRoot "Update-Blockwright.ps1") -InstallRoot $installRoot -StateRoot $stateRoot -SelfTest) | ConvertFrom-Json
    Assert-Condition ([bool]$updaterSelfTest.DowngradeRejected -and [bool]$updaterSelfTest.ProductVersionMismatchRejected -and [bool]$updaterSelfTest.OversizeDownloadRejected -and [bool]$updaterSelfTest.PreservationStateTransitions) "Updater semantic/product version, bounded-download, or execution-state reporting self-test failed."
    try { & (Join-Path $PSScriptRoot "Update-Blockwright.ps1") -InstallRoot $installRoot -StateRoot $stateRoot -MetadataUri "http://example.invalid/latest.json" -TrustedPublisherThumbprint ("A" * 40) -CheckOnly } catch { $updateRejected = $_.Exception.Message -match "HTTPS" }
    Assert-Condition $updateRejected "Updater did not reject non-HTTPS metadata before network access."
    $updaterSource = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot "Update-Blockwright.ps1"))
    foreach ($required in @("Get-FileHash", "Get-AuthenticodeSignature", "Stop-BlockwrightManagedProcess", "signerThumbprint", "Assert-InstallerProductVersion", "AllowDowngrade", "maximumMetadataBytes", "maximumInstallerBytes", "TimeoutSeconds", "ExpectedBytes", "installerStarted", "previousInstallPreservation", "not-guaranteed", "installationSucceeded")) { Assert-Condition ($updaterSource.Contains($required)) "Updater contract fragment is missing: $required" }
    Add-Pass "updater-fail-closed" "HTTPS, bounded/time-limited streaming, published byte count, checksum, Authenticode, signer, downgrade, ProductVersion, and managed-stop gates are present."

    [pscustomobject]@{ valid = $true; tests = $results.Count; results = @($results | ForEach-Object { $_ }) } | ConvertTo-Json -Depth 8
} finally {
    $env:BLOCKWRIGHT_STATE_ROOT = $previousStateRoot
    $env:APPDATA = $previousAppData
    if ([string]::IsNullOrWhiteSpace($previousFakeCodexState)) { Remove-Item Env:BLOCKWRIGHT_FAKE_CODEX_STATE -ErrorAction SilentlyContinue } else { $env:BLOCKWRIGHT_FAKE_CODEX_STATE = $previousFakeCodexState }
    if ([string]::IsNullOrWhiteSpace($previousFakeCodexGetMode)) { Remove-Item Env:BLOCKWRIGHT_FAKE_CODEX_GET_MODE -ErrorAction SilentlyContinue } else { $env:BLOCKWRIGHT_FAKE_CODEX_GET_MODE = $previousFakeCodexGetMode }
    if ([string]::IsNullOrWhiteSpace($previousFakeCodexAddMode)) { Remove-Item Env:BLOCKWRIGHT_FAKE_CODEX_ADD_MODE -ErrorAction SilentlyContinue } else { $env:BLOCKWRIGHT_FAKE_CODEX_ADD_MODE = $previousFakeCodexAddMode }
    if ([string]::IsNullOrWhiteSpace($previousFakeCodexRemoveMode)) { Remove-Item Env:BLOCKWRIGHT_FAKE_CODEX_REMOVE_MODE -ErrorAction SilentlyContinue } else { $env:BLOCKWRIGHT_FAKE_CODEX_REMOVE_MODE = $previousFakeCodexRemoveMode }
    if (Test-Path -LiteralPath $associationTestRoot) { Remove-Item -LiteralPath $associationTestRoot -Recurse -Force }
    if ((Test-Path -LiteralPath $testRoot -PathType Container) -and $testRoot.StartsWith([System.IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
