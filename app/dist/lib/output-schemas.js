import { z } from "zod";
const paletteRoleNames = ["foundation", "wall", "frame", "roof", "trim", "glazing", "lighting", "doors", "railings", "accents", "landscaping"];
const buildingTypes = ["house", "temple", "tower", "workshop", "hall", "courtyard", "megabase"];
const interviewTopics = ["buildType", "architecturalDirection", "biome", "mood", "interpretation", "constraints", "dominantMaterials", "contrast", "weathering", "landscaping", "avoidBlocks", "resourcePack"];
const riskLevels = ["green", "amber", "red"];
const nonNegativeInteger = z.number().int().nonnegative();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, "Expected a full SHA-256 digest.");
export const outputVec3Schema = z.object({
    x: z.number().int().describe("Integer east-west block coordinate."),
    y: z.number().int().describe("Integer vertical block coordinate."),
    z: z.number().int().describe("Integer north-south block coordinate."),
});
export const outputDimensionsSchema = z.object({
    width: z.number().int().positive().describe("Width in blocks along the x axis."),
    depth: z.number().int().positive().describe("Depth in blocks along the z axis."),
    height: z.number().int().positive().describe("Height in blocks along the y axis."),
});
export const outputBoundsSchema = z.object({
    min: outputVec3Schema.describe("Minimum occupied coordinate."),
    max: outputVec3Schema.describe("Maximum occupied coordinate."),
    dimensions: outputDimensionsSchema.describe("Inclusive occupied dimensions."),
});
export const resourcePackVersionOutputSchema = z.union([
    nonNegativeInteger,
    z.object({ major: nonNegativeInteger, minor: nonNegativeInteger }).passthrough(),
]).describe("Minecraft resource-pack format version, represented by either a legacy integer or major/minor object.");
export const riskLevelOutputSchema = z.enum(riskLevels);
export const buildPreflightOutputSchema = z.object({
    dimensions: outputDimensionsSchema,
    totalVolume: nonNegativeInteger.describe("Total requested envelope volume in blocks."),
    estimatedOccupiedBlocks: nonNegativeInteger.describe("Estimated non-air placement count."),
    estimatedPlacementAttempts: nonNegativeInteger.describe("Conservative no-loop upper bound on put/remove coordinate operations, including overlap and carve work."),
    estimatedUniqueMaterials: nonNegativeInteger.describe("Estimated number of distinct block materials."),
    chunksTouched: nonNegativeInteger.describe("Estimated number of touched chunk columns."),
    estimatedCommandCount: nonNegativeInteger.describe("Estimated setblock-equivalent command count."),
    estimatedExportBytes: nonNegativeInteger.describe("Estimated uncompressed export size in bytes."),
    estimatedMemoryBytes: nonNegativeInteger.describe("Estimated peak working memory in bytes."),
    estimatedGenerationMs: nonNegativeInteger.describe("Estimated generation duration in milliseconds."),
    minecraftRisk: riskLevelOutputSchema.describe("Risk of applying the result through ordinary Minecraft commands."),
    worldEditRisk: riskLevelOutputSchema.describe("Risk of applying the result through WorldEdit."),
    overallRisk: riskLevelOutputSchema.describe("Highest applicable risk level."),
    requiresConfirmation: z.boolean().describe("Whether the exact confirmation token is required before compilation."),
    confirmationToken: z.string().regex(/^[a-f0-9]{20}$/i).optional().describe("Exact token required for a red-risk build."),
    warnings: z.array(z.string()).describe("Concrete scale or execution warnings."),
    choices: z.array(z.enum(["continue", "simplify", "split_into_phases", "cancel"])).describe("Safe next actions for this estimate."),
    regionSize: z.number().int().positive().describe("Width and depth of one deterministic generation region."),
    estimatedRegions: nonNegativeInteger.describe("Estimated number of deterministic regions."),
});
export const architecturalPlanOutputSchema = z.object({
    schemaVersion: z.literal(1).describe("Architectural-plan schema version."),
    seed: z.string().describe("Visible seed used to derive this plan."),
    program: z.object({
        buildingType: z.enum(buildingTypes).describe("High-level building program represented by the plan."),
        spaces: z.array(z.string()).describe("Named rooms or functional spaces required by the plan."),
    }).describe("Functional building program used to organize the plan."),
    footprint: z.object({
        kind: z.enum(["rectangle", "courtyard", "interlocking", "tower"]).describe("Primary footprint topology."),
        width: z.number().int().positive().describe("Plan width in blocks."),
        depth: z.number().int().positive().describe("Plan depth in blocks."),
        inset: nonNegativeInteger.describe("Inset distance used by courtyard or stepped footprints."),
    }).describe("Horizontal footprint rules for the architecture."),
    massing: z.object({
        volumes: z.array(z.object({
            id: z.string().describe("Stable volume identifier within this plan."),
            min: outputVec3Schema.describe("Minimum coordinate of this massing volume."),
            max: outputVec3Schema.describe("Maximum coordinate of this massing volume."),
            purpose: z.string().describe("Architectural purpose of this massing volume."),
        })).describe("Occupied architectural volumes that compose the massing."),
        asymmetry: z.number().min(0).max(1).describe("Normalized asymmetry factor from zero to one."),
    }).describe("Three-dimensional volume composition of the plan."),
    roomGraph: z.object({
        rooms: z.array(z.object({
            id: z.string().describe("Stable room identifier within this plan."),
            purpose: z.string().describe("Intended function of the room."),
            floor: nonNegativeInteger.describe("Zero-based floor containing the room."),
        })).describe("Rooms represented in the plan."),
        links: z.array(z.object({
            from: z.string().describe("Source room identifier for this access link."),
            to: z.string().describe("Destination room identifier for this access link."),
        })).describe("Required access links between rooms."),
    }).describe("Room adjacency and access graph."),
    circulation: z.object({
        primary: z.string().describe("Primary horizontal circulation strategy."),
        vertical: z.string().describe("Vertical circulation strategy between floors."),
        exterior: z.array(z.string()).describe("Exterior circulation elements or approaches."),
    }).describe("Horizontal, vertical, and exterior circulation rules."),
    floorHeights: z.array(z.number().int().positive()).describe("Floor-to-floor heights in blocks."),
    facadeBays: z.array(z.object({
        side: z.enum(["north", "south", "east", "west"]).describe("Cardinal facade containing these bays."),
        count: z.number().int().positive().describe("Number of repeated bays on this facade."),
        rhythm: z.string().describe("Opening and support rhythm used across the facade."),
    })).describe("Facade bay patterns by cardinal side."),
    structuralFrame: z.object({
        system: z.string().describe("Structural framing system used by the plan."),
        bayWidth: z.number().int().positive().describe("Nominal structural bay width in blocks."),
        supports: z.array(z.string()).describe("Support types required by the frame."),
    }).describe("Structural framing rules for the plan."),
    roofGrammar: z.object({
        type: z.enum(["gable", "hipped", "flat", "pagoda", "stepped"]).describe("Primary roof topology."),
        pitch: z.number().nonnegative().describe("Nominal roof pitch used by the generator."),
        overhang: nonNegativeInteger.describe("Roof overhang in blocks."),
        tiers: z.number().int().positive().describe("Number of roof tiers."),
    }).describe("Roof topology and proportional rules."),
    entrances: z.array(z.object({
        side: z.string().describe("Cardinal or named side containing the entrance."),
        width: z.number().int().positive().describe("Clear entrance width in blocks."),
        emphasis: z.string().describe("Architectural emphasis applied to the entrance."),
    })).describe("Planned entrances and their clear widths."),
    windows: z.object({
        pattern: z.string().describe("Window repetition pattern."),
        sill: nonNegativeInteger.describe("Window sill height in blocks."),
        height: z.number().int().positive().describe("Window opening height in blocks."),
    }).describe("Window placement grammar."),
    details: z.array(z.string()).describe("Architectural detail motifs included by the plan."),
    landscaping: z.array(z.string()).describe("Landscaping elements included around the structure."),
    fingerprint: sha256Schema.describe("SHA-256 fingerprint of the normalized architectural plan."),
});
const rolePaletteShape = Object.fromEntries(paletteRoleNames.map((role) => [role, z.string().describe(`Namespaced block identifier assigned to the ${role} role.`)]));
export const rolePaletteOutputSchema = z.object(rolePaletteShape);
const blockStateValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export const designMaterialOutputSchema = z.union([
    z.string().describe("Namespaced Minecraft block identifier used by this material-library entry."),
    z.object({
        block: z.string().describe("Namespaced Minecraft block identifier used by this material-library entry."),
        state: z.record(z.string(), blockStateValueSchema).optional().describe("Exact block-state properties applied whenever this material is placed."),
        tags: z.array(z.string().describe("Caller-defined material classification used for planning and audit context.")).optional().describe("Open-ended planning tags; they do not restrict which materials may be supplied."),
    }).describe("State-aware material definition for the generic design program."),
]).describe("Either a namespaced block identifier or a state-aware material definition.");
const designElementBase = {
    id: z.string().describe("Stable element identifier referenced by hard-requirement mappings."),
    intent: z.string().describe("Human-readable purpose of this generic geometry element."),
    phase: z.string().optional().describe("Optional construction or attraction phase label attached to generated placements."),
    requirementIds: z.array(z.string().describe("Hard-requirement identifier evidenced by this element.")).describe("All hard requirements for which this element supplies placement evidence."),
    offsets: z.array(outputVec3Schema.describe("Local translation used to repeat this generic operation.")).optional().describe("Optional translations that repeat the element without duplicating its definition."),
};
const designProfileOutputSchema = z.object({
    plane: z.enum(["xy", "xz", "yz"]).describe("World-aligned plane in which the two-dimensional profile is defined."),
    points: z.array(z.object({
        u: z.number().int().describe("First integer coordinate in the declared profile plane."),
        v: z.number().int().describe("Second integer coordinate in the declared profile plane."),
    })).min(2).describe("Ordered integer points forming the reusable extrusion profile."),
    filled: z.boolean().optional().describe("Whether the profile interior is filled before extrusion; false traces only its boundary."),
});
export const designPrimitiveOutputSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("line").describe("Selects a deterministic thick line primitive."), from: outputVec3Schema.describe("Inclusive line start coordinate."), to: outputVec3Schema.describe("Inclusive line end coordinate."), thickness: z.number().int().positive().optional().describe("Optional line thickness in blocks; defaults to one.") }),
    z.object({ type: z.literal("plane").describe("Selects an axis-aligned plane primitive."), min: outputVec3Schema.describe("Minimum inclusive plane coordinate."), max: outputVec3Schema.describe("Maximum inclusive plane coordinate."), filled: z.boolean().optional().describe("Whether to fill the plane interior."), thickness: z.number().int().positive().optional().describe("Optional plane thickness in blocks.") }),
    z.object({ type: z.literal("circle").describe("Selects a deterministic circle or disk primitive."), center: outputVec3Schema.describe("Center of the circle."), radius: z.number().int().positive().describe("Circle radius in blocks."), axis: z.enum(["x", "y", "z"]).optional().describe("Normal axis of the circle plane; defaults to y."), filled: z.boolean().optional().describe("Whether to emit a filled disk instead of the perimeter."), thickness: z.number().int().positive().optional().describe("Optional perimeter thickness in blocks.") }),
    z.object({ type: z.literal("ellipse").describe("Selects a deterministic ellipse or filled elliptical disk."), center: outputVec3Schema.describe("Center of the ellipse."), radiusU: z.number().int().positive().describe("First in-plane radius in blocks."), radiusV: z.number().int().positive().describe("Second in-plane radius in blocks."), axis: z.enum(["x", "y", "z"]).optional().describe("Normal axis of the ellipse plane; defaults to y."), filled: z.boolean().optional().describe("Whether to fill the ellipse interior."), thickness: z.number().int().positive().optional().describe("Optional perimeter thickness in blocks.") }),
    z.object({ type: z.literal("sphere").describe("Selects a deterministic sphere primitive."), center: outputVec3Schema.describe("Center of the sphere."), radius: z.number().int().positive().describe("Sphere radius in blocks."), hollow: z.boolean().optional().describe("Whether to emit only the spherical shell."), thickness: z.number().int().positive().optional().describe("Shell thickness when hollow is true.") }),
    z.object({ type: z.literal("cone").describe("Selects a vertical deterministic cone primitive."), baseCenter: outputVec3Schema.describe("Center coordinate of the cone base."), radius: z.number().int().positive().describe("Base radius in blocks."), height: z.number().int().positive().describe("Vertical cone height in blocks."), direction: z.enum(["up", "down"]).optional().describe("Whether the cone tapers upward or downward."), hollow: z.boolean().optional().describe("Whether to emit only the cone shell."), thickness: z.number().int().positive().optional().describe("Shell thickness when hollow is true.") }),
    z.object({ type: z.literal("pyramid").describe("Selects a vertical rectangular pyramid primitive."), min: outputVec3Schema.describe("Minimum inclusive pyramid envelope coordinate."), max: outputVec3Schema.describe("Maximum inclusive pyramid envelope coordinate."), hollow: z.boolean().optional().describe("Whether to emit only the pyramid shell."), thickness: z.number().int().positive().optional().describe("Shell thickness when hollow is true.") }),
    z.object({ type: z.literal("polygon").describe("Selects an axis-aligned planar polygon primitive."), points: z.array(outputVec3Schema.describe("One ordered polygon vertex.")).min(3).describe("Ordered vertices of the planar polygon."), filled: z.boolean().optional().describe("Whether to fill the polygon interior.") }),
    z.object({ type: z.literal("rounded_rectangle").describe("Selects an axis-aligned rounded rectangle primitive."), min: outputVec3Schema.describe("Minimum inclusive rectangle envelope coordinate."), max: outputVec3Schema.describe("Maximum inclusive rectangle envelope coordinate."), radius: z.number().int().nonnegative().describe("Corner radius in blocks."), filled: z.boolean().optional().describe("Whether to fill the rounded rectangle interior."), thickness: z.number().int().positive().optional().describe("Optional boundary thickness in blocks.") }),
    z.object({ type: z.literal("rounded_square").describe("Selects an axis-aligned rounded square primitive."), min: outputVec3Schema.describe("Minimum inclusive square envelope coordinate."), max: outputVec3Schema.describe("Maximum inclusive square envelope coordinate."), radius: z.number().int().nonnegative().describe("Corner radius in blocks."), filled: z.boolean().optional().describe("Whether to fill the rounded square interior."), thickness: z.number().int().positive().optional().describe("Optional boundary thickness in blocks.") }),
    z.object({ type: z.literal("extrusion").describe("Selects a straight profile extrusion primitive."), origin: outputVec3Schema.describe("World origin of the profile."), profile: designProfileOutputSchema.describe("Two-dimensional profile to extrude."), offset: outputVec3Schema.describe("Inclusive extrusion vector from the origin.") }),
    z.object({ type: z.literal("profile_extrusion").describe("Selects a profile extrusion along a polyline."), profile: designProfileOutputSchema.describe("Two-dimensional profile copied along the path."), path: z.array(outputVec3Schema.describe("One ordered path control point.")).min(2).describe("Ordered world-space polyline control points.") }),
    z.object({ type: z.literal("roof_plane").describe("Selects an axis-aligned sloped roof plane."), min: outputVec3Schema.describe("Minimum inclusive roof envelope coordinate."), max: outputVec3Schema.describe("Maximum inclusive roof envelope coordinate."), slopeAxis: z.enum(["x", "z"]).describe("Horizontal axis along which roof height changes."), highSide: z.enum(["min", "max"]).optional().describe("Envelope side containing the high edge."), thickness: z.number().int().positive().optional().describe("Roof thickness in blocks.") }),
    z.object({ type: z.literal("roof_ridge").describe("Selects a symmetric two-sided roof ridge."), min: outputVec3Schema.describe("Minimum inclusive roof envelope coordinate."), max: outputVec3Schema.describe("Maximum inclusive roof envelope coordinate."), ridgeAxis: z.enum(["x", "z"]).describe("Horizontal direction followed by the ridge line."), ridgeOffset: z.number().int().optional().describe("Optional integer offset of the ridge within the envelope."), thickness: z.number().int().positive().optional().describe("Roof thickness in blocks.") }),
    z.object({ type: z.literal("terrain_surface").describe("Selects a seeded deterministic terrain height field."), min: outputVec3Schema.describe("Minimum inclusive terrain envelope coordinate."), max: outputVec3Schema.describe("Maximum inclusive terrain envelope coordinate."), baseY: z.number().int().describe("Baseline surface elevation."), amplitude: z.number().nonnegative().describe("Maximum seeded height variation in blocks."), scale: z.number().positive().describe("Positive horizontal noise scale."), seed: z.string().min(1).describe("Stable terrain seed."), fillToY: z.number().int().optional().describe("Optional lowest elevation to fill beneath the surface.") }),
]).describe("One compact deterministic procedural primitive; it expands to exact blocks only during compilation.");
const proceduralMaterialTargetOutputSchema = z.union([
    z.string().min(1).describe("Material-library key or namespaced Minecraft block identifier."),
    z.object({ id: z.string().min(1).describe("Namespaced Minecraft block identifier."), state: z.record(z.string(), blockStateValueSchema).optional().describe("Exact block-state properties."), tags: z.array(z.string().describe("Open-ended material classification tag.")).optional().describe("Planning and audit tags attached to this target.") }),
]);
const proceduralWeightedMaterialOutputSchema = z.union([
    z.object({ material: z.string().min(1).describe("Material-library key or namespaced block identifier."), weight: z.number().positive().describe("Positive relative selection weight.") }),
    z.object({ id: z.string().min(1).describe("Namespaced Minecraft block identifier."), state: z.record(z.string(), blockStateValueSchema).optional().describe("Exact block-state properties."), tags: z.array(z.string().describe("Open-ended material classification tag.")).optional().describe("Planning and audit tags attached to this candidate."), weight: z.number().positive().describe("Positive relative selection weight.") }),
]);
export const proceduralMaterialDefinitionOutputSchema = z.union([
    designMaterialOutputSchema,
    z.discriminatedUnion("distribution", [
        z.object({ distribution: z.literal("weighted_random").describe("Selects seeded independent weighted material sampling."), seed: z.string().min(1).describe("Stable distribution seed."), blocks: z.array(proceduralWeightedMaterialOutputSchema).min(1).describe("Weighted material candidates.") }),
        z.object({ distribution: z.literal("weighted_noise").describe("Selects coherent seeded weighted-noise sampling."), seed: z.string().min(1).describe("Stable distribution seed."), scale: z.number().positive().describe("Positive coordinate noise scale."), blocks: z.array(proceduralWeightedMaterialOutputSchema).min(1).describe("Weighted material candidates.") }),
        z.object({ distribution: z.literal("clustered_noise").describe("Selects coherent seeded clustered material sampling."), seed: z.string().min(1).describe("Stable distribution seed."), scale: z.number().positive().describe("Positive cluster scale."), blocks: z.array(proceduralWeightedMaterialOutputSchema).min(1).describe("Weighted material candidates.") }),
        z.object({ distribution: z.literal("gradient").describe("Selects normalized axis-aligned material gradients."), axis: z.enum(["x", "y", "z"]).describe("World axis used to evaluate the gradient."), stops: z.array(z.object({ at: z.number().min(0).max(1).describe("Normalized stop position from zero to one."), material: proceduralMaterialTargetOutputSchema.describe("Material selected at this gradient stop.") })).min(1).describe("Ordered normalized material stops.") }),
        z.object({ distribution: z.literal("checker").describe("Selects a repeating three-dimensional checker pattern."), size: outputVec3Schema.refine(({ x, y, z }) => x > 0 && y > 0 && z > 0, "Checker cell dimensions must be positive.").describe("Positive checker-cell dimensions."), materials: z.array(proceduralMaterialTargetOutputSchema).min(2).describe("Materials cycled between checker cells.") }),
        z.object({ distribution: z.literal("pattern").describe("Selects a repeating material sequence."), axis: z.enum(["x", "y", "z"]).describe("World axis used to advance the pattern."), stride: z.number().int().positive().optional().describe("Positive number of blocks per material step."), materials: z.array(proceduralMaterialTargetOutputSchema).min(1).describe("Ordered material sequence.") }),
        z.object({
            distribution: z.literal("weathering").describe("Selects context-aware deterministic weathering."),
            seed: z.string().min(1).describe("Stable weathering seed."),
            base: proceduralMaterialTargetOutputSchema.describe("Unweathered base material."),
            weathered: proceduralMaterialTargetOutputSchema.describe("Material used where the weathering threshold is met."),
            amount: z.number().min(0).max(1).describe("Base weathering probability from zero to one."),
            edge: z.object({ exposedAxesAtLeast: z.union([z.literal(2), z.literal(3)]).optional().describe("Minimum exposed coordinate axes considered an edge."), weight: z.number().min(-1).max(1).describe("Signed contribution of edge exposure to weathering probability.") }).optional().describe("Optional edge-exposure weathering rule."),
            height: z.object({ minY: z.number().int().optional().describe("Optional lowest elevation affected by this height rule."), maxY: z.number().int().optional().describe("Optional highest elevation affected by this height rule."), weight: z.number().min(-1).max(1).describe("Signed contribution of elevation to weathering probability.") }).optional().describe("Optional elevation-aware weathering rule."),
            surfaceDirection: z.object({ directions: z.array(z.enum(["up", "down", "north", "south", "east", "west"]).describe("One exposed face direction eligible for the rule.")).min(1).describe("Exposed face directions eligible for directional weathering."), weight: z.number().min(-1).max(1).describe("Signed contribution of matching surface direction to weathering probability.") }).optional().describe("Optional surface-direction weathering rule."),
        }),
    ]),
]).describe("Exact or deterministic distributed material definition for Design IR v2.");
export const designElementOutputSchema = z.discriminatedUnion("kind", [
    z.object({
        ...designElementBase,
        kind: z.literal("fill").describe("Generate an inclusive filled cuboid."),
        min: outputVec3Schema.describe("Minimum local coordinate of the inclusive fill."),
        max: outputVec3Schema.describe("Maximum local coordinate of the inclusive fill."),
        material: z.string().describe("Material-library key, palette role, or namespaced block identifier used for the fill."),
    }).describe("Generic inclusive filled-cuboid operation."),
    z.object({
        ...designElementBase,
        kind: z.literal("shell").describe("Generate the boundary of an inclusive cuboid."),
        min: outputVec3Schema.describe("Minimum local coordinate of the inclusive shell."),
        max: outputVec3Schema.describe("Maximum local coordinate of the inclusive shell."),
        material: z.string().describe("Material-library key, palette role, or namespaced block identifier used for the shell."),
        thickness: z.number().int().positive().optional().describe("Optional shell thickness in blocks; defaults to one."),
    }).describe("Generic hollow cuboid-shell operation."),
    z.object({
        ...designElementBase,
        kind: z.literal("carve").describe("Remove placements from an inclusive cuboid."),
        min: outputVec3Schema.describe("Minimum local coordinate of the inclusive carve region."),
        max: outputVec3Schema.describe("Maximum local coordinate of the inclusive carve region."),
    }).describe("Generic inclusive cuboid carve operation."),
    z.object({
        ...designElementBase,
        kind: z.literal("cylinder").describe("Generate a vertical solid or hollow cylinder."),
        center: outputVec3Schema.describe("Local coordinate of the cylinder's bottom-center block."),
        radius: z.number().int().positive().describe("Outer cylinder radius in blocks."),
        height: z.number().int().positive().describe("Vertical cylinder height in blocks."),
        material: z.string().describe("Material-library key, palette role, or namespaced block identifier used for the cylinder."),
        hollow: z.boolean().optional().describe("Whether to generate only the cylinder wall instead of a solid volume."),
        thickness: z.number().int().positive().optional().describe("Wall thickness in blocks when the cylinder is hollow."),
        cap: z.boolean().optional().describe("Whether to close the top and bottom faces of a hollow cylinder."),
    }).describe("Generic vertical cylinder operation."),
    z.object({
        ...designElementBase,
        kind: z.literal("basin").describe("Generate a bounded, optionally liquid-filled basin."),
        min: outputVec3Schema.describe("Minimum local coordinate of the basin envelope."),
        max: outputVec3Schema.describe("Maximum local coordinate of the basin envelope."),
        wallMaterial: z.string().describe("Material-library key, palette role, or namespaced block identifier used for basin walls."),
        floorMaterial: z.string().optional().describe("Optional material reference used for the basin floor."),
        rimMaterial: z.string().optional().describe("Optional material reference used for the upper rim or coping."),
        liquidMaterial: z.string().optional().describe("Optional material reference used to fill the basin to liquidLevel."),
        liquidLevel: z.number().int().optional().describe("Local y coordinate of the highest liquid layer."),
        wallThickness: z.number().int().positive().optional().describe("Basin wall thickness in blocks; defaults to one."),
    }).describe("Generic basin operation for pools, channels, planters, tanks, and similar forms."),
    z.object({
        ...designElementBase,
        kind: z.literal("sweep").describe("Sweep a generic cross-section along a three-dimensional polyline."),
        points: z.array(outputVec3Schema.describe("Local control point on the sweep centerline.")).describe("Ordered centerline control points; interpolation creates a continuous voxel path."),
        crossSection: z.enum(["solid", "open_channel", "tube"]).describe("Cross-section topology applied along the path."),
        material: z.string().describe("Material-library key, palette role, or namespaced block identifier used for the sweep body."),
        width: z.number().int().positive().describe("Outer cross-section width in blocks."),
        height: z.number().int().positive().optional().describe("Outer cross-section height in blocks; defaults from width when omitted."),
        thickness: z.number().int().positive().optional().describe("Wall or channel thickness in blocks for hollow cross-sections."),
        innerMaterial: z.string().optional().describe("Optional material reference used inside an open channel or tube."),
        supports: z.object({
            material: z.string().describe("Material reference used for vertical supports."),
            interval: z.number().int().positive().describe("Centerline interval in blocks between automatic supports."),
            toY: z.number().int().describe("Local y coordinate at which every support terminates."),
            radius: z.number().int().nonnegative().optional().describe("Horizontal support radius in blocks; zero produces a one-block column."),
        }).optional().describe("Optional generic support rule applied along the sweep."),
    }).describe("Generic path-sweep operation for rails, ducts, bridges, flumes, pipes, roads, and other continuous forms."),
    z.object({
        ...designElementBase,
        kind: z.literal("stairs").describe("Generate a stepped connection between two local coordinates."),
        from: outputVec3Schema.describe("Local start coordinate of the staircase."),
        to: outputVec3Schema.describe("Local end coordinate of the staircase."),
        width: z.number().int().positive().describe("Clear stair width in blocks."),
        material: z.string().describe("Material reference used for stair treads and structure."),
        railingMaterial: z.string().optional().describe("Optional material reference used for edge railings."),
    }).describe("Generic staircase operation."),
    z.object({
        ...designElementBase,
        kind: z.literal("ramp").describe("Generate a continuous voxel ramp between two local coordinates."),
        from: outputVec3Schema.describe("Local start coordinate of the ramp."),
        to: outputVec3Schema.describe("Local end coordinate of the ramp."),
        width: z.number().int().positive().describe("Clear ramp width in blocks."),
        material: z.string().describe("Material reference used for the ramp surface and structure."),
        railingMaterial: z.string().optional().describe("Optional material reference used for edge railings."),
    }).describe("Generic ramp operation."),
    z.object({
        ...designElementBase,
        kind: z.literal("procedural").describe("Generate or filter coordinates using a Design IR v2 procedural primitive."),
        primitive: designPrimitiveOutputSchema.describe("Compact geometry primitive expanded only during deterministic compilation."),
        operation: z.enum(["add", "union", "clear", "subtract", "cut", "intersect"]).optional().describe("Sparse constructive operation applied to the component occupancy map; defaults to add."),
        material: z.string().min(1).optional().describe("Material-library key or exact block identifier used by additive operations."),
        clip: z.object({ min: outputVec3Schema.describe("Minimum inclusive clipping coordinate."), max: outputVec3Schema.describe("Maximum inclusive clipping coordinate.") }).optional().describe("Optional inclusive axis-aligned clipping envelope."),
        masks: z.array(z.object({ primitive: designPrimitiveOutputSchema.describe("Procedural mask volume."), invert: z.boolean().optional().describe("Whether to retain coordinates outside rather than inside this mask.") })).optional().describe("Optional ordered masks that filter generated coordinates."),
    }).describe("High-level deterministic primitive plus optional boolean, clip, and mask controls."),
]).describe("One domain-independent voxel operation in a generic design program.");
const assertionSourceSpanOutputSchema = z.object({
    start: z.number().int().nonnegative().describe("Zero-based first character of the cited wording within requirement.text."),
    end: z.number().int().positive().describe("Exclusive final character of the cited wording within requirement.text."),
    text: z.string().min(1).describe("Exact requirement.text substring between start and end."),
}).describe("Exact half-open source-text span that authorizes this geometric assertion.");
const assertionScopeOutputShape = {
    claimId: z.string().describe("Atomic-claim identifier within this requirement that the assertion proves."),
    sourceSpan: assertionSourceSpanOutputSchema,
    elementIds: z.array(z.string().describe("Mapped element identifier included in this assertion's narrower scope.")).min(1).optional().describe("Optional subset of the requirement's mapped elements; omission evaluates all mapped elements."),
};
export const designAssertionOutputSchema = z.discriminatedUnion("kind", [
    z.object({
        ...assertionScopeOutputShape,
        kind: z.literal("placement_count").describe("Require a minimum number of canonical placements."),
        minimum: z.number().int().positive().describe("Minimum canonical placement count."),
    }).describe("Basic placement-count evidence; every requirement also needs a stronger structural assertion."),
    z.object({
        ...assertionScopeOutputShape,
        kind: z.literal("axis_span").describe("Require an inclusive occupied span along one axis."),
        axis: z.enum(["x", "y", "z"]).describe("World-coordinate axis to measure."),
        minimum: z.number().int().positive().describe("Minimum inclusive span in blocks."),
    }).describe("Measurable width, height, or depth evidence."),
    z.object({
        ...assertionScopeOutputShape,
        kind: z.literal("distinct_elements").describe("Require multiple distinct mapped element IDs to generate placements."),
        minimum: z.number().int().positive().describe("Minimum distinct generated element count."),
    }).describe("Distinct-element evidence for compound or enumerated requirements."),
    z.object({
        ...assertionScopeOutputShape,
        kind: z.literal("element_instances").describe("Require multiple generated base-or-offset instances of scoped elements."),
        minimum: z.number().int().positive().describe("Minimum distinct generated element-instance count."),
    }).describe("Repeated-instance evidence for quantified subjects such as two kiosks without relying on unrelated elements."),
    z.object({
        ...assertionScopeOutputShape,
        kind: z.literal("distinct_materials").describe("Require multiple block materials in canonical evidence."),
        minimum: z.number().int().positive().describe("Minimum distinct canonical block identifier count."),
    }).describe("Material-diversity evidence within one requirement."),
    z.object({
        ...assertionScopeOutputShape,
        kind: z.literal("element_kind").describe("Require generated mapped elements of a generic operation kind."),
        elementKind: z.enum(["fill", "shell", "carve", "cylinder", "basin", "sweep", "stairs", "ramp", "procedural"]).describe("Generic Design IR operation kind to require."),
        minimum: z.number().int().positive().describe("Minimum generated mapped elements of this kind."),
    }).describe("Typed generic-operation evidence; it does not by itself satisfy the structural-strength rule."),
    z.object({
        ...assertionScopeOutputShape,
        kind: z.literal("path_geometry").describe("Require measurable routed sweep geometry."),
        minimumPaths: z.number().int().positive().optional().describe("Minimum distinct mapped sweep paths."),
        minimumControlPointsPerPath: z.number().int().positive().optional().describe("Minimum control points on every scoped path."),
        minimumVerticalDrop: z.number().int().positive().optional().describe("Minimum max-y minus min-y drop on every scoped path."),
        supportsRequired: z.boolean().optional().describe("When true, every scoped path must declare supports and produce support placements."),
    }).describe("Path count, complexity, vertical drop, and support evidence; at least one threshold or supportsRequired=true is required."),
    z.object({
        ...assertionScopeOutputShape,
        kind: z.literal("material_tag_count").describe("Require canonical placements whose material definitions carry one tag."),
        tag: z.string().min(1).describe("Exact caller-defined material-library tag."),
        minimumPlacements: z.number().int().positive().describe("Minimum canonical placements made from materials carrying the tag."),
    }).describe("Source-grounded semantic-material evidence backed by actual placements."),
    z.object({
        ...assertionScopeOutputShape,
        kind: z.literal("support_count").describe("Require distinct generated vertical support columns."),
        minimumColumns: z.number().int().positive().describe("Minimum distinct x,z support columns evidenced by support-phase placements."),
    }).describe("Generated support-column evidence."),
    z.object({
        ...assertionScopeOutputShape,
        kind: z.literal("boundary_contact").describe("Require mapped geometry to touch specified build-envelope faces."),
        sides: z.array(z.enum(["north", "south", "east", "west", "top", "bottom"]).describe("Requested envelope face.")).min(1).describe("Every envelope face that must be touched."),
        minimumPlacementsPerSide: z.number().int().positive().describe("Minimum canonical placements on each requested face."),
    }).describe("Measurable build-envelope connection evidence."),
]).describe("One typed, source-grounded assertion evaluated against canonical geometry.");
const designProgramBaseOutputShape = {
    description: z.string().describe("Concise explanation of how the operations realize the retained source brief."),
    requirements: z.array(z.object({
        id: z.string().describe("Stable hard-requirement identifier referenced by design elements."),
        text: z.string().describe("Exact hard requirement retained from the source brief or feature list."),
        elementIds: z.array(z.string().describe("Design-element identifier expected to evidence this requirement.")).describe("All generic elements that must produce evidence for this requirement."),
        claims: z.array(z.object({
            id: z.string().describe("Stable atomic-claim identifier referenced by assertions."),
            sourceSpan: assertionSourceSpanOutputSchema,
            predicate: z.enum(["extent", "quantity", "path", "containment", "enclosure", "access", "support", "boundary", "material", "fixture", "surface"]).describe("Allowlisted geometric predicate that determines which assertion families may prove this claim."),
            status: z.enum(["asserted", "unsupported"]).describe("Asserted claims need structural evidence; unsupported claims invalidate the hard requirement."),
            reason: z.string().optional().describe("Concise explanation when no implemented geometric predicate can verify this exact claim."),
        }).describe("One non-overlapping atomic source claim.")).min(1).describe("Atomic source claims that collectively preserve the hard requirement."),
        assertions: z.array(designAssertionOutputSchema).min(1).describe("Typed structural assertions used to verify the requirement against compiled geometry."),
    })).describe("All hard requirements represented by this generic design program; there is no arbitrary cardinality cap."),
    elements: z.array(designElementOutputSchema).describe("Canonical geometry operations referenced directly or through v2 components and templates."),
};
export const designProgramV1OutputSchema = z.object({
    schemaVersion: z.literal(1).describe("Generic-design schema version; currently exactly 1."),
    ...designProgramBaseOutputShape,
}).describe("Backward-compatible Design IR v1 program.");
const designOperationPhaseOutputSchema = z.enum(["terrain_foundation", "primary_mass", "structure", "walls", "roof", "cuts_openings", "trim", "detail", "lighting", "landscaping", "explicit_overrides"])
    .describe("Canonical construction phase used for stable merge priority and conflict attribution.");
const designRepetitionOutputSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("linear").describe("Repeat a template at a constant vector step."), count: z.number().int().positive().describe("Number of linear instances including the origin."), step: outputVec3Schema.describe("Translation between consecutive instances.") }),
    z.object({ kind: z.literal("grid").describe("Repeat a template on a three-dimensional grid."), count: z.object({ x: z.number().int().positive().describe("Grid instance count along x."), y: z.number().int().positive().describe("Grid instance count along y."), z: z.number().int().positive().describe("Grid instance count along z.") }).describe("Positive instance counts along each axis."), step: outputVec3Schema.describe("Translation between adjacent grid cells.") }),
    z.object({ kind: z.literal("radial").describe("Repeat a template around a horizontal circle."), count: z.number().int().positive().describe("Number of radial instances."), center: outputVec3Schema.describe("Center of the repetition circle."), radius: z.number().int().nonnegative().describe("Horizontal circle radius in blocks."), startAngleDegrees: z.number().optional().describe("Optional starting angle in degrees.") }),
    z.object({ kind: z.literal("mirrored").describe("Mirror a template once across an axis-aligned plane."), axis: z.enum(["x", "z"]).describe("Horizontal axis normal to the mirror plane."), coordinate: z.number().int().describe("World coordinate of the mirror plane.") }),
    z.object({ kind: z.literal("alternating").describe("Repeat a template linearly with an alternating secondary offset."), count: z.number().int().positive().describe("Number of alternating instances."), step: outputVec3Schema.describe("Base translation between consecutive instances."), alternateOffset: outputVec3Schema.describe("Additional translation applied to every second instance.") }),
    z.object({ kind: z.literal("position_list").describe("Repeat a template at an explicit bounded list of offsets."), positions: z.array(outputVec3Schema.describe("One explicit template offset.")).min(1).describe("Ordered explicit template offsets.") }),
]).describe("Compact repetition rule that expands template references without duplicating their definitions.");
const designTemplateInstanceOutputSchema = z.object({
    id: z.string().min(1).describe("Stable template-instance identifier used in conflict attribution."),
    templateId: z.string().min(1).describe("Identifier of the reusable template definition."),
    origin: outputVec3Schema.optional().describe("Base translation applied before repetition."),
    repetition: designRepetitionOutputSchema.optional().describe("Optional compact repetition rule; omission emits one instance."),
    materialOverrides: z.record(z.string(), z.string()).optional().describe("Per-instance mapping from source material references to replacement references."),
}).describe("Reference to one reusable template plus origin, repetition, and material overrides.");
export const designComponentOutputSchema = z.object({
    id: z.string().min(1).describe("Stable component identifier used by dependencies, cache keys, and revisions."),
    name: z.string().min(1).describe("Human-readable component name."),
    type: z.string().min(1).describe("Open-ended semantic component type used for inspection and editing."),
    bounds: z.object({ min: outputVec3Schema.describe("Minimum inclusive component coordinate."), max: outputVec3Schema.describe("Maximum inclusive component coordinate.") }).describe("Declared inclusive component envelope."),
    dependencies: z.array(z.string().describe("Identifier of a component that must compile before this component.")).describe("Direct component dependencies; transitive dependents are rebuilt when needed."),
    elementIds: z.array(z.string().describe("Identifier of a design element owned by this component.")).describe("Direct design elements owned by the component."),
    templateInstances: z.array(designTemplateInstanceOutputSchema).optional().describe("Reusable template references instantiated by this component."),
    seed: z.string().min(1).describe("Stable component seed included in its cache identity."),
    operationPhase: designOperationPhaseOutputSchema.describe("Canonical merge phase for the component."),
    revision: z.object({ revision: z.number().int().nonnegative().describe("Monotonic component revision number."), parentRevision: z.number().int().nonnegative().optional().describe("Optional previous component revision."), message: z.string().optional().describe("Optional human-readable revision note.") }).describe("Monotonic component revision metadata."),
}).describe("Stable independently cacheable component in Design IR v2.");
export const designProgramV2OutputSchema = z.object({
    schemaVersion: z.literal(2).describe("Componentized procedural Design IR schema version; exactly 2."),
    ...designProgramBaseOutputShape,
    materials: z.record(z.string(), proceduralMaterialDefinitionOutputSchema).optional().describe("Optional Design IR v2 material library including deterministic distributions."),
    templates: z.array(z.object({ id: z.string().min(1).describe("Stable reusable-template identifier."), name: z.string().optional().describe("Optional human-readable template name."), elementIds: z.array(z.string().describe("Design element referenced by this template.")).min(1).describe("Elements reused whenever this template is instantiated.") })).describe("Reusable element groups referenced by component template instances."),
    components: z.array(designComponentOutputSchema).min(1).describe("Independently cacheable dependency-ordered components."),
}).describe("Canonical componentized Design IR v2 program with reusable templates and distributed materials.");
export const designProgramOutputSchema = z.discriminatedUnion("schemaVersion", [designProgramV1OutputSchema, designProgramV2OutputSchema])
    .describe("Domain-independent design program compiled directly into canonical voxel placements.");
export const normalizedBuildInputOutputSchema = z.object({
    name: z.string(),
    edition: z.enum(["java", "bedrock"]),
    version: z.string(),
    style: z.string(),
    sourceBrief: z.string(),
    dimensions: outputDimensionsSchema,
    palette: z.array(z.string()),
    rolePalette: rolePaletteOutputSchema.partial(),
    materialLibrary: z.record(z.string(), designMaterialOutputSchema),
    design: designProgramOutputSchema,
    origin: outputVec3Schema,
    features: z.array(z.string()),
    blockBudget: z.number().int().positive(),
    seed: z.string(),
    buildingType: z.enum(buildingTypes),
    confirmationToken: z.string(),
});
export const validationIssueOutputSchema = z.object({
    code: z.string(),
    severity: z.enum(["error", "warning", "info"]),
    message: z.string(),
    coordinates: z.array(outputVec3Schema).optional(),
});
export const buildValidationOutputSchema = z.object({
    valid: z.boolean(),
    blockingIssues: nonNegativeInteger,
    warnings: nonNegativeInteger,
    issues: z.array(validationIssueOutputSchema),
    attemptedCollisions: nonNegativeInteger,
});
export const contractClauseSeverityOutputSchema = z.enum(["hard", "warning", "aesthetic"]);
export const contractClauseStatusOutputSchema = z.enum(["pass", "fail", "unsupported", "unevaluated", "warning", "observation"]);
const contractParameterValueOutputSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);
export const contractClauseOutputSchema = z.object({
    id: z.string().describe("Deterministic clause identifier within this normalized contract."),
    severity: contractClauseSeverityOutputSchema,
    requirement: z.string().describe("Normalized human-readable requirement."),
    source: z.enum(["implicit", "feature", "override"]),
    sourceText: z.string().describe("Original source text retained so no declared requirement disappears silently."),
    evaluator: z.string().optional().describe("Executable evaluator id; absent means the clause is unsupported."),
    supported: z.boolean().describe("Whether an executable evaluator is available for this clause."),
    parameters: z.record(z.string(), contractParameterValueOutputSchema),
});
export const contractCheckResultOutputSchema = z.object({
    clauseId: z.string(),
    severity: contractClauseSeverityOutputSchema,
    status: contractClauseStatusOutputSchema,
    requirement: z.string(),
    evaluator: z.string().optional(),
    message: z.string(),
    expected: z.string().optional(),
    actual: z.string().optional(),
    coordinates: z.array(outputVec3Schema).max(250).optional().describe("Bounded evidence sample; aggregate messages retain exact totals."),
});
export const buildCertificateOutputSchema = z.object({
    schemaVersion: z.literal(1),
    evaluatorVersion: z.string(),
    buildId: z.string(),
    buildHash: sha256Schema.describe("Immutable build hash to which this certificate is bound."),
    status: z.enum(["valid", "invalid"]),
    hard: z.object({
        passed: nonNegativeInteger,
        failed: nonNegativeInteger,
        unsupported: nonNegativeInteger,
        unevaluated: nonNegativeInteger,
    }),
    warningCount: nonNegativeInteger,
    aestheticObservationCount: nonNegativeInteger,
    text: z.string().describe("Deterministic human-readable certificate containing the full build hash and hard-result summary."),
});
export const buildContractResultOutputSchema = z.object({
    schemaVersion: z.literal(1),
    evaluatorVersion: z.string(),
    buildHash: sha256Schema,
    status: z.enum(["valid", "invalid"]),
    normalizedClauses: z.array(contractClauseOutputSchema),
    hardResults: z.array(contractCheckResultOutputSchema),
    warnings: z.array(contractCheckResultOutputSchema),
    aestheticObservations: z.array(contractCheckResultOutputSchema),
    summary: z.object({
        passed: nonNegativeInteger,
        failed: nonNegativeInteger,
        unsupported: nonNegativeInteger,
        unevaluated: nonNegativeInteger,
    }),
    certificate: buildCertificateOutputSchema,
});
export const semanticAuditCheckOutputSchema = z.object({
    id: z.string(),
    category: z.enum(["integrity", "entrances", "clearance", "spawn", "rooms", "lighting", "interior", "support", "palette", "version", "origin", "budget"]),
    status: z.enum(["pass", "fail", "warning", "unevaluated"]),
    message: z.string(),
    expected: z.string(),
    actual: z.string(),
    coordinates: z.array(outputVec3Schema).max(250),
    total: nonNegativeInteger.optional(),
});
export const semanticBuildAuditOutputSchema = z.object({
    evaluatorVersion: z.string(),
    buildHash: sha256Schema,
    checks: z.array(semanticAuditCheckOutputSchema),
    entranceWidths: z.object({
        north: nonNegativeInteger.optional(),
        south: nonNegativeInteger.optional(),
        east: nonNegativeInteger.optional(),
        west: nonNegativeInteger.optional(),
    }),
    lightCount: nonNegativeInteger,
    spawn: outputVec3Schema.optional(),
});
export const buildRegistryOutputSchema = z.object({
    edition: z.enum(["java", "bedrock"]),
    requestedVersion: z.string(),
    resolvedVersion: z.string().optional().describe("Exact registry version selected after resolving aliases such as Bedrock stable or latest."),
    coverageVersion: z.string(),
    source: z.string(),
    sourceUrl: z.string(),
    syncedAt: z.string(),
    clientSha1: z.string().optional(),
    blockCount: nonNegativeInteger.optional(),
    protocolVersion: z.number().int().optional(),
    worldVersion: z.number().int().optional(),
    resourcePackVersion: resourcePackVersionOutputSchema.optional(),
    note: z.string().optional(),
}).passthrough();
const componentConflictSourceOutputSchema = z.object({
    componentId: z.string(),
    elementId: z.string().optional(),
    elementInstanceId: z.string().optional(),
    operationPhase: designOperationPhaseOutputSchema,
});
export const componentGraphOutputSchema = z.object({
    schemaVersion: z.literal(1),
    order: z.array(z.string()),
    components: z.array(z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
        dependencies: z.array(z.string()),
        bounds: z.object({ min: outputVec3Schema, max: outputVec3Schema }),
        seed: z.string(),
        operationPhase: designOperationPhaseOutputSchema,
        revision: z.object({ revision: z.number().int().nonnegative(), parentRevision: z.number().int().nonnegative().optional(), message: z.string().optional() }),
        geometryHash: sha256Schema,
        materialHash: sha256Schema,
        combinedHash: sha256Schema,
        cacheKey: z.string(),
    })),
    graphHash: sha256Schema,
});
export const componentCompileReportOutputSchema = z.object({
    changed: z.array(z.string()),
    rebuilt: z.array(z.string()),
    reused: z.array(z.string()),
    cacheHits: nonNegativeInteger,
    cacheMisses: nonNegativeInteger,
    conflicts: z.array(z.object({
        coordinate: outputVec3Schema,
        kind: z.enum(["replacement", "removal"]),
        previous: componentConflictSourceOutputSchema.optional(),
        incoming: componentConflictSourceOutputSchema,
    })),
    conflictCount: nonNegativeInteger,
    evictions: nonNegativeInteger,
});
export const buildSummaryOutputSchema = z.object({
    schemaVersion: z.literal(2),
    id: z.string().describe("Stable id derived from the deterministic build hash."),
    cacheRef: z.string().optional().describe("Short-lived, unguessable hosted cache capability. Pass this value—not the deterministic id—to a later hosted review, validation, revision, paging, or export call. Omitted for PC-local builds."),
    hash: sha256Schema.describe("Full deterministic SHA-256 build hash."),
    input: normalizedBuildInputOutputSchema,
    plan: architecturalPlanOutputSchema,
    preflight: buildPreflightOutputSchema,
    structuralFingerprint: sha256Schema,
    bounds: outputBoundsSchema,
    regions: z.array(z.object({
        id: z.string(),
        chunkMin: z.object({ x: z.number().int(), z: z.number().int() }),
        chunkMax: z.object({ x: z.number().int(), z: z.number().int() }),
        bounds: z.object({ min: outputVec3Schema, max: outputVec3Schema }),
        placementCount: nonNegativeInteger,
    })),
    materialCounts: z.record(z.string(), nonNegativeInteger),
    layerCounts: z.record(z.string(), nonNegativeInteger),
    phases: z.array(z.object({ name: z.string(), count: nonNegativeInteger })),
    componentGraph: componentGraphOutputSchema.optional().describe("Design IR v2 dependency graph and canonical component hashes."),
    compileReport: componentCompileReportOutputSchema.optional().describe("Incremental component reuse, rebuild, cache, and conflict evidence for this compile."),
    validation: buildValidationOutputSchema,
    registry: buildRegistryOutputSchema,
    contract: buildContractResultOutputSchema,
    certificate: buildCertificateOutputSchema,
    createdAt: z.string(),
    blockCount: nonNegativeInteger.describe("Exact number of canonical placements; placements themselves remain private view metadata."),
});
export const buildCandidateOutputSchema = z.object({
    candidate: z.number().int().min(1).max(5).describe("One-based candidate number."),
    maximumSimilarity: z.number().min(0).max(1).describe("Highest structural similarity to the comparison set."),
    build: buildSummaryOutputSchema,
    plan: architecturalPlanOutputSchema,
});
export const auditTotalsOutputSchema = z.object({
    errors: nonNegativeInteger,
    warnings: nonNegativeInteger,
    info: nonNegativeInteger,
    affectedPlacements: nonNegativeInteger,
});
export const buildAuditOutputSchema = z.object({
    buildId: z.string(),
    hash: sha256Schema,
    scannedPlacements: nonNegativeInteger,
    statefulPlacements: nonNegativeInteger,
    findings: z.array(z.object({
        code: z.string(),
        severity: z.enum(["error", "warning", "info"]),
        message: z.string(),
        total: nonNegativeInteger,
        coordinates: z.array(outputVec3Schema).describe("Bounded coordinate sample; total remains the full count."),
    })),
    totals: auditTotalsOutputSchema,
    checks: z.array(z.string()),
    semantic: semanticBuildAuditOutputSchema,
    contract: buildContractResultOutputSchema,
    certificate: buildCertificateOutputSchema,
});
export const savedPaletteOutputSchema = z.object({
    id: z.string(),
    name: z.string(),
    edition: z.enum(["java", "bedrock"]),
    version: z.string(),
    roles: rolePaletteOutputSchema,
    lockedRoles: z.array(z.enum(paletteRoleNames)),
    rejectedBlocks: z.array(z.string()),
    answers: z.record(z.string(), z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export const paletteInterviewOutputSchema = z.object({
    session: savedPaletteOutputSchema.extend({ complete: z.boolean() }),
    nextQuestion: z.object({ key: z.enum(interviewTopics), question: z.string() }).optional(),
    remainingTopics: z.array(z.enum(interviewTopics)),
});
export const discoveredWorldOutputSchema = z.object({
    id: z.string(),
    canonicalPath: z.string(),
    folderName: z.string(),
    displayName: z.string(),
    dataVersion: z.number().int().optional(),
    minecraftVersion: z.string().optional(),
    lastPlayed: z.number().int().optional(),
    gameMode: z.string().optional(),
    location: z.string(),
    locked: z.boolean(),
    platform: z.enum(["vanilla", "fabric", "neoforge", "forge", "paper", "spigot", "unknown"]),
    suggestedSchematicFolders: z.array(z.string()),
});
const installResultBaseSchema = z.object({
    world: discoveredWorldOutputSchema,
    dimension: z.enum(["overworld", "the_nether", "the_end"]),
    anchor: outputVec3Schema,
    affectedBounds: z.object({ min: outputVec3Schema, max: outputVec3Schema }),
    chunkRange: z.object({
        min: z.object({ x: z.number().int(), z: z.number().int() }),
        max: z.object({ x: z.number().int(), z: z.number().int() }),
    }),
    chunksTouched: nonNegativeInteger,
    blockCount: nonNegativeInteger,
    paletteSize: nonNegativeInteger,
    conflicts: z.object({
        status: z.enum(["not_scanned", "scanned"]),
        occupied: nonNegativeInteger.nullable(),
        protected: nonNegativeInteger.nullable(),
        note: z.string(),
    }),
    risk: z.object({ minecraft: riskLevelOutputSchema, worldEdit: riskLevelOutputSchema, warnings: z.array(z.string()) }),
    installedPath: z.string(),
    targetExists: z.boolean(),
    overwrite: z.boolean(),
    transform: z.object({
        rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
        mirror: z.enum(["none", "x", "z"]),
        offset: outputVec3Schema,
        includeAir: z.boolean(),
    }),
    instructions: z.array(z.string()),
    directWorldEditing: z.literal("unimplemented"),
    bytes: nonNegativeInteger,
    sha256: sha256Schema,
});
export const installWorldEditResultOutputSchema = z.discriminatedUnion("status", [
    installResultBaseSchema.extend({ status: z.literal("confirmation_required"), verified: z.literal(false) }),
    installResultBaseSchema.extend({ status: z.literal("installed"), verified: z.boolean() }),
]).describe("Complete no-write preview or post-write verification result for a WorldEdit schematic installation.");
//# sourceMappingURL=output-schemas.js.map