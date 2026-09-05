# Blockwright Windows installer

`Blockwright.iss` defines a Windows x64 per-user Inno Setup package with a stable `AppId`. It consumes only the staging directory created by `scripts/release/build-windows-release.mjs`; do not point it at an arbitrary source checkout.

The installer owns its application directory and the allowlisted state entries recorded by `Initialize-Blockwright.ps1`. Ordinary uninstall preserves projects, exports, and palettes. `/REMOVEUSERDATA` is the explicit opt-in to delete that user content plus the exact legacy `%APPDATA%\Blockwright\palettes.json` file.

Local builds are unsigned and remain labeled that way. The public v0.6.0 MVP is a one-version unsigned prerelease exception: its GitHub page and setup instructions must conspicuously say that Windows reports an unknown publisher and may show SmartScreen, publish the exact tested `SHA256SUMS.txt`, both SBOMs, and `blockwright-0.6.0-signature-status.json`, and direct users to continue only after verifying the hash and deciding to trust this repository. It is not eligible for the built-in updater or WinGet.

Signed stable releases remain the preferred channel. The manually dispatched signed-release workflow imports a real protected publisher certificate only inside the `windows-signing` environment, confirms its thumbprint, signs and verifies the final installer, regenerates checksums/update metadata from signed bytes, reruns lifecycle validation, and creates a draft for the separately approved publication workflow. Creating a tag alone never starts that credentialed pipeline.

Release prerequisites and human gates are documented in [SIGNING.md](SIGNING.md), [WINGET.md](WINGET.md), and [assets/README.md](assets/README.md).
