[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$version = [string]((Get-Content -Raw -LiteralPath (Join-Path $repositoryRoot "package.json") | ConvertFrom-Json).version)
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("Blockwright Launcher Test " + [guid]::NewGuid().ToString("N"))
$launcherPath = Join-Path $testRoot "Blockwright.exe"
$controllerDirectory = Join-Path $testRoot "scripts\windows"
$controllerPath = Join-Path $controllerDirectory "Blockwright-ControlCenter.ps1"
$capturePath = Join-Path $testRoot "forwarded.json"
$previousCapture = $env:BLOCKWRIGHT_LAUNCHER_CAPTURE
$previousExitCode = $env:BLOCKWRIGHT_LAUNCHER_TEST_EXIT
$previousNoDialog = $env:BLOCKWRIGHT_LAUNCHER_NO_DIALOG
$testSucceeded = $false

function ConvertTo-WindowsCommandLineArgument {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value)
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
    $builder = New-Object System.Text.StringBuilder
    $null = $builder.Append('"')
    $backslashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') { $backslashes += 1; continue }
        if ($character -eq '"') {
            $null = $builder.Append(('\' * (($backslashes * 2) + 1)))
            $null = $builder.Append('"')
            $backslashes = 0
            continue
        }
        if ($backslashes -gt 0) { $null = $builder.Append(('\' * $backslashes)); $backslashes = 0 }
        $null = $builder.Append($character)
    }
    if ($backslashes -gt 0) { $null = $builder.Append(('\' * ($backslashes * 2))) }
    $null = $builder.Append('"')
    return $builder.ToString()
}

function Invoke-Launcher {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Arguments)
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $launcherPath
    $startInfo.Arguments = (@($Arguments | ForEach-Object { ConvertTo-WindowsCommandLineArgument -Value ([string]$_) }) -join ' ')
    $startInfo.WorkingDirectory = $testRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw "The native Blockwright launcher did not start." }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(60000)) {
        try { $process.Kill() } catch {}
        throw "The native Blockwright launcher exceeded its 60-second test bound."
    }
    $result = [pscustomobject]@{
        ExitCode = $process.ExitCode
        StandardOutput = $stdoutTask.Result
        StandardError = $stderrTask.Result
    }
    $process.Dispose()
    return $result
}

try {
    $null = New-Item -ItemType Directory -Path $controllerDirectory -Force
    powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $repositoryRoot "scripts\release\Build-BlockwrightLauncher.ps1") -OutputPath $launcherPath -Version $version | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Native launcher test build failed with exit code $LASTEXITCODE." }
    $binaryEvidence = powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $repositoryRoot "scripts\release\Test-BlockwrightLauncherBinary.ps1") -Artifact $launcherPath -Version $version -ExpectedAuthenticodeStatus NotSigned | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or [string]$binaryEvidence.architecture -cne "x64" -or [string]$binaryEvidence.subsystem -cne "windows-gui") { throw "Native launcher binary evidence is incomplete." }
    Add-Type -AssemblyName System.Drawing
    $embeddedIcon = [System.Drawing.Icon]::ExtractAssociatedIcon($launcherPath)
    if ($null -eq $embeddedIcon -or $embeddedIcon.Width -lt 16 -or $embeddedIcon.Height -lt 16) { throw "Blockwright.exe does not expose its embedded application icon." }
    $embeddedIcon.Dispose()

    $fixtureController = @'
[CmdletBinding()]
param(
    [switch]$Open,
    [switch]$NewBuild,
    [switch]$OpenSettings,
    [switch]$OpenDiagnostics,
    [string]$OpenSchematic,
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)][string[]]$Remaining
)
$record = [ordered]@{
    open = [bool]$Open
    newBuild = [bool]$NewBuild
    openSettings = [bool]$OpenSettings
    openDiagnostics = [bool]$OpenDiagnostics
    openSchematic = [string]$OpenSchematic
    remaining = @($Remaining)
    workingDirectory = [System.IO.Path]::GetFullPath((Get-Location).Path)
}
[System.IO.File]::WriteAllText($env:BLOCKWRIGHT_LAUNCHER_CAPTURE, (($record | ConvertTo-Json -Depth 5 -Compress) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
[Console]::Out.WriteLine("BLOCKWRIGHT_LAUNCHER_STDOUT")
[Console]::Error.WriteLine("BLOCKWRIGHT_LAUNCHER_STDERR")
exit [int]$env:BLOCKWRIGHT_LAUNCHER_TEST_EXIT
'@
    [System.IO.File]::WriteAllText($controllerPath, $fixtureController, (New-Object System.Text.UTF8Encoding($false)))
    $env:BLOCKWRIGHT_LAUNCHER_CAPTURE = $capturePath
    $env:BLOCKWRIGHT_LAUNCHER_TEST_EXIT = "37"
    $env:BLOCKWRIGHT_LAUNCHER_NO_DIALOG = "1"
    $schematic = "C:\Fixture Folder\quoted name.schem"
    $remaining = @("plain", "space value", 'quote"value', "ends-in-slash\")
    $launchResult = Invoke-Launcher -Arguments (@("--open", "--new-build", "--settings", "--diagnostics", "--open-schematic", $schematic) + $remaining)
    if ($launchResult.ExitCode -ne 37) { throw "Blockwright.exe did not preserve the controller exit code; expected 37, received $($launchResult.ExitCode)." }
    if ($launchResult.StandardOutput -notmatch 'BLOCKWRIGHT_LAUNCHER_STDOUT' -or $launchResult.StandardError -notmatch 'BLOCKWRIGHT_LAUNCHER_STDERR') { throw "Blockwright.exe did not preserve redirected controller output." }
    if (-not (Test-Path -LiteralPath $capturePath -PathType Leaf)) { throw "The fixture controller did not receive native launcher arguments." }
    $capture = Get-Content -Raw -LiteralPath $capturePath | ConvertFrom-Json
    if (-not [bool]$capture.open -or -not [bool]$capture.newBuild -or -not [bool]$capture.openSettings -or -not [bool]$capture.openDiagnostics) { throw "Native launcher activation aliases were not mapped to controller switches." }
    if ([string]$capture.openSchematic -cne $schematic) { throw "Native launcher schematic activation path changed in transit." }
    if ((@($capture.remaining) -join "`0") -cne ($remaining -join "`0")) { throw "Native launcher argument quoting changed spaces, quotes, or trailing backslashes." }
    if (-not ([System.IO.Path]::GetFullPath([string]$capture.workingDirectory)).Equals($testRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Native launcher did not use its own install root as the controller working directory." }

    Remove-Item -LiteralPath $controllerPath -Force
    $missingPayloadResult = Invoke-Launcher -Arguments @()
    if ($missingPayloadResult.ExitCode -ne 10 -or $missingPayloadResult.StandardError -notmatch 'Control Center is missing') { throw "Missing-controller launch did not report the bounded payload failure and exit code 10." }

    $testSucceeded = $true
    [pscustomobject][ordered]@{
        valid = $true
        version = $version
        architecture = [string]$binaryEvidence.architecture
        subsystem = [string]$binaryEvidence.subsystem
        icon = "embedded"
        activationAliases = "pass"
        argumentForwarding = "pass"
        streamForwarding = "pass"
        exitCodeForwarding = "pass"
        ownInstallRoot = "pass"
        missingPayloadFailure = "pass"
        sha256 = [string]$binaryEvidence.sha256
        sizeBytes = [long]$binaryEvidence.sizeBytes
        authenticode = [string]$binaryEvidence.authenticode
        trust = "unsigned-local-test-build"
    } | ConvertTo-Json -Compress
} finally {
    if ([string]::IsNullOrWhiteSpace($previousCapture)) { Remove-Item Env:BLOCKWRIGHT_LAUNCHER_CAPTURE -ErrorAction SilentlyContinue } else { $env:BLOCKWRIGHT_LAUNCHER_CAPTURE = $previousCapture }
    if ([string]::IsNullOrWhiteSpace($previousExitCode)) { Remove-Item Env:BLOCKWRIGHT_LAUNCHER_TEST_EXIT -ErrorAction SilentlyContinue } else { $env:BLOCKWRIGHT_LAUNCHER_TEST_EXIT = $previousExitCode }
    if ([string]::IsNullOrWhiteSpace($previousNoDialog)) { Remove-Item Env:BLOCKWRIGHT_LAUNCHER_NO_DIALOG -ErrorAction SilentlyContinue } else { $env:BLOCKWRIGHT_LAUNCHER_NO_DIALOG = $previousNoDialog }
    if ($testSucceeded -and (Test-Path -LiteralPath $testRoot -PathType Container)) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
    elseif (Test-Path -LiteralPath $testRoot -PathType Container) { Write-Warning "Native launcher test evidence was retained after failure at $testRoot." }
}
