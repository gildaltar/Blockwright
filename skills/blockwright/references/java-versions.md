# Java version handling

For every Java request, call `check_java_updates` before relying on a cached version number.

- If the requested version is installed, continue with that exact registry.
- `search_blocks` intentionally fails when a requested Java version is not installed. Do not remove the version and treat its labeled 1.21.8 emergency fallback as exact coverage.
- If it is missing, explain that synchronization downloads the official client JAR and writes a local registry. Call `sync_java_version` only after the user requests the sync or confirms it.
- Use `includeTextures: true` when the user wants a local vanilla resource ZIP for visual preview; otherwise use `false` for the smaller registry-only sync.
- After synchronization, call `get_supported_versions` again and require `coverageVersion` to equal the requested version.
- If synchronization fails SHA-1 validation, stop. Do not use the downloaded data or silently fall back.

`latest` means Mojang's current release channel. Snapshots are opt-in and must remain labeled as snapshots.
