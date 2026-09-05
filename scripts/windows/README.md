# Blockwright Windows Control Center

`Launch-Blockwright-ControlCenter.vbs` is the stable launcher for shortcuts and opens a native Windows control panel built with Windows PowerShell and WPF without leaving a console window open. It uses the explicit `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` runtime. `Launch-Blockwright-ControlCenter.cmd` is a convenient double-click wrapper that hands off through explicit `%SystemRoot%\System32\wscript.exe` and exits immediately. Neither path requires Electron, Python, or another UI runtime.

Packaged v0.6 releases carry a pinned private Windows x64 Node runtime at `runtime/node/` and never fall back to machine-wide Node/npm. Source checkouts retain PATH fallback for development only; `release-manifest.json` makes a missing private runtime a hard packaged-release failure.

The control center manages only the standalone Blockwright HTTP/MCP process that it starts. Closing the window stops that process; it does not stop the private, ephemeral Blockwright session servers launched by Codex or another terminal.

## Controls

- Start, stop, and restart the packaged production entry (`app/dist/__entry.js`, with `app/dist/server.js` as a compatibility fallback) directly with Node.js on stable loopback port `32147` by default. The process receives `NODE_ENV=production` and matching `__PORT`/`PORT` values. This intentionally avoids the historical legacy Blockwright port. Each launch also receives a new 256-bit MCP bearer token through its child environment; the token is never written to configuration, process arguments, managed-process records, diagnostics, or logs.
- Report the standalone MCP endpoint, `/ready` status, `/health` identity and uptime, authenticated MCP initialize result, PID, process uptime, and last exit code. The green **Running** state requires all three probes to identify `service=blockwright`, report the packaged version, and use the expected `ready`/`ok` status. Older, malformed, unauthenticated, or mismatched responders remain visibly unverified.
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

## v0.6 packaged distributions

The Windows release builder produces two forms from the same staged application:

- `Blockwright-<version>-windows-x64-portable.zip` keeps settings, logs, crashes, caches, projects, and exports under the extracted directory. Extract it completely and run `scripts\windows\Start-Blockwright-Portable.cmd`.
- `Blockwright-<version>-windows-x64-setup.exe` is an Inno Setup per-user installer. Its default location is `%LOCALAPPDATA%\Programs\Blockwright`, so it needs no administrator access and does not install Node globally.

Build on Windows with pinned Node 26.8.1 and Inno Setup 6.7.1:

```powershell
npm run package:windows:portable
npm run package:windows
```

The installer command acquires Inno Setup only from the immutable official 6.7.1 GitHub release into a fresh temporary directory. Before the bootstrapper executes, it enforces HTTPS with a 180-second/16 MiB bound, exact byte count and SHA-256, ProductVersion, a valid timestamped Authenticode signature, and the exact reviewed Pyrsys B.V. certificate subject and thumbprint. The resulting `ISCC.exe` is independently checked for exact bytes, SHA-256, timestamp, and signer again immediately before every compile; arbitrary or merely preinstalled compilers are refused. The temporary compiler is uninstalled and its exact acquisition root is removed after a local package build.

The builder likewise downloads the runtime ZIP with an explicit 300-second deadline and 64 MiB ceiling, verifies its exact published byte count and SHA-256 from `scripts/release/windows-release.json`, installs production packages using that private npm, generates CycloneDX and SPDX SBOMs, writes `SHA256SUMS.txt`, and labels local output unsigned. Run `npm run release:verify` to check that evidence. `release/` is generated and ignored. A public portable ZIP is not Authenticode-signed; the protected tag workflow must generate and immediately verify GitHub Sigstore provenance for its digest and for every checksum/update/signature manifest from the same qualified tag commit. Without that attestation, the ZIP remains local/CI output and must not be published as trusted.

## First run and optional integration

The installer asks for a loopback port and validates it through `Initialize-Blockwright.ps1`. Blockwright binds only to `127.0.0.1`; production MCP requests must also carry the launch-private bearer token and a loopback Host/Origin. Codex integration and `.schem` association are separate unchecked choices:

- Codex registration creates `blockwright-local` through `Launch-Blockwright-Mcp.cmd`, which prepends only the private runtime. It refuses to overwrite a foreign same-name entry and removes only an entry matching its ownership marker.
- The `.schem` helper stores the previous per-user association, registers an ownership-marked ProgID, and restores the old value only if Blockwright still owns the active association.

The current file handoff opens the Control Center and copies the validated schematic path to the clipboard; use **Import** in the workbench to select it. It never silently writes to a Minecraft world.

## Updates, recovery, and support

`Update-Blockwright.ps1` is fail-closed. Metadata is streamed under a 30-second/256 KiB limit. The installer is streamed under a 900-second/512 MiB limit and must match the metadata's exact published byte count. Redirects are limited to four HTTPS hops and compressed HTTP content encoding is refused. Before executing anything it also requires the published SHA-256, a `Valid` Authenticode signature, an exact trusted-publisher thumbprint match, a non-downgrade semantic version, and an installer ProductVersion matching that metadata. Only then may it stop the ownership-verified managed server and execute the installer. Failures retain bounded recovery evidence and never recursively remove the existing installation. `-AllowDowngrade` exists only for an explicit trusted recovery; it does not bypass transport, size, hash, signature, signer, or ProductVersion checks.

Unexpected server exits create a crash record with restart/repair/support guidance. Create an allowlisted support archive with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\New-BlockwrightSupportBundle.ps1
```

The bundle excludes projects, exports, worlds, and schematics. It bounds file count and size and redacts usernames, home/install/state paths, bearer tokens, probable secrets, JWTs, sensitive query parameters, and unrelated absolute paths.

## Uninstall and saved content

Normal uninstall removes installer-owned runtime files plus owned config, cache, logs, crash records, updater work, integration markers, and run metadata. It preserves `projects`, `exports`, and `palettes.json`. To remove that user-created content explicitly, invoke the installed uninstaller with the separate destructive switch:

```powershell
& "$env:LOCALAPPDATA\Programs\Blockwright\unins000.exe" /REMOVEUSERDATA
```

Cleanup refuses state roots outside the exact portable, per-user, or test override locations. Under `/REMOVEUSERDATA` it also removes only the exact legacy `%APPDATA%\Blockwright\palettes.json` file, and removes that legacy parent only when empty. It refuses to stop a PID unless its start time, install root, and executable path prove it is the managed private-runtime process.

Run focused distribution controls with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\Test-WindowsDistribution.ps1
```

The Windows lifecycle workflow builds an older fixture and the current installer, then tests clean install, upgrade, same-version repair, readiness, managed stop, default-preserving uninstall, and explicit cleanup. See `installer/windows/SIGNING.md` and `installer/windows/WINGET.md` for external gates.
