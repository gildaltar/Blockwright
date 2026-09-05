---
name: blockwright
description: Design, compare, 3D-review, annotate, texture-preview, validate, revise, persist, and deliver exact Minecraft builds with adaptive palettes, fail-closed contracts, version history, Java-version sync, local world discovery, and professional schematic bundles. Use for build ideas, reviews, palettes, projects, saved worlds, resource packs, or construction files.
---

# Blockwright

Use the connected Blockwright MCP server whenever a user asks to design, review, revise, validate, visualize, texture-preview, or export a Minecraft structure.

## Workflow

1. Call `check_java_updates` for Java work, then `get_supported_versions`. Never claim registry coverage beyond the returned metadata. Read [Java versions](references/java-versions.md) when a requested release is not synchronized.
2. For underspecified palettes, use `continue_palette_interview`; ask exactly its one returned question, then pass the answer back. Read [Palette Studio](references/palette-studio.md) when roles are being changed or persisted.
3. Turn the user's intent into an explicit design contract: edition, exact version, dimensions, origin, building type, style, visible seed, role palette, features, and block budget. Preserve locked constraints through revisions. For complex builds, read [Build reasoning](references/build-reasoning.md).
4. Call `estimate_build` before generation. Green may proceed; amber/red requires explaining the concrete warnings and choices. Never invent a confirmation token. For large work, read [Sizing and preflight](references/sizing-preflight.md).
5. Resolve every role identifier with `search_blocks` against the exact requested version. If that Java registry is not synchronized, stop and use the version-sync workflow; never retry without the requested version to obtain fallback results. Never mix Java and Bedrock identifiers or command syntax.
6. Use `generate_build_candidates` when the user asks for originality, alternatives, or a fresh design. Compare plan geometry and fingerprints, not merely colors. Call `compile_build` only after a candidate/design contract is chosen.
7. Call `validate_build_contract` after every compile and revision. A build is deliverable only when the hash-bound contract and certificate are valid; unsupported, unevaluated, or failed hard clauses are blockers, not warnings.
8. Let the user inspect the shared workbench. When they want visual approval, exact-coordinate feedback, measurements, interior inspection, or reusable notes, call `review_build` and read [3D reviewer](references/reviewer.md). Refer to persisted camera, layer, roof visibility, selection, and annotations when they use referential language.
9. Treat every annotation as an example of a possible defect class. Call `audit_build` before revision and examine all analogous state, support, contact, connection, isolation, and overlap findings across the complete build. Do not patch only the sampled coordinates unless the user explicitly asks for a one-off change.
10. For in-game-looking materials, use the local pack control described in [Texture packs](references/texture-packs.md). Do not ask them to upload copyrighted assets into chat.
11. Call `revise_build` for changes. Use selected-region mode only with a complete bounded replacement set, preserve all placements outside the region, restate locked constraints, and rerun both contract validation and the global audit.
12. For durable work, use `create_project`, `save_project_version`, `list_projects`, `get_project`, `diff_project_versions`, and `restore_project_version`. Autosaves and restores append immutable versions; they never overwrite history. Deletion is destructive and must target one confirmed project.
13. Before handoff, use `get_material_list`, then `create_delivery_bundle`. Delivery must include the selected Java artifact, exact materials, origin/rotation instructions, contract, certificate, checksums, and compatibility status. Treat `.litematic` compatibility as unverified until a real Litematica round trip is recorded.
14. For local saves or “put this in my world,” read [WorldEdit and worlds](references/worldedit-worlds.md). Prefer `discover_worlds` → `get_worldedit_compatibility` → `install_worldedit_schematic` with `confirmed: false` for the full preview → explicit confirmation → the identical call with `confirmed: true`.
15. Use `export_build` with `schem` for real Java Sponge Schematic v3 output. Use `import_schematic` for bounded analysis/preview input. Never return or echo unbounded imported placement arrays in hosted mode.

## Accuracy boundaries

- Every placement is an integer coordinate and one viewer cube equals one Minecraft block.
- The build hash and high-level plan are deterministic for normalized input plus the visible seed. A new seed is a deliberate design change.
- User-selected textures stay in the browser. Procedural fallback textures are not Mojang artwork.
- Lighting is Minecraft-inspired, not a reproduction of the engine's light propagation.
- The reviewer preserves canonical block states and uses state-aware geometry for common stairs, slabs, trapdoors, doors, panes, fences, walls, and lanterns. It is an architectural reviewer, not an exhaustive reproduction of every Mojang multipart/custom model.
- Review JSON is valid only for the exact immutable build hash recorded in the file. Re-open review after any revision so feedback cannot silently drift to different placements.
- A passing geometric validation is not a passing design contract. Every declared hard clause must have explicit, hash-bound evidence before delivery.
- Litematica v7 encoding and bounded round-trip tests are implemented, but external-client compatibility remains unverified until exercised in the real Litematica client.
- Keep registry source, coverage version, and gaps visible.
- A versioned Java block search fails closed when its exact synchronized registry is missing. An unversioned packaged fallback is labeled with its real coverage and is never evidence for a different requested version.
- Synchronization downloads only URLs resolved from Mojang's manifest and verifies the client SHA-1 before writing.
- Java 26.2 `.schem` compatibility was verified with WorldEdit CLI 7.4.4. Re-check compatibility for any other Minecraft version/platform pair before claiming support.
- World discovery is read-only. Schematic installation writes only to the exact suggested WorldEdit schematics folder after explicit confirmation.
- Direct Anvil or Bedrock LevelDB editing is not implemented. Never claim a world was directly changed, backed up, or rolled back.
