# Build reasoning

Convert an open-ended request into a compact design contract before compilation.

- Select dimensions from function first: circulation, room count, roof rise, symmetry, and terrain footprint.
- Use odd widths for centered entrances and roof ridges unless the user requests asymmetry.
- Give common materials structural roles, then add as many named materials as the design actually needs. The role palette is a default vocabulary, not a ceiling.
- Keep the dominant material under roughly half the visible exterior when the user asks for visual depth; use framing and foundation bands to break large surfaces.
- Reserve vertical space for the roof before allocating floors. Flag when the requested height cannot fit both.
- Treat block budget, edition, version, footprint, origin, and named features as fixed during revisions unless the user changes them.
- Search exact-version identifiers before proposing unfamiliar or newly released blocks.
- Preserve the original request in `sourceBrief`; every requested outcome must survive as a hard feature and map to generated evidence.
- Split each hard requirement into atomic, non-overlapping claims that cite exact source-text spans. Assign only an allowlisted geometric predicate, then attach scoped assertions that actually measure that predicate; a label such as `water-park` or `elevator` is never proof of identity or function.
- Bind numbers and scale words to their subjects. “Four paths” needs four routed path elements, “fifty-block-high” needs a 50-block vertical span, repeated fixtures need matching element instances, and “large” or “life-sized” needs meaningful three-dimensional extent plus placement and diversity evidence.
- Mark gameplay or mechanical behavior unsupported when no operational predicate evaluates it. Do not translate “working elevator,” animated machinery, or similar function claims into a token block merely to make a contract pass.
- For arbitrary forms, use the generic design IR: fills, shells, carves, cylinders, basins, routed sweeps, stairs, ramps, offsets, and supports. Compose them from intent instead of looking for a hardcoded domain object. A routed flume, for example, is a descending path plus a swept channel or tube, landing geometry, supports, railings, and reachable ascent.
- Treat the generated high-level plan and design graph as the creative boundary: program, zones, elements, requirement mappings, circulation, paths, massing, supports, details, and materials must agree before exact placement.
- A style change must alter spatial organization or geometry. Japanese work should express courtyard/engawa/post-and-beam logic; modern work should use interlocking volumes and a service spine; tower/fantasy work should create a genuinely vertical secondary mass.
- Keep the seed visible. Reusing the same normalized contract and seed must reproduce the build; changing the seed should alter bay rhythm, massing, entrances, or roof details.
- Use structural fingerprints and similarity scores to reject candidates that repeat recent geometry too closely.

After compilation, report exact dimensions, total blocks, material cardinality and largest materials, requirement/validation status, and any registry warning. Compilation does not open a viewer. Offer an explicit visual review only when it would help the user.
