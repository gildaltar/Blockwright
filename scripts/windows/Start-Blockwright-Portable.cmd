@echo off
setlocal
set "BLOCKWRIGHT_ROOT=%~dp0..\.."
if not exist "%BLOCKWRIGHT_ROOT%\portable.flag" (
  1>&2 echo This launcher is for the Blockwright portable ZIP and portable.flag is missing.
  exit /b 2
)
start "" "%SystemRoot%\System32\wscript.exe" //nologo "%~dp0Launch-Blockwright-ControlCenter.vbs"
endlocal
exit /b 0
