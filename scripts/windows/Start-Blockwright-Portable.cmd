@echo off
setlocal
set "BLOCKWRIGHT_ROOT=%~dp0..\.."
if not exist "%BLOCKWRIGHT_ROOT%\portable.flag" (
  1>&2 echo This launcher is for the Blockwright portable ZIP and portable.flag is missing.
  exit /b 2
)
if not exist "%BLOCKWRIGHT_ROOT%\Blockwright.exe" (
  1>&2 echo The native Blockwright launcher is missing from this portable package.
  exit /b 3
)
start "" "%BLOCKWRIGHT_ROOT%\Blockwright.exe"
endlocal
exit /b 0
