# WorldEdit and local worlds

For “put this in my world,” use the reversible schematic workflow.

1. Call `discover_worlds`. It reads `level.dat` from the standard Java saves folder and, when the user supplies one, an explicitly authorized Prism/CurseForge/server saves folder.
2. Let the user select the stable world ID. Report display name, folder, Minecraft/DataVersion, mode, platform, last played, and lock status.
3. Call `get_worldedit_compatibility` for the exact Minecraft version/platform. Java 26.2 is verified with WorldEdit 7.4.4; do not generalize that claim.
4. Call `install_worldedit_schematic` first with the canonical path paired to the selected stable ID, the exact suggested schematics folder, the chosen dimension/anchor/offset/rotation/mirror/include-air/replacements, and `confirmed: false`. This is a read-only preview and must not write a file.
5. Review its affected bounds, chunk range/count, block count, palette size, risk, target/overwrite state, and conflicts. Conflicts are `not_scanned` unless a canonical region snapshot was supplied; never turn that into a zero-conflict claim.
6. Only after the user confirms the reviewed preview, repeat the same call with `confirmed: true`.
7. Return the installed path and the tool's exact dimension, anchor, `//schem load`, and `//paste` instructions. `//paste -a` skips air.

The companion may install a verified `.schem` while a world is open because it does not touch the save. It never edits `region/*.mca`, player data, or `level.dat`. Direct save editing, backup/rollback, and Bedrock world writes are unimplemented; say so plainly.

On mobile/web, local worlds exist only while this PC's Blockwright companion is connected.
