# Blockwright Windows installer

`Blockwright.iss` defines a Windows x64 per-user Inno Setup package with a stable `AppId`. It consumes only the staging directory created by `scripts/release/build-windows-release.mjs`; do not point it at an arbitrary source checkout.

The installer owns its application directory and the allowlisted state entries recorded by `Initialize-Blockwright.ps1`. Ordinary uninstall preserves projects, exports, and palettes. `/REMOVEUSERDATA` is the explicit opt-in to delete that user content plus the exact legacy `%APPDATA%\Blockwright\palettes.json` file.

Local builds are unsigned and remain labeled that way. The tag workflow imports a real protected publisher certificate only inside the `windows-signing` environment, confirms its thumbprint, signs and verifies the final installer, regenerates checksums/update metadata from signed bytes, reruns lifecycle validation, and creates a draft rather than a public GitHub release.

Release prerequisites and human gates are documented in [SIGNING.md](SIGNING.md), [WINGET.md](WINGET.md), and [assets/README.md](assets/README.md).
