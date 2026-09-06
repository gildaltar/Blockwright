@echo off
setlocal
set "BLOCKWRIGHT_LAUNCHER=%~dp0..\..\Blockwright.exe"
if not exist "%BLOCKWRIGHT_LAUNCHER%" (
  start "" "%SystemRoot%\System32\wscript.exe" //nologo "%~dp0Launch-Blockwright-ControlCenter.vbs" %*
  exit /b 0
)
start "" "%BLOCKWRIGHT_LAUNCHER%" %*
endlocal
exit /b 0
