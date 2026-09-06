# Blockwright Windows Control Center

Packaged copies start through the product-owned `Blockwright.exe`: an x64 .NET Framework WinExe with the Blockwright icon and release version embedded in its metadata. It resolves the installation from its own executable path, launches the existing Windows PowerShell/WPF Control Center through the explicit `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` runtime without a console, forwards activation arguments without reinterpreting them, waits for the controller, and returns its exit code. This is intentionally a thin native bootstrap; the Control Center remains PowerShell/WPF and the background application remains Node.js. `Launch-Blockwright-ControlCenter.vbs` is retained only as a script-compatible source/legacy fallback. `Launch-Blockwright-ControlCenter.cmd` uses `Blockwright.exe` when it is present and otherwise hands off through the explicit `%SystemRoot%\System32\wscript.exe` fallback. Neither path requires Electron, Python, or another UI runtime.

Packaged Windows releases carry a pinned private Windows x64 Node runtime at `runtime/node/` and never fall back to machine-wide Node/npm. Source checkouts retain PATH fallback for development only; `release-manifest.json` makes a missing private runtime a hard packaged-release failure.

The control center manages only the standalone Blockwright HTTP/MCP process that it starts. Closing the window now hides the controller to the notification area so supervision continues. **Exit** in the tray menu stops and confirms the exit of that owned process tree before closing; it does not stop the private, ephemeral Blockwright session servers launched by Codex or another terminal.

## Controls

- Start, stop, and restart the packaged production entry (`app/dist/__entry.js`, with `app/dist/server.js` as a compatibility fallback) directly with Node.js on stable loopback port `32147` by default. The process receives `NODE_ENV=production` and matching `__PORT`/`PORT` values. This intentionally avoids the historical legacy Blockwright port. Each launch also receives a new 256-bit MCP bearer token through its child environment; the token is never written to configuration, process arguments, managed-process records, diagnostics, or logs.
- Report the standalone MCP endpoint, `/ready` status, `/health` identity and uptime, authenticated MCP initialize result, PID, process uptime, and last exit code. The green **Running** state requires all three probes to identify `service=blockwright`, report the packaged version, and use the expected `ready`/`ok` status. Older, malformed, unauthenticated, or mismatched responders remain visibly unverified.
- Stream stdout and stderr continuously, with copy, clear, and save actions.
- Enforce one interactive controller per normalized installation root. A second shortcut or Jump List launch forwards **Open**, **New Build**, **Settings**, **Diagnostics**, or a `.schem` handoff through an install-keyed local named pipe; the primary instance performs the action and validates file input again.
- Stay available in the notification area with **Open Blockwright**, **New build / Open workbench**, current server/maintenance/update status, start/stop/restart, verified update check, diagnostics, state-location, and explicit exit actions. **New build** opens the existing workbench because the standalone server does not expose a safe dedicated new-task route.
- Set the version-independent Windows AppUserModelID `Blockwright.ControlCenter`. Its Jump List exposes **Open Blockwright**, **New Build**, **Settings**, and **Diagnostics**. Taskbar progress uses real task work units when the engine reports them, remains indeterminate when it does not, and briefly shows completed/error attention for terminal task transitions.
- Poll the authenticated `/mcp` endpoint every five seconds with the launch-private bearer and the read-only `list_tasks` tool. The request runs asynchronously with a 1.5-second timeout and 1 MiB response ceiling, so a stalled endpoint does not block the WPF timer. The first successful result establishes a no-notification baseline; later transitions notify once for completion or failure/interruption, while historical and intentionally cancelled tasks remain quiet.
- Persist sanitized controller and child-process output at `%LOCALAPPDATA%\Blockwright\logs\control-center.log` for an installed copy, with four 2 MiB rotating archives. Portable packages use their package-local state root. Install/state/user paths, usernames, bearer values, probable secrets, JWTs, and sensitive query parameters are redacted before the text reaches either the persistent file or the visible log.
- Reconcile an interrupted-session managed record on launch. A dead or PID-reused record is removed only after its install-root and private-runtime ownership fields validate. A still-running prior-session process is stopped only after PID, start time, install root, and executable all match; it cannot be adopted because the per-launch bearer token is intentionally never persisted. Malformed or unverifiable metadata is preserved and blocks a new start.
- Restart an unexpectedly exited server only after it has reached strict verified health (or while continuing an already armed recovery), with at most three scheduled restart attempts in a rolling five-minute window. Manual stop, update, and explicit exit cancel recovery. Notifications are limited to terminal task transitions and actionable crashes, exhausted/failed recovery, verified update availability/completion/failure, and maintenance failures.
- Run the shared Blockwright environment audit and show Node/npm compatibility, package and lock consistency, installed dependency versions, required build/data files, and integrity metadata.
- Validate every direct production dependency plus `npm ls` before start. Repair is serialized across controller and bridge processes by an OS-owned mutex, with `app/.blockwright-runtime-repair.lock` retained as inspectable owner metadata. It waits up to 120 seconds for another repair, safely recovers proven-stale legacy metadata while holding the mutex, and releases only its own token. It uses reproducible `npm ci --omit=dev --prefer-offline` when `app/package-lock.json` exists and falls back to `npm install --omit=dev --prefer-offline` only when no lockfile is available.

## Launch

In an installed or extracted package, double-click the root `Blockwright.exe`. From a source checkout, double-click `Launch-Blockwright-ControlCenter.cmd`, or run:

```powershell
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\scripts\windows\Blockwright-ControlCenter.ps1
```

From an installed/staged package root containing `Blockwright.exe`, add or update a user-scoped **Blockwright Control Center** shortcut in the Start Menu with:

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

Exercise the install identity, AppUserModelID/Jump List mapping, terminal-task notification deduplication, log redaction/rotation, bounded restart policy, and activation pipe without opening the window:

```powershell
powershell.exe -NoProfile -NonInteractive -File .\scripts\windows\Blockwright-ControlCenter.ps1 -SupervisorSelfTest
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

## v0.8 packaged distributions

The Windows release builder produces two forms from the same staged application:

- `Blockwright-<version>-windows-x64-portable.zip` keeps settings, logs, crashes, caches, projects, and exports under the extracted directory. Extract it completely and run the root `Blockwright.exe`; `scripts\windows\Start-Blockwright-Portable.cmd` is a convenience/compatibility entry that validates and starts that same executable.
- `Blockwright-<version>-windows-x64-setup.exe` is an Inno Setup installer with an interactive all-users/current-user scope choice. All-users installation uses Program Files and elevation; current-user installation uses the user's Programs directory and no elevation. Silent setup supports `/ALLUSERS` and `/CURRENTUSER`. Neither mode installs Node globally—the pinned runtime stays inside the Blockwright application directory.

Build on Windows with pinned Node 26.8.1 and Inno Setup 6.7.1:

```powershell
npm run package:windows:portable
npm run package:windows
```

The standard installer wrapper also exposes the signed-input boundary. Supply `-LauncherBinary` and `-TrustedPublisherThumbprint` together only after the launcher has been signed and timestamped by the protected publisher identity; the wrapper forwards both to the package builder, which verifies them before staging. Supplying only one is refused. Omitting both produces the explicitly unsigned local build described below.

The installer command acquires Inno Setup only from the immutable official 6.7.1 GitHub release into a fresh temporary directory. Before the bootstrapper executes, it enforces HTTPS with a 180-second/16 MiB bound, exact byte count and SHA-256, ProductVersion, a valid timestamped Authenticode signature, and the exact reviewed Pyrsys B.V. certificate subject and thumbprint. The resulting `ISCC.exe` is independently checked for exact bytes, SHA-256, timestamp, and signer again immediately before every compile; arbitrary or merely preinstalled compilers are refused. The temporary compiler is uninstalled and its exact acquisition root is removed after a local package build.

The builder likewise downloads the runtime ZIP with an explicit 300-second deadline and 64 MiB ceiling, verifies its exact published byte count and SHA-256 from `scripts/release/windows-release.json`, installs production packages using that private npm, compiles and validates the x64 GUI `Blockwright.exe`, inventories that nested launcher in the release manifest and both SBOMs, writes `SHA256SUMS.txt`, and labels the launcher and outer artifacts from local builds explicitly unsigned and untrusted. Run `npm run release:verify` to inspect the launcher inside the actual portable ZIP and check all other evidence. `release/` is generated and ignored.

The historical v0.6.0 MVP exception permits only that exact version's lifecycle-tested installer and portable ZIP to be an explicitly unsigned GitHub prerelease, alongside `SHA256SUMS.txt`, both SBOMs, and its unsigned signature-status file. It does not authorize an unsigned v0.8.0 or later release. Its release page must warn about the unknown publisher and SmartScreen, explain hash verification and manual installation, and make clear that a checksum is not a publisher signature. Do not publish `latest.json` for this channel: the protected updater intentionally accepts only signed installers, and prerelease upgrades are manual.

For the preferred signed stable channel, the manually dispatched protected workflow first signs and timestamp-verifies `Blockwright.exe`, packages those exact signed bytes into both distributions, signs and timestamp-verifies the outer installer, and then verifies the nested executable again from the portable ZIP. It must also generate and immediately verify GitHub Sigstore provenance for the portable ZIP and every checksum/update/signature manifest from the same qualified tag commit. The ZIP container itself is not Authenticode-signed. Creating a tag alone never starts this credentialed pipeline; without the nested signature and provenance gates, do not describe the package as trusted or signed.

## First run and optional integration

For a current-user install, the installer asks for a loopback port and validates it through `Initialize-Blockwright.ps1`. An all-users install leaves configuration account-owned; each user session starts from the packaged loopback default and creates its own state as needed. Blockwright binds only to `127.0.0.1`; production MCP requests—including Control Center task polling—must carry the launch-private bearer token and a loopback Host/Origin. Browser-facing `/api/local/editor` routes instead rely on the existing loopback-peer plus strict Host/Origin boundary and are not the Control Center polling path; the bearer is never placed in a browser URL or log. Codex integration and `.schem` association are available only to current-user setup because they are account-owned; users of a shared installation can run the packaged helpers later in their own session. Visible Control Center sign-in launch and minimized background-engine sign-in launch remain separate unchecked choices in either scope. Selecting neither sign-in option leaves Windows startup unchanged:

- Codex registration creates `blockwright-local` through `Launch-Blockwright-Mcp.cmd`, which prepends only the private runtime. It refuses to overwrite a foreign same-name entry and removes only an entry matching its ownership marker.
- The `.schem` helper stores the previous per-user association, registers an ownership-marked ProgID, and restores the old value only if Blockwright still owns the active association.

The current file handoff opens the Control Center and copies the validated schematic path to the clipboard; use **Import** in the workbench to select it. It never silently writes to a Minecraft world.

## Updates, recovery, and support

`Update-Blockwright.ps1` is fail-closed. Metadata is streamed under a 30-second/256 KiB limit. The installer is streamed under a 900-second/512 MiB limit and must match the metadata's exact published byte count. Redirects are limited to four HTTPS hops and compressed HTTP content encoding is refused. Before executing anything it also requires the published SHA-256, a `Valid` Authenticode signature, an exact trusted-publisher thumbprint match, a non-downgrade semantic version, and an installer ProductVersion matching that metadata. Only then may it stop the ownership-verified managed server and execute the installer. Failures retain bounded recovery evidence and never recursively remove the existing installation. `-AllowDowngrade` exists only for an explicit trusted recovery; it does not bypass transport, size, hash, signature, signer, or ProductVersion checks.

Unexpected server exits create a crash record with the restart disposition, attempt number, persistent-log location, and repair/support guidance. The notification-area supervisor schedules at most three restarts per rolling five minutes and stops retrying when that budget is exhausted. Create an allowlisted support archive with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\New-BlockwrightSupportBundle.ps1
```

The bundle excludes projects, exports, worlds, and schematics. It bounds file count and size and redacts usernames, home/install/state paths, bearer tokens, probable secrets, JWTs, sensitive query parameters, and unrelated absolute paths.

This controller remains a per-user, logged-in-session WPF/PowerShell supervisor, not a Windows service, and it does not survive sign-out. The taskbar, Jump List, and notification behavior belongs to the logged-in Control Center session. Notifications cover the retained compile-task contract exposed by `list_tasks`; they do not infer unrelated exports or work performed by separate Codex-managed MCP processes. The tray and Jump List **New Build** actions open the current workbench; the server does not yet provide a dedicated, ownership-safe new-build command. `.schem` activation validates and copies the path for explicit workbench import rather than silently importing or writing a world.

## Uninstall and saved content

A current-user uninstall removes installer-owned runtime files plus that account's owned config, cache, logs, crash records, updater work, integration markers, and run metadata. It preserves `projects`, `exports`, and `palettes.json`. An all-users uninstall removes the shared application and startup entries but deliberately leaves every account's per-user state and integrations untouched. To remove a current-user installation's user-created content explicitly, invoke its uninstaller with the separate destructive switch:

```powershell
# Current-user installation
& "$env:LOCALAPPDATA\Programs\Blockwright\unins000.exe" /REMOVEUSERDATA

```

Cleanup refuses state roots outside the exact portable, per-user, or test override locations. Under `/REMOVEUSERDATA` it also removes only the exact legacy `%APPDATA%\Blockwright\palettes.json` file, and removes that legacy parent only when empty. It refuses to stop a PID unless its start time, install root, and executable path prove it is the managed private-runtime process.

Run focused distribution controls with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\Test-WindowsDistribution.ps1
```

The Windows lifecycle workflow builds an older fixture and the current installer, then tests clean install, upgrade, same-version repair, readiness, managed stop, default-preserving uninstall, and explicit cleanup. See `installer/windows/SIGNING.md` and `installer/windows/WINGET.md` for external gates.
