# Changelog

## 0.4.0 - 2026-09-04

- Added a state-aware 3D reviewer with exact block and region selection, layer clipping, roof hiding, measurements, camera presets, annotations, and review import/export.
- Added whole-build audits for incomplete block state, unsupported roofs and lights, dangling connection state, isolated placements, and overlapping generator writes.
- Preserved complete state for generated stairs, slabs, trapdoors, doors, lanterns, panes, fences, and walls.
- Added compact cached build references so large canonical builds remain within MCP request limits.
- Carried forward the complete 0.3.0 palette, preflight, seeded architecture, schematic, local-world, version-sync, resource-pack, and WorldEdit toolset.
- Added a distributable plugin app package and expanded reviewer guidance in the bundled skill.
