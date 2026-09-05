# Windows signing gate

Public Windows artifacts require a real Authenticode code-signing identity controlled by the Blockwright publisher. Local and pull-request builds stay explicitly **unsigned** and their `blockwright-<version>-signature-status.json` sets `satisfiesSignedReleaseGate` to `false`.

The tag workflow is allowed to create a draft release only after all of the following succeed:

1. Acquire the official Inno Setup 6.7.1 bootstrapper from its immutable GitHub release under explicit HTTPS timeout/size bounds, then verify its exact repo-pinned byte count, SHA-256, ProductVersion, timestamped Authenticode status, publisher subject, and certificate thumbprint before execution. Verify the installed compiler's separately pinned bytes and publisher again immediately before each compile. Chocolatey or another mutable package feed is not a release toolchain source.
2. Import the protected PFX from the release environment's secret store into an ephemeral runner certificate store.
3. Confirm its thumbprint exactly matches the separately configured trusted publisher thumbprint.
4. Sign the installer with SHA-256 file and timestamp digests using an HTTPS RFC 3161 timestamp service.
5. Verify `Get-AuthenticodeSignature` returns `Valid`, the signer thumbprint matches, and the post-signing SHA-256 is recorded.
6. Regenerate `SHA256SUMS.txt`, signed-artifact status, and `latest.json` from the signed bytes.
7. Run the installer lifecycle job against those exact bytes.
8. Generate GitHub Sigstore build-provenance attestations for the installer, portable ZIP, update metadata, checksum manifest, signature proof/status, and both SBOMs from the same validated tag commit; immediately verify every subject against this release workflow, qualified tag ref, commit SHA, and GitHub-hosted runner policy.
9. Immediately before draft creation, refetch the qualified remote tag and re-prove its dereferenced commit equals the source SHA approved before signing.
10. Leave the release as a draft. Publication is permitted only through `windows-publish-release.yml`, selected from that same tag and approved by the separate `windows-release-publish` environment. The operator supplies the exact draft database ID, tag, and source SHA; the workflow re-downloads every draft asset, requires exact checksum coverage, re-verifies the signed installer and every commit-bound GitHub attestation, detects asset changes, refetches the remote tag immediately before publication, and updates only that exact release ID.

Never use a self-signed, generated, borrowed, or placeholder certificate to satisfy the release gate. A missing signing identity is a truthful external blocker, not a reason to weaken updater verification.

Direct publication from the GitHub release UI is outside the verified boundary and is not authorized. Protect the publish environment with required reviewers, protect release tags against updates/deletion, and enable GitHub immutable releases before using the public paid channel; these repository settings are external human-admin gates.

Inno Setup permits free use, but its publisher asks commercial users who automate compilation in CI/CD to purchase an appropriate license. Treat that purchase as a human release-readiness gate before selling Blockwright; it is not bypassed by the byte-pinning controls above.

The updater accepts only bounded, time-limited HTTPS metadata whose exact published byte count and checksum match the bounded installer download and whose claimed signer matches the configured trusted thumbprint. It then independently requires a matching ProductVersion and a `Valid` Authenticode signature from that same certificate before stopping a verified managed server or executing anything. Downgrades are refused unless the operator explicitly supplies the recovery-only override; the override never bypasses the transport, size, checksum, version-binding, or signature gates.

The portable ZIP is not Authenticode-signed. It is eligible for the public release only when GitHub's Sigstore attestation verifies its digest, repository, signer workflow, qualified release tag, and source commit. The same provenance requirement covers `SHA256SUMS.txt`, `latest.json`, both SBOMs, and signature evidence so an attacker cannot replace the ZIP and checksum file as a pair. Consumers can verify a downloaded file with `gh attestation verify <file> --repo gildaltar/Blockwright --signer-workflow gildaltar/Blockwright/.github/workflows/windows-release.yml --source-ref refs/tags/v0.6.0`.
