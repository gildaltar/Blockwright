export const STYLE_PROFILES = [
    ["nordic", "Nordic", ["steep protective roof", "heavy timber rhythm", "stone weather base"], ["spruce_planks", "stripped_spruce_log", "stone_bricks"], ["roof too shallow", "flat facade"]],
    ["medieval", "Medieval", ["asymmetric massing", "overhanging upper floors", "visible timber frame"], ["dark_oak_planks", "stripped_oak_log", "cobblestone"], ["perfect symmetry", "single-depth walls"]],
    ["cottagecore", "Cottagecore", ["small human scale", "lush edges", "soft roof silhouette"], ["oak_planks", "mossy_cobblestone", "flowering_azalea_leaves"], ["oversized footprint", "sterile landscaping"]],
    ["japanese", "Japanese", ["calm horizontal lines", "deep eaves", "controlled asymmetry"], ["dark_oak_planks", "white_concrete", "bamboo_planks"], ["busy palette", "shallow eaves"]],
    ["modern", "Modern", ["interlocking volumes", "intentional glazing", "clean shadow gaps"], ["white_concrete", "gray_concrete", "tinted_glass"], ["featureless box", "random windows"]],
    ["rustic", "Rustic", ["honest structure", "weathered base", "layered porch"], ["spruce_planks", "cobblestone", "mud_bricks"], ["perfect polish", "thin supports"]],
    ["fantasy", "Fantasy", ["readable heroic silhouette", "vertical accents", "controlled exaggeration"], ["stone_bricks", "warped_planks", "amethyst_block"], ["noise without hierarchy", "unsupported towers"]],
    ["alpine", "Alpine", ["broad roof", "sheltered balcony", "masonry ground floor"], ["spruce_planks", "stone_bricks", "calcite"], ["narrow roof", "weak base"]],
    ["industrial", "Industrial", ["expressed frame", "repeated bays", "service details"], ["deepslate_tiles", "iron_block", "copper_block"], ["ornamental clutter", "no structural rhythm"]],
    ["cyberpunk", "Cyberpunk", ["dense vertical layering", "bright navigation accents", "service infrastructure"], ["black_concrete", "cyan_concrete", "sea_lantern"], ["uniform glow", "unreadable silhouette"]],
    ["desert", "Desert", ["thick shaded walls", "courtyard ventilation", "small openings"], ["sandstone", "cut_sandstone", "terracotta"], ["large exposed glazing", "dark roof mass"]],
    ["jungle", "Jungle", ["raised floor", "deep canopy roof", "vegetation integration"], ["jungle_planks", "mossy_cobblestone", "mangrove_roots"], ["ground-level rot zone", "unbroken facade"]],
    ["nether", "Nether", ["heat-resistant massing", "fortified thresholds", "emissive wayfinding"], ["blackstone", "nether_bricks", "shroomlight"], ["flammable shell", "flat lava-facing wall"]],
    ["end", "End", ["void-readable silhouette", "floating visual balance", "sparse luminous accents"], ["end_stone_bricks", "purpur_block", "end_rod"], ["busy terrain palette", "weak silhouette"]],
    ["steampunk", "Steampunk", ["mechanical hierarchy", "pipe routes", "aged metal contrast"], ["bricks", "cut_copper", "dark_oak_planks"], ["random gears", "all-metal monotony"]],
    ["brutalist", "Brutalist", ["monumental mass", "deep reveals", "legible circulation cuts"], ["gray_concrete", "smooth_stone", "tinted_glass"], ["featureless slab", "thin decorative trim"]],
    ["art-deco", "Art Deco", ["stepped symmetry", "vertical emphasis", "precise geometric trim"], ["quartz_block", "blackstone", "gold_block"], ["curved rustic detailing", "uneven rhythm"]],
    ["organic", "Organic", ["terrain-following footprint", "branching circulation", "material gradients"], ["moss_block", "stripped_oak_log", "stone"], ["random blob massing", "no entry hierarchy"]],
    ["megabase", "Megabase", ["macro silhouette", "repeatable modules", "maintenance corridors"], ["smooth_stone", "deepslate_tiles", "sea_lantern"], ["detail before massing", "unserviceable spans"]],
    ["warm-modern", "Warm Modern", ["clean volumes", "timber warmth", "framed landscape views"], ["smooth_quartz", "spruce_planks", "gray_stained_glass"], ["cold monochrome", "unframed glass walls"]],
    ["redstone-friendly", "Redstone-friendly", ["service cavities", "repeatable floor heights", "visible maintenance access"], ["stone_bricks", "smooth_stone", "redstone_lamp"], ["sealed wiring", "irregular floor grid"]],
].map(([id, name, principles, palette, failureModes]) => ({
    id: id,
    name: name,
    principles: principles,
    palette: palette,
    failureModes: failureModes,
}));
export function getStyleProfile(style) {
    const needle = style.trim().toLowerCase();
    return STYLE_PROFILES.find((profile) => profile.id === needle || profile.name.toLowerCase() === needle) ?? STYLE_PROFILES[0];
}
//# sourceMappingURL=styles.js.map