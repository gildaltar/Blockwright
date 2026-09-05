# WinGet submission gate

Do not submit Blockwright to the Windows Package Manager repository until a signed installer has passed all clean-machine and real-world checks below.

The explicitly unsigned v0.6.0 MVP prerelease is not eligible for WinGet submission.

- The exact public installer URL is immutable and uses HTTPS.
- The manifest SHA-256 is calculated from the final Authenticode-signed installer, not from an unsigned precursor.
- Scope is `user`, architecture is `x64`, installer type is `inno`, and silent switches are `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART`.
- Publisher and package identity match the real signing certificate and the stable Inno `AppId`.
- Clean install, same-version repair, prior-version upgrade, readiness, managed stop, default uninstall, and `/REMOVEUSERDATA` uninstall have passed on supported Windows versions.
- Default uninstall preserves `projects` and `exports`; the destructive switch is documented separately and tested.
- Optional Codex and `.schem` integrations are opt-in, per-user, ownership-checked, and reversible.
- At least one real machine test confirms SmartScreen/signature presentation, Control Center launch, MCP use, schematic association, update, and rollback-safe failure behavior.

Only after those gates pass should the publisher create and validate the WinGet YAML manifests with `winget validate`, test them in Windows Sandbox, and open a submission pull request. This repository does not contain a pretend WinGet manifest or an unsigned submission path.
