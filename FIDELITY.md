# Blockwright Fidelity Ledger

Compared against `blockwright-concept.png` at the native concept size of 1584 × 960 and against the implemented widget at 2000 × 1020 (desktop host) and 900 × 900 (compact host).

| Area | Concept target | Implemented result | Status |
| --- | --- | --- | --- |
| Composition | Slim tool rail, build brief, central canvas, right inspector, timeline, status bar | Same six-part workbench composition at desktop size | Match |
| Visual language | Deep charcoal and navy surfaces, amber focus color, moss validation accent | Matching graphite/navy surfaces, amber controls and selection, green ready state | Match |
| Hierarchy | Build name dominates; export is the primary action; detailed data recedes | Title, export action, model, layer controls, palette, and status follow the same hierarchy | Match |
| Core controls | Perspective modes, camera presets, layer playback, inspector, export menu | All controls are present and interactive; compact mode preserves the essential set | Match |
| Data presentation | Edition, 17 × 13 × 14 dimensions, layer, palette, validation, coordinates, count, hash | Every field is backed by the canonical compiled record; Java now reads 26.2 and the texture source is visible | Match with requested version update |
| Responsive behavior | Desktop-first cinematic workstation | At 900 × 900, side panels become a rail plus stacked inspector without horizontal overflow | Intentional adaptation |
| Build imagery | Highly detailed illustrative lodge with texture-rich materials | Exact 1 × 1 procedural voxel geometry with original generated style thumbnails | Intentional deviation |

## Copy comparison

The implementation preserves the key labels `Blockwright`, `Nordic Hearth Lodge`, `Export build`, `Build brief`, `Styles`, `Saved builds`, `Java 26.2`, `17 × 13 × 14`, `Layer`, `Palette`, `Textures`, `Validation`, and `Build ready`.

Three concept-only values changed intentionally. The concept's illustrative `Java 1.21` became the user's exact `Java 26.2`; `2,846 blocks` became the compiler's exact `1,077 blocks`; and `Layer 8 / 14` opens at `Layer 14 / 14` so the complete structure is visible immediately. The added `Textures` inspector is the smallest extension of the existing control family. These values are not decorative in the implementation: the version, count, dimensions, active layer, coordinates, and hash all come from one immutable build record.

## Remaining difference

The concept uses atmospheric smoke and shape-specific block models. The implementation can reproduce a selected pack's face textures, but every placement remains a full 1 × 1 × 1 cube and lighting remains approximate. It does not redistribute game textures: the user selects a pack or verified client JAR locally. Real Sponge v3 `.schem` import/export is now implemented and verified with WorldEdit 7.4.4. Direct Java Anvil editing, Bedrock LevelDB, and `.mcworld` writers remain clearly unavailable.
