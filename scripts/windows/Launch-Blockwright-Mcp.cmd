@echo off
setlocal
set "BLOCKWRIGHT_ROOT=%~dp0..\.."
set "BLOCKWRIGHT_NODE=%BLOCKWRIGHT_ROOT%\runtime\node\node.exe"
if not exist "%BLOCKWRIGHT_NODE%" (
  1>&2 echo Blockwright's private Node runtime is missing: "%BLOCKWRIGHT_NODE%"
  exit /b 2
)
if exist "%BLOCKWRIGHT_ROOT%\portable.flag" (
  set "BLOCKWRIGHT_STATE_ROOT=%BLOCKWRIGHT_ROOT%\data\state"
) else (
  if not defined BLOCKWRIGHT_STATE_ROOT (
    if not defined LOCALAPPDATA (
      1>&2 echo LOCALAPPDATA is required for installed Blockwright state.
      exit /b 3
    )
    set "BLOCKWRIGHT_STATE_ROOT=%LOCALAPPDATA%\Blockwright"
  )
)
set "BLOCKWRIGHT_STATE_DIR=%BLOCKWRIGHT_STATE_ROOT%"
set "NPM_CONFIG_CACHE=%BLOCKWRIGHT_STATE_ROOT%\npm-cache"
set "NPM_CONFIG_UPDATE_NOTIFIER=false"
set "PATH=%BLOCKWRIGHT_ROOT%\runtime\node;%PATH%"
"%BLOCKWRIGHT_NODE%" "%BLOCKWRIGHT_ROOT%\mcp\server.mjs"
exit /b %ERRORLEVEL%
