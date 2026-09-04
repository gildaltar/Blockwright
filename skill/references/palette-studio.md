# Palette Studio

Use `continue_palette_interview` as a state machine rather than writing a questionnaire. Ask only the returned `nextQuestion`, preserve `sessionId`, and stop when it reports completion.

- A role change may replace, lock, or unlock foundation, wall, frame, roof, trim, glazing, lighting, doors, railings, accents, or landscaping.
- To reject an assigned block, submit its replacement and `rejectBlocks` in the same continuation so no rejected block remains active.
- A locked role must survive later answers and build revisions unless the user explicitly unlocks it.
- Use `save_palette`, `list_palettes`, `load_palette`, `rename_palette`, and `delete_palette` by stable ID. Deletion is destructive and must reflect the user's request.
- Never bypass exact-version validation. If Java coverage is absent, synchronize it before proposing unfamiliar blocks.

The workbench and Palette Studio can preview a user-owned resource pack locally. Texture resolution improves material judgment but does not make the cube geometry engine-exact.
