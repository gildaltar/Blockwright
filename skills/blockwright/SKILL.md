---
name: blockwright
description: Design, compare, optionally 3D-review, annotate, validate, revise, persist, and deliver exact Minecraft Java or Bedrock builds with generic geometry programs, open-ended material libraries, fail-closed contracts, version history, schematics, and mobile-oriented Bedrock structure packs. Use for build ideas, reviews, palettes, projects, saved worlds, resource packs, or construction files.
---

# Blockwright

Use the connected Blockwright MCP server whenever a user asks to design, review, revise, validate, visualize, texture-preview, or export a Minecraft structure.

## Workflow

1. Call `check_java_updates` for Java work, then `get_supported_versions`. Never claim registry coverage beyond the returned metadata. Read [Java versions](references/java-versions.md) when a requested release is not synchronized.
2. For underspecified palettes, use `continue_palette_interview`; ask exactly its one returned question, then pass the answer back. Treat its eleven role assignments as compatibility defaults, never as a palette-size ceiling. For detailed or varied builds, create an open-ended `materialLibrary`, validate every entry, and let elements reference named materials. Read [Palette Studio](references/palette-studio.md).
3. Preserve the user's complete request in `sourceBrief`. Turn every requested outcome into a `features` entry and a matching design requirement. Decompose each requirement into atomic exact source spans with typed geometric predicates and scoped assertions; quantified wording must bind to the matching subject instances or dimensions. Mark an unsupported span unsupported so the build fails closed—never certify noun identity or an operational claim from an element label. For arbitrary or large work, construct a generic design program from fills, shells, carves, cylinders, basins, paths/sweeps, stairs, and ramps; map every requirement to the element IDs that implement it. Never omit a difficult request to make compilation pass, and never use a preset shell as a substitute. Read [Build reasoning](references/build-reasoning.md).
4. Call `estimate_build` before generation. Green may proceed; amber/red requires explaining the concrete warnings and choices. Never invent a confirmation token. For large work, read [Sizing and preflight](references/sizing-preflight.md).
5. Resolve every role and material-library identifier against the exact requested version. If that Java registry is not synchronized, stop and use the version-sync workflow; never retry without the requested version to obtain fallback results. Never mix Java and Bedrock identifiers, states, or command syntax. There is no arbitrary material-count limit.
6. Use `generate_build_candidates` only for supported legacy architectural alternatives. For a custom or component-rich brief, build the generic design program directly. A “slide,” “ship,” “dragon,” or other novel form is a composition of generic routed geometry, shells, supports, access, and materials—not a package enum that must already know the noun. Call `compile_build` only after the design contract is complete.
7. Call `validate_build_contract` after every compile and revision. A build is deliverable only when the hash-bound contract and certificate are valid; unsupported, unevaluated, or failed hard clauses are blockers, not warnings.
8. `compile_build` is data-only and must not launch a page. Call `review_build` once only when the user explicitly asks for visual approval, exact-coordinate feedback, measurements, interior inspection, or reusable notes. Its inline state is deliberately lightweight; 3D starts only after the user taps **Open 3D**. Reuse the active review rather than opening repeated instances. Read [3D reviewer](references/reviewer.md).
9. Treat every annotation as an example of a possible defect class. Call `audit_build` before revision and examine all analogous state, support, contact, connection, isolation, and overlap findings across the complete build. Do not patch only the sampled coordinates unless the user explicitly asks for a one-off change.
10. For in-game-looking materials, use the local pack control described in [Texture packs](references/texture-packs.md). Do not ask them to upload copyrighted assets into chat.
11. Call `revise_build` for changes. Use selected-region mode only with a complete bounded replacement set, preserve all placements outside the region, restate locked constraints, and rerun both contract validation and the global audit.
12. For durable work, use `create_project`, `save_project_version`, `list_projects`, `get_project`, `diff_project_versions`, and `restore_project_version`. Autosaves and restores append immutable versions; they never overwrite history. Deletion is destructive and must target one confirmed project.
13. Before handoff, use `get_material_list`. For Java, use the verified schematic/delivery workflow. For Bedrock, export `mcpack` so large builds use tiled `.mcstructure` data rather than hundreds of thousands of `setblock` commands. Delivery must include exact materials, origins, contract, certificate, checksums, resolved registry version, and compatibility status. Treat Bedrock iPhone runtime compatibility as unverified until the exact artifact is imported and placed in a matching real client.
14. For local saves or “put this in my world,” read [WorldEdit and worlds](references/worldedit-worlds.md). Prefer `discover_worlds` → `get_worldedit_compatibility` → `install_worldedit_schematic` with `confirmed: false` for the full preview → explicit confirmation → the identical call with `confirmed: true`.
15. Use `export_build` with `schem` for Java Sponge Schematic v3 or `mcpack` for a Bedrock behavior pack containing tiled structures. A single Bedrock `.mcfunction` still obeys the 10,000-command ceiling. Use `import_schematic` for bounded analysis/preview input. Never return or echo unbounded imported placement arrays in hosted mode.

## Accuracy boundaries

- Every placement is an integer coordinate and one viewer cube equals one Minecraft block.
- The build hash and high-level plan are deterministic for normalized input plus the visible seed. A new seed is a deliberate design change.
- User-selected textures stay in the browser. Procedural fallback textures are not Mojang artwork.
- Lighting is Minecraft-inspired, not a reproduction of the engine's light propagation.
- The reviewer preserves canonical block states and uses state-aware geometry for common stairs, slabs, trapdoors, doors, panes, fences, walls, and lanterns. It is an architectural reviewer, not an exhaustive reproduction of every Mojang multipart/custom model.
- Review JSON is valid only for the exact immutable build hash recorded in the file. After a revision, invalidate the prior review; open a replacement only when the user requests it, and never keep multiple active 3D contexts.
- A passing geometric validation is not a passing design contract. Every declared hard clause must have explicit, hash-bound evidence before delivery.
- A placement count plus a label is not semantic evidence. Every hard requirement needs exact-span, predicate-compatible assertions, including at least one structural check stronger than a simple placement count; unsupported gameplay or mechanical behavior remains a blocker.
- Litematica v7 encoding and bounded round-trip tests are implemented, but external-client compatibility remains unverified until exercised in the real Litematica client.
- Keep registry source, coverage version, and gaps visible.
- A versioned Java block search fails closed when its exact synchronized registry is missing. An unversioned packaged fallback is labeled with its real coverage and is never evidence for a different requested version.
- Synchronization downloads only URLs resolved from Mojang's manifest and verifies the client SHA-1 before writing.
- Java 26.2 `.schem` compatibility was verified with WorldEdit CLI 7.4.4. Re-check compatibility for any other Minecraft version/platform pair before claiming support.
- World discovery is read-only. Schematic installation writes only to the exact suggested WorldEdit schematics folder after explicit confirmation.
- Direct Anvil or Bedrock LevelDB editing is not implemented. Never claim a world was directly changed, backed up, or rolled back.
- Bedrock `.mcstructure` NBT and pack layout can be internally round-trip validated without proving a real iPhone import. State that distinction until the user or an automated matching-version client completes the final import-and-placement smoke test.
