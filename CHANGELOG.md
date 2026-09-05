# Changelog

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
