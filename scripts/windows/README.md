# Blockwright Windows Control Center

`Launch-Blockwright-ControlCenter.vbs` is the stable launcher for shortcuts and opens a native Windows control panel built with Windows PowerShell and WPF without leaving a console window open. It uses the explicit `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` runtime. `Launch-Blockwright-ControlCenter.cmd` is a convenient double-click wrapper that hands off through explicit `%SystemRoot%\System32\wscript.exe` and exits immediately. Neither path requires Electron, Python, or another UI runtime.

The control center manages only the standalone Blockwright HTTP/MCP process that it starts. Closing the window stops that process; it does not stop the private, ephemeral Blockwright session servers launched by Codex or another terminal.

## Controls

- Start, stop, and restart the packaged production entry (`app/dist/__entry.js`, with `app/dist/server.js` as a compatibility fallback) directly with Node.js on stable loopback port `32147` by default. The process receives `NODE_ENV=production` and matching `__PORT`/`PORT` values. This intentionally avoids the historical legacy Blockwright port.
- Report the standalone MCP endpoint, `/ready` status, `/health` identity and uptime, PID, process uptime, and last exit code. The green **Running** state requires both routes to identify `service=blockwright`, report the packaged version, and use the expected `ready`/`ok` status. Older, malformed, or mismatched responders remain visibly unverified.
- Stream stdout and stderr continuously, with copy, clear, and save actions.
- Run the shared Blockwright environment audit and show Node/npm compatibility, package and lock consistency, installed dependency versions, required build/data files, and integrity metadata.
- Validate every direct production dependency plus `npm ls` before start. Repair is serialized across controller and bridge processes by an OS-owned mutex, with `app/.blockwright-runtime-repair.lock` retained as inspectable owner metadata. It waits up to 120 seconds for another repair, safely recovers proven-stale legacy metadata while holding the mutex, and releases only its own token. It uses reproducible `npm ci --omit=dev --prefer-offline` when `app/package-lock.json` exists and falls back to `npm install --omit=dev --prefer-offline` only when no lockfile is available.

## Launch

Double-click `Launch-Blockwright-ControlCenter.cmd`, or run:

```powershell
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\scripts\windows\Blockwright-ControlCenter.ps1
```

To add or update a user-scoped **Blockwright Control Center** shortcut in the Start Menu:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\Install-BlockwrightShortcut.ps1
```

The installer updates only a shortcut whose target, arguments, and description prove that it belongs to this package. If a same-name shortcut is present but not owned, the installer refuses to overwrite it. To preserve that shortcut beside the new owned shortcut, opt in explicitly:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\Install-BlockwrightShortcut.ps1 -BackupExisting
```

To remove only that exact helper-created shortcut:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\Install-BlockwrightShortcut.ps1 -Remove
```

## Headless checks

Machine-readable environment diagnostics:

```powershell
powershell.exe -NoProfile -File .\scripts\windows\Blockwright-ControlCenter.ps1 -Diagnostics -Json
```

Validate that the WPF layout parses and all expected named controls exist without opening the window:

```powershell
powershell.exe -NoProfile -STA -File .\scripts\windows\Blockwright-ControlCenter.ps1 -ValidateUi
```

Run a bounded start/readiness/stop smoke test (this can install missing packaged runtime dependencies on first launch):

```powershell
powershell.exe -NoProfile -File .\scripts\windows\Blockwright-ControlCenter.ps1 -SmokeTest -SmokeTestSeconds 45 -Json
```

Pass `-PluginRoot C:\path\to\blockwright` when testing a package other than the one containing this script. Pass `-Port 32148` (or another open loopback port) to override the default `32147`.

Run the disposable Windows integration suite (safe for `windows-latest`; it uses a temporary shortcut directory and leaves no server, lock, or shortcut behind):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\Test-ControlCenter.ps1
```
