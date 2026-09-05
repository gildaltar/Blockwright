#define MyAppName "Blockwright"
#define MyAppPublisher "Blockwright"
#define MyAppURL "https://github.com/gildaltar/Blockwright"
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0-local"
#endif
#ifndef StageDir
  #define StageDir "..\..\release\windows\.work\installer\Blockwright"
#endif
#ifndef ReleaseOutputDir
  #define ReleaseOutputDir "..\..\release\windows"
#endif

[Setup]
AppId={{2D75D5A7-BC78-4BBE-B0BC-5B8D0366C4B4}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={localappdata}\Programs\Blockwright
DefaultGroupName=Blockwright
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#ReleaseOutputDir}
OutputBaseFilename=Blockwright-{#MyAppVersion}-windows-x64-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
SetupLogging=yes
ChangesAssociations=yes
Uninstallable=yes
VersionInfoVersion={#MyAppVersion}
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription=Blockwright per-user Windows installer
SetupIconFile=assets\blockwright-v060.ico
UninstallDisplayIcon={app}\assets\blockwright-v060.ico

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked
Name: "codexintegration"; Description: "Register Blockwright's private-runtime MCP bridge with &Codex"; GroupDescription: "Optional integrations:"; Flags: unchecked
Name: "schemassociation"; Description: "Associate &.schem files with Blockwright for this Windows user"; GroupDescription: "Optional integrations:"; Flags: unchecked

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "portable.flag"

[Icons]
Name: "{group}\Blockwright Control Center"; Filename: "{sys}\wscript.exe"; Parameters: "//nologo ""{app}\scripts\windows\Launch-Blockwright-ControlCenter.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\assets\blockwright-v060.ico"
Name: "{group}\Create redacted support bundle"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\windows\New-BlockwrightSupportBundle.ps1"" -InstallRoot ""{app}"""; WorkingDir: "{app}"; IconFilename: "{app}\assets\blockwright-v060.ico"
Name: "{autodesktop}\Blockwright"; Filename: "{sys}\wscript.exe"; Parameters: "//nologo ""{app}\scripts\windows\Launch-Blockwright-ControlCenter.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\assets\blockwright-v060.ico"; Tasks: desktopicon

[Run]
Filename: "{sys}\wscript.exe"; Parameters: "//nologo ""{app}\scripts\windows\Launch-Blockwright-ControlCenter.vbs"""; Description: "Launch Blockwright Control Center"; Flags: nowait postinstall skipifsilent

[Code]
var
  PortPage: TInputQueryWizardPage;
  UninstallCleanupExecuted: Boolean;
  CodexIntegrationStatus: String;
  SchematicAssociationStatus: String;
  IntegrationWarnings: String;
  RequiredPostInstallFailed: Boolean;
  RequiredPostInstallFailureMessage: String;

procedure InitializeWizard;
begin
  PortPage := CreateInputQueryPage(wpSelectTasks,
    'Local server port',
    'Choose the loopback port used by the Blockwright companion.',
    'Blockwright binds only to 127.0.0.1. The default works for most installations.');
  PortPage.Add('Port:', False);
  PortPage.Values[0] := '32147';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  PortValue: Integer;
begin
  Result := True;
  if CurPageID = PortPage.ID then
  begin
    PortValue := StrToIntDef(Trim(PortPage.Values[0]), 0);
    if (PortValue < 1024) or (PortValue > 65535) then
    begin
      MsgBox('Choose a port from 1024 through 65535.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

function GetSelectedPort(Param: String): String;
begin
  if Assigned(PortPage) then
    Result := Trim(PortPage.Values[0])
  else
    Result := '32147';
end;

function IsHexCharacter(Value: Char): Boolean;
begin
  Result := ((Value >= '0') and (Value <= '9')) or
    ((Value >= 'a') and (Value <= 'f')) or
    ((Value >= 'A') and (Value <= 'F'));
end;

function IsLifecycleTestDirectoryName(Value: String): Boolean;
var
  Index: Integer;
  Suffix: String;
begin
  Result := False;
  if CompareText(Copy(Value, 1, 32), 'Blockwright Installer Lifecycle ') <> 0 then
    Exit;
  Suffix := Copy(Value, 33, Length(Value));
  if Length(Suffix) <> 32 then
    Exit;
  for Index := 1 to Length(Suffix) do
    if not IsHexCharacter(Suffix[Index]) then
      Exit;
  Result := True;
end;

function GetValidatedLifecycleTestRoot(EnvironmentName: String; LeafName: String): String;
var
  RawValue: String;
  Candidate: String;
  LifecycleRoot: String;
  LifecycleParent: String;
  TemporaryRoot: String;
  CanonicalLifecycleParent: String;
  CanonicalTemporaryRoot: String;
begin
  Result := '';
  RawValue := GetEnv(EnvironmentName);
  if RawValue = '' then
    Exit;
  if (Pos('"', RawValue) > 0) or (Pos(#13, RawValue) > 0) or (Pos(#10, RawValue) > 0) then
    RaiseException('Invalid ' + EnvironmentName + ' path supplied to the installer lifecycle fixture.');
  Candidate := RemoveBackslashUnlessRoot(ExpandFileName(RawValue));
  if CompareText(ExtractFileName(Candidate), LeafName) <> 0 then
    RaiseException(EnvironmentName + ' must name the exact ' + LeafName + ' lifecycle-test directory.');
  LifecycleRoot := RemoveBackslashUnlessRoot(ExtractFileDir(Candidate));
  LifecycleParent := RemoveBackslashUnlessRoot(ExtractFileDir(LifecycleRoot));
  TemporaryRoot := RemoveBackslashUnlessRoot(ExpandFileName(GetTempDir));
  { GitHub-hosted Windows runners can expose one temporary directory through
    both its long and 8.3 aliases. Canonicalize the two existing parent
    directories before enforcing the immediate-child boundary. }
  CanonicalLifecycleParent := RemoveBackslashUnlessRoot(GetShortName(LifecycleParent));
  CanonicalTemporaryRoot := RemoveBackslashUnlessRoot(GetShortName(TemporaryRoot));
  Log(EnvironmentName + ' lifecycle parent: ' + LifecycleParent);
  Log(EnvironmentName + ' Windows temporary root: ' + TemporaryRoot);
  Log(EnvironmentName + ' canonical lifecycle parent: ' + CanonicalLifecycleParent);
  Log(EnvironmentName + ' canonical Windows temporary root: ' + CanonicalTemporaryRoot);
  if (CompareText(LifecycleParent, TemporaryRoot) <> 0) and
    (CompareText(CanonicalLifecycleParent, CanonicalTemporaryRoot) <> 0) then
    RaiseException(EnvironmentName + ' must be an immediate lifecycle-test child of the Windows temporary directory.');
  if not IsLifecycleTestDirectoryName(ExtractFileName(LifecycleRoot)) then
    RaiseException(EnvironmentName + ' does not contain the required random lifecycle-test directory name.');
  Result := Candidate;
end;

function GetInstallerStateRoot(Param: String): String;
begin
  Result := GetValidatedLifecycleTestRoot('BLOCKWRIGHT_INSTALLER_TEST_STATE_ROOT', 'state');
  if Result = '' then
    Result := ExpandConstant('{localappdata}\Blockwright');
end;

function GetInstallerRoamingRoot(Param: String): String;
begin
  Result := GetValidatedLifecycleTestRoot('BLOCKWRIGHT_INSTALLER_TEST_ROAMING_ROOT', 'roaming');
  if Result = '' then
    Result := ExpandConstant('{userappdata}');
end;

function RunSetupPowerShellScript(ScriptName: String; ScriptArguments: String;
  StepDescription: String; Required: Boolean): Boolean;
var
  Parameters: String;
  ResultCode: Integer;
begin
  WizardForm.StatusLabel.Caption := StepDescription;
  ResultCode := -1;
  Parameters := '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{app}\scripts\windows\' + ScriptName) + '" ' + ScriptArguments;
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Parameters,
    ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if not Result then
  begin
    if Required then
      RaiseException(StepDescription + ' could not start. Blockwright setup did not complete.')
    else
      ResultCode := -1;
  end;
  if Result and (ResultCode <> 0) then
  begin
    Result := False;
    if Required then
      RaiseException(StepDescription + ' failed with exit code ' + IntToStr(ResultCode) +
        '. Blockwright setup did not complete. The installed Control Center can be used to diagnose or repair the package.');
  end;
  if not Result then
    Log(StepDescription + ' failed with exit code ' + IntToStr(ResultCode) + '.');
end;

procedure AppendIntegrationWarning(IntegrationName: String; ResultCodeText: String;
  RecoveryCommand: String);
var
  WarningText: String;
begin
  WarningText := IntegrationName + ' could not be enabled (' + ResultCodeText + '). ' +
    'Blockwright itself was installed. Retry from Windows PowerShell with:' + #13#10 +
    RecoveryCommand;
  if IntegrationWarnings = '' then
    IntegrationWarnings := WarningText
  else
    IntegrationWarnings := IntegrationWarnings + #13#10 + #13#10 + WarningText;
end;

procedure WriteInstallerIntegrationStatus;
var
  StatusRoot: String;
  StatusPath: String;
  StatusText: String;
begin
  StatusRoot := AddBackslash(GetInstallerStateRoot('')) + 'integration';
  ForceDirectories(StatusRoot);
  StatusPath := AddBackslash(StatusRoot) + 'installer-status.txt';
  StatusText := 'schemaVersion=1' + #13#10 +
    'codexintegration=' + CodexIntegrationStatus + #13#10 +
    'schemassociation=' + SchematicAssociationStatus + #13#10;
  if not SaveStringToFile(StatusPath, StatusText, False) then
    RaiseException('Could not write the installer integration status file: ' + StatusPath +
      '. Blockwright setup cannot safely report the selected integration results.');
end;

procedure RunBlockwrightPostInstall;
var
  CommonArguments: String;
  StepSucceeded: Boolean;
begin
  CodexIntegrationStatus := 'not-selected';
  SchematicAssociationStatus := 'not-selected';
  IntegrationWarnings := '';
  CommonArguments := '-InstallRoot "' + ExpandConstant('{app}') + '" -StateRoot "' +
    GetInstallerStateRoot('') + '"';

  RunSetupPowerShellScript('Initialize-Blockwright.ps1', CommonArguments + ' -Port ' +
    GetSelectedPort('') + ' -InstallerMode -PreserveExistingConfiguration',
    'Configuring Blockwright', True);

  if WizardIsTaskSelected('codexintegration') then
  begin
    StepSucceeded := RunSetupPowerShellScript('Register-BlockwrightCodex.ps1', CommonArguments,
      'Registering the optional Codex integration', False);
    if StepSucceeded then
      CodexIntegrationStatus := 'pass'
    else
    begin
      CodexIntegrationStatus := 'failed';
      AppendIntegrationWarning('The optional Codex integration', 'see the setup log for its exit code',
        'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' +
        ExpandConstant('{app}\scripts\windows\Register-BlockwrightCodex.ps1') + '" -InstallRoot "' +
        ExpandConstant('{app}') + '"');
    end;
  end;

  if WizardIsTaskSelected('schemassociation') then
  begin
    StepSucceeded := RunSetupPowerShellScript('Set-BlockwrightSchematicAssociation.ps1', CommonArguments,
      'Registering the optional .schem association', False);
    if StepSucceeded then
      SchematicAssociationStatus := 'pass'
    else
    begin
      SchematicAssociationStatus := 'failed';
      AppendIntegrationWarning('The optional .schem association', 'see the setup log for its exit code',
        'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' +
        ExpandConstant('{app}\scripts\windows\Set-BlockwrightSchematicAssociation.ps1') + '" -InstallRoot "' +
        ExpandConstant('{app}') + '"');
    end;
  end;

  WriteInstallerIntegrationStatus;
  if IntegrationWarnings <> '' then
    SuppressibleMsgBox('Blockwright installed with optional integration warnings.' + #13#10 + #13#10 +
      IntegrationWarnings + #13#10 + #13#10 + 'These results were saved to ' +
      AddBackslash(GetInstallerStateRoot('')) + 'integration\installer-status.txt.',
      mbError, MB_OK, IDOK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep <> ssPostInstall then
    Exit;

  RequiredPostInstallFailed := False;
  RequiredPostInstallFailureMessage := '';
  try
    RunBlockwrightPostInstall;
  except
    RequiredPostInstallFailed := True;
    RequiredPostInstallFailureMessage := GetExceptionMessage;
    Log('Required Blockwright post-install configuration failed: ' +
      RequiredPostInstallFailureMessage);
    SuppressibleMsgBox('Blockwright setup did not complete its required configuration.' + #13#10 + #13#10 +
      RequiredPostInstallFailureMessage + #13#10 + #13#10 +
      'The application files were copied, but setup will return a failure code. ' +
      'Correct the reported problem and run the installer again.',
      mbError, MB_OK, IDOK);
  end;
end;

function GetCustomSetupExitCode: Integer;
begin
  if RequiredPostInstallFailed then
    Result := 100
  else
    Result := 0;
end;

function UninstallArgumentPresent(Name: String): Boolean;
var
  Index: Integer;
begin
  Result := False;
  for Index := 1 to ParamCount do
    if CompareText(ParamStr(Index), Name) = 0 then
      Result := True;
end;

function ShouldRemoveUserData: Boolean;
begin
  Result := UninstallArgumentPresent('/REMOVEUSERDATA');
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  CleanupParameters: String;
  ResultCode: Integer;
  RemoveUserData: Boolean;
begin
  if (CurUninstallStep <> usUninstall) or UninstallCleanupExecuted then
    Exit;
  UninstallCleanupExecuted := True;
  CleanupParameters := '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{app}\scripts\windows\Register-BlockwrightCodex.ps1') + '" -InstallRoot "' +
    ExpandConstant('{app}') + '" -StateRoot "' + GetInstallerStateRoot('') + '" -Remove';
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), CleanupParameters,
    ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    RaiseException('Could not start Blockwright Codex integration cleanup during uninstall.');
  if ResultCode <> 0 then
    RaiseException('Blockwright Codex integration cleanup failed with exit code ' + IntToStr(ResultCode) + '.');

  CleanupParameters := '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{app}\scripts\windows\Set-BlockwrightSchematicAssociation.ps1') + '" -InstallRoot "' +
    ExpandConstant('{app}') + '" -StateRoot "' + GetInstallerStateRoot('') + '" -Remove';
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), CleanupParameters,
    ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    RaiseException('Could not start Blockwright schematic association cleanup during uninstall.');
  if ResultCode <> 0 then
    RaiseException('Blockwright schematic association cleanup failed with exit code ' + IntToStr(ResultCode) + '.');

  CleanupParameters := '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{app}\scripts\windows\Remove-BlockwrightOwnedState.ps1') + '" -InstallRoot "' +
    ExpandConstant('{app}') + '" -StateRoot "' + GetInstallerStateRoot('') + '" -LegacyRoamingRoot "' +
    GetInstallerRoamingRoot('') + '" -InstalledUninstall -Unattended';
  RemoveUserData := ShouldRemoveUserData;
  if RemoveUserData then
    CleanupParameters := CleanupParameters + ' -RemoveUserProjectsAndExports';
  if RemoveUserData then
    Log('Running uninstall-time Blockwright state cleanup with explicit user-data removal.')
  else
    Log('Running uninstall-time Blockwright state cleanup while preserving user-created content.');
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), CleanupParameters,
    ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    RaiseException('Could not start Blockwright state cleanup during uninstall.');
  if ResultCode <> 0 then
    RaiseException('Blockwright state cleanup failed with exit code ' + IntToStr(ResultCode) + '.');
end;
