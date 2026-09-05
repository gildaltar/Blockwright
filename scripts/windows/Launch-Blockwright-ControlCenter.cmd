@echo off
setlocal
start "" "%SystemRoot%\System32\wscript.exe" //nologo "%~dp0Launch-Blockwright-ControlCenter.vbs" %*
endlocal
exit /b 0
