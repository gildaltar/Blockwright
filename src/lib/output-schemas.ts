import { z } from "zod";

const paletteRoleNames = ["foundation", "wall", "frame", "roof", "trim", "glazing", "lighting", "doors", "railings", "accents", "landscaping"] as const;
const buildingTypes = ["house", "temple", "tower", "workshop", "hall", "courtyard", "megabase"] as const;
const interviewTopics = ["buildType", "architecturalDirection", "biome", "mood", "interpretation", "constraints", "dominantMaterials", "contrast", "weathering", "landscaping", "avoidBlocks", "resourcePack"] as const;
const riskLevels = ["green", "amber", "red"] as const;
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

const rolePaletteShape = Object.fromEntries(
  paletteRoleNames.map((role) => [role, z.string().describe(`Namespaced block identifier assigned to the ${role} role.`)]),
) as Record<(typeof paletteRoleNames)[number], z.ZodString>;

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
    elementKind: z.enum(["fill", "shell", "carve", "cylinder", "basin", "sweep", "stairs", "ramp"]).describe("Generic Design IR operation kind to require."),
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

export const designProgramOutputSchema = z.object({
  schemaVersion: z.literal(1).describe("Generic-design schema version; currently exactly 1."),
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
    }).describe("One non-overlapping atomic source claim.")).min(1).describe("Atomic claims covering every substantive part of requirement.text; compound wording must be decomposed."),
    assertions: z.array(designAssertionOutputSchema).min(1).describe("Source-grounded machine checks; at least one must be stronger than placement count or an element-kind label."),
  }).describe("Hard requirement, explicit element mapping, and typed geometric acceptance assertions.")).describe("All hard requirements represented by this generic design program; there is no arbitrary cardinality cap."),
  elements: z.array(designElementOutputSchema).describe("Ordered generic geometry operations; there is no domain-object catalog or arbitrary element-count cap."),
}).describe("Domain-independent design program compiled directly into canonical voxel placements.");

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
