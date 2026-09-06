# Windows signing and unsigned-prerelease boundary

Stable and paid Windows artifacts require a real Authenticode code-signing identity controlled by the Blockwright publisher. Local and pull-request builds keep both the nested `Blockwright.exe` and the outer installer explicitly **unsigned** and untrusted; their `blockwright-<version>-signature-status.json` sets `satisfiesSignedReleaseGate` to `false` and records the launcher's actual nested status and digest.

## Historical v0.6.0 unsigned MVP exception

The exact v0.6.0 Windows build may be published only as an explicitly **unsigned GitHub prerelease**. This exception does not extend to v0.8.0 or later and does not satisfy or weaken the signed-release gate. Its release page must include a conspicuous unknown-publisher/SmartScreen warning, manual install steps, the tested installer and portable ZIP, `SHA256SUMS.txt`, both SBOMs, and the unsigned signature-status file. It must not include signed update metadata, claim Authenticode or Sigstore provenance, appear in WinGet, or be described as stable.

Users should download only from `https://github.com/gildaltar/Blockwright/releases/tag/v0.6.0`, compare the selected asset with `SHA256SUMS.txt` using `Get-FileHash`, and proceed through **More info → Run anyway** only when the hash matches and they independently trust this repository. The checksum detects corruption or changed bytes but does not authenticate the publisher. Because the updater correctly rejects unsigned installers, upgrades from this prerelease are manual.

## Signed stable-release gate

The manually dispatched signed-release workflow is allowed to create a draft release only after all of the following succeed. Creating or pushing a tag alone never starts this credentialed pipeline:

Configure the same non-secret `BLOCKWRIGHT_SIGNING_THUMBPRINT` environment variable in both protected environments: `windows-signing` for build/sign/verify and `windows-release-publish` for independent publication-time verification. Keep the PFX and its password only in `windows-signing`.

For a controlled local invocation of the standard installer wrapper after an external signing step, pass `-LauncherBinary C:\path\to\Blockwright.exe -TrustedPublisherThumbprint "EXPECTED_CERTIFICATE_THUMBPRINT"` through `npm run package:windows --`. These parameters are an inseparable pair: the wrapper does not sign anything and accepts the launcher only when its existing Authenticode signature, timestamp, version, and thumbprint validate. Omitting both retains the unsigned local path.

1. Acquire the official Inno Setup 6.7.1 bootstrapper from its immutable GitHub release under explicit HTTPS timeout/size bounds, then verify its exact repo-pinned byte count, SHA-256, ProductVersion, timestamped Authenticode status, publisher subject, and certificate thumbprint before execution. Verify the installed compiler's separately pinned bytes and publisher again immediately before each compile. Chocolatey or another mutable package feed is not a release toolchain source.
2. Import the protected PFX from the release environment's secret store into an ephemeral runner certificate store.
3. Confirm its thumbprint exactly matches the separately configured trusted publisher thumbprint.
4. Build the exact x64 GUI `Blockwright.exe`, sign it with SHA-256 file and timestamp digests using an HTTPS RFC 3161 timestamp service, and verify its PE identity, product/file version, signer thumbprint, timestamp certificate, and post-signing SHA-256 before packaging.
5. Package those exact signed launcher bytes into the installer staging tree and portable ZIP, then sign the outer installer with the same publisher identity and timestamp policy.
6. Verify `Get-AuthenticodeSignature` returns `Valid` for the installer and the nested launcher, their signer thumbprints match, both timestamps are present, and the portable ZIP contains the recorded launcher digest.
7. Regenerate `SHA256SUMS.txt`, signed-artifact status, and `latest.json` from the final bytes.
8. Run the installer and portable lifecycle jobs against those exact bytes.
9. Generate GitHub Sigstore build-provenance attestations for the installer, portable ZIP, update metadata, checksum manifest, signature proof/status, and both SBOMs from the same validated tag commit; immediately verify every subject against this release workflow, qualified tag ref, commit SHA, and GitHub-hosted runner policy.
10. Immediately before draft creation, refetch the qualified remote tag and re-prove its dereferenced commit equals the source SHA approved before signing.
11. Leave the release as a draft. Publication is permitted only through `windows-publish-release.yml`, selected from that same tag and approved by the separate `windows-release-publish` environment. The operator supplies the exact draft database ID, tag, and source SHA; the workflow re-downloads every draft asset, requires exact checksum coverage, re-verifies the signed installer and every commit-bound GitHub attestation, detects asset changes, refetches the remote tag immediately before publication, and updates only that exact release ID.

Never use a self-signed, generated, borrowed, or placeholder certificate to satisfy the signed-release gate. A missing signing identity is a truthful external blocker for the stable channel, not a reason to weaken updater verification or mislabel the v0.6.0 exception.

Direct publication is outside the verified signed-release boundary and must not be used for the stable channel. The v0.6.0 exception may be published manually only while every unsigned-prerelease condition above remains true. Protect the publish environment with required reviewers, protect stable release tags against updates/deletion, and enable GitHub immutable releases before using the public paid channel; these repository settings are external human-admin gates.

Inno Setup permits free use, but its publisher asks commercial users who automate compilation in CI/CD to purchase an appropriate license. Treat that purchase as a human release-readiness gate before selling Blockwright; it is not bypassed by the byte-pinning controls above.

The updater accepts only bounded, time-limited HTTPS metadata whose exact published byte count and checksum match the bounded installer download and whose claimed signer matches the configured trusted thumbprint. It then independently requires a matching ProductVersion and a `Valid` Authenticode signature from that same certificate before stopping a verified managed server or executing anything. Downgrades are refused unless the operator explicitly supplies the recovery-only override; the override never bypasses the transport, size, checksum, version-binding, or signature gates.

The portable ZIP container is not Authenticode-signed, but a signed stable ZIP must contain the already signed and timestamped `Blockwright.exe` whose digest and publisher identity are bound into the release manifest, both SBOMs, signature status, and Authenticode proof. The ZIP is eligible only when GitHub's Sigstore attestation also verifies its digest, repository, signer workflow, qualified release tag, and source commit. The same provenance requirement covers `SHA256SUMS.txt`, `latest.json`, both SBOMs, and signature evidence so an attacker cannot replace the ZIP and checksum file as a pair. Consumers of that future signed channel can verify a downloaded file with `gh attestation verify <file> --repo gildaltar/Blockwright --signer-workflow gildaltar/Blockwright/.github/workflows/windows-release.yml --source-ref refs/tags/<version>`. The v0.6.0 prerelease instead publishes explicit unsigned status and checksums without claiming this provenance.
