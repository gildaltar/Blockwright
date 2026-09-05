# Sizing and safety preflight

Call `estimate_build` before compiling. Report dimensions, volume, occupied-block estimate, unique materials, chunks, commands, export bytes, memory, time, and both Minecraft and WorldEdit risk.

- Green: proceed normally.
- Amber: identify the concrete scale/chunk concern and offer continue, simplify, split into phases, or cancel.
- Red: require the exact returned confirmation token before compilation.
- Above the in-memory placement limit: do not force compilation; split the design into deterministic regional phases.
- For Bedrock builds above the single-function ceiling, prefer the tiled `.mcstructure`/`.mcpack` path. This avoids a command-per-block stream but does not erase world size, loaded-chunk, or mobile placement risk.

The estimator is intentionally configurable. Never shrink a user request silently or restore the former 41×41×32 cap.
