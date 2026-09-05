# Changelog

## 0.6.0 - 2026-09-05

- Added normalized build contracts and deterministic, full-hash certificates. Hard requirements now fail closed when they fail, are unsupported, or cannot be evaluated; semantic auditing covers entrances, clearance, spawn safety, requested spaces, explicit lighting, interiors, support, palette, version, origin, and budget.
- Added private durable projects with autosave, immutable version history, placement/material diffs, restore-as-new-version, selected-region revision that preserves all out-of-region placements, and exact-snapshot expiring client review links.
- Added exact material lists and professional delivery ZIPs containing the selected Java artifact, canonical build, contract, certificate, compatibility declaration, origin/rotation instructions, optional approval, and SHA-256 manifest.
- Added bounded single-region Litematic v7 import/export. Compatibility remains explicitly unverified until a real Litematica open/place/re-save workflow is recorded.
- Added hosted-service foundations for account sessions, tenant-isolated project storage, deletion cascades, quotas, telemetry controls, support/refund records, and configuration-gated Stripe checkout, portal, and invoice handoff.
- Replaced full compile/review view metadata with an immutable shell, a 500-placement initial page, and sequential private pages capped at 5,000 placements. Hosted paging uses a bounded, expiring tenant-and-user-scoped cache and never recompiles a build per page.
- Added a built-in first-party landing, onboarding, and private project-console surface under `/assets/blockwright/`, with direct Windows and portable release paths, bounded history/diff/restore/review-link controls, and honest provider/compatibility gates.
- Added a self-contained Windows x64 portable ZIP and per-user Inno Setup installer with pinned Node 26.8.1, optional Codex integration, reversible `.schem` association, controlled uninstall, updater verification, crash/support evidence, CycloneDX/SPDX SBOMs, checksums, and end-to-end lifecycle CI.
- Added a labeled 100-brief synthetic v0.6 acceptance corpus; customer evidence remains an external launch gate and is not represented by synthetic tests.
- Hardened hosted MCP authentication and rate limits, fail-closed production billing and entitlement refresh, bounded review/session/telemetry retention, public-review load control, local-only operations, asynchronous password hashing, tenant/review deletion, schematic and resource-pack expansion bounds, CSV formula neutralization, model-inheritance cycles, release rollback prevention, and signed-installer version binding.
- Replaced the release hero, application icon, and landing capture with v0.6 artwork and product imagery; removed obsolete duplicate media and generated caches from the release tree.

## 0.5.0 - 2026-09-04

- Added a native Windows Control Center for starting, stopping, and restarting the standalone local server, with strict process ownership, live readiness and identity status, bounded logs, dependency repair, diagnostics export, and an optional Start Menu shortcut.
- Added health and readiness endpoints, stronger runtime and dependency validation, reproducible first-run installation, OS-owned repair serialization, resilient streamed MCP forwarding, lifecycle recovery, and atomic plugin packaging that removes stale generated assets.
- Rebuilt the 3D reviewer around exact search and coordinate jumps, richer block and region measurements, audit navigation and filtering, editable/resolvable annotations, keyboard shortcuts, persisted review context, and guarded hash-bound imports.
- Added consistent tool titles, parameter guidance, structured output schemas, and progress metadata across all 27 MCP tools.
- Hardened exact Java registry selection and synchronization, including clearer missing-version errors, network timeouts, atomic updates, and build-hash integrity checks.
- Added source and installed-plugin diagnostics, runtime-lock verification, expanded automated tests, and native Windows CI coverage.

## 0.4.0 - 2026-09-04

- Added a state-aware 3D reviewer with exact block and region selection, layer clipping, roof hiding, measurements, camera presets, annotations, and review import/export.
- Added whole-build audits for incomplete block state, unsupported roofs and lights, dangling connection state, isolated placements, and overlapping generator writes.
- Preserved complete state for generated stairs, slabs, trapdoors, doors, lanterns, panes, fences, and walls.
- Added compact cached build references so large canonical builds remain within MCP request limits.
- Carried forward the complete 0.3.0 palette, preflight, seeded architecture, schematic, local-world, version-sync, resource-pack, and WorldEdit toolset.
- Added a distributable plugin app package and expanded reviewer guidance in the bundled skill.
