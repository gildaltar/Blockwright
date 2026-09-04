# Build reasoning

Convert an open-ended request into a compact design contract before compilation.

- Select dimensions from function first: circulation, room count, roof rise, symmetry, and terrain footprint.
- Use odd widths for centered entrances and roof ridges unless the user requests asymmetry.
- Give the palette a structural role: foundation, wall, frame, roof, trim, glazing, light, door, railing.
- Keep the dominant material under roughly half the visible exterior when the user asks for visual depth; use framing and foundation bands to break large surfaces.
- Reserve vertical space for the roof before allocating floors. Flag when the requested height cannot fit both.
- Treat block budget, edition, version, footprint, origin, and named features as fixed during revisions unless the user changes them.
- Search exact-version identifiers before proposing unfamiliar or newly released blocks.
- Treat the generated high-level plan as the creative boundary: program, footprint/massing, room graph, circulation, floor heights, facade bays, frame, roof grammar, entrances, windows, details, and landscaping must agree before exact placement.
- A style change must alter spatial organization or geometry. Japanese work should express courtyard/engawa/post-and-beam logic; modern work should use interlocking volumes and a service spine; tower/fantasy work should create a genuinely vertical secondary mass.
- Keep the seed visible. Reusing the same normalized contract and seed must reproduce the build; changing the seed should alter bay rhythm, massing, entrances, or roof details.
- Use structural fingerprints and similarity scores to reject candidates that repeat recent geometry too closely.

After compilation, report the exact dimensions, total blocks, five largest materials, validation status, and any registry warning. Offer one targeted revision rather than inventing a different project.
