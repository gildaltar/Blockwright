export type Edition = "java" | "bedrock";
export type Vec3 = { x: number; y: number; z: number };
export type Dimensions = { width: number; depth: number; height: number };

export type PaletteRole = "foundation" | "wall" | "frame" | "roof" | "trim" | "glazing" | "lighting" | "doors" | "railings" | "accents" | "landscaping";
export type RolePalette = Record<PaletteRole, string>;

export type Placement = Vec3 & {
  block: string;
  state?: Record<string, string | number | boolean>;
  phase: string;
  /** Stable generic-design element which produced this placement. */
  elementId?: string;
  /** Stable base-or-offset instance which produced this placement. */
  elementInstanceId?: string;
  /** Hard requirements for which this exact placement is evidence. */
  requirementIds?: string[];
  blockEntity?: { id: string; data?: Record<string, unknown> };
};

export type BuildingType = "house" | "temple" | "tower" | "workshop" | "hall" | "courtyard" | "megabase";

export type DesignMaterial = string | {
  block: string;
  state?: Record<string, string | number | boolean>;
  tags?: string[];
};

export type DesignElementKind = "fill" | "shell" | "carve" | "cylinder" | "basin" | "sweep" | "stairs" | "ramp";

/** Exact half-open character range within DesignRequirement.text. */
export type DesignSourceSpan = {
  start: number;
  end: number;
  text: string;
};

type DesignAssertionBase = {
  /** Atomic claim within the requirement that this assertion proves. */
  claimId: string;
  /** Exact wording that authorizes this assertion; indexes are relative to DesignRequirement.text. */
  sourceSpan: DesignSourceSpan;
  /** Optional subset of the requirement's mapped elements against which to evaluate the assertion. */
  elementIds?: string[];
};

export type DesignAssertion =
  | (DesignAssertionBase & { kind: "placement_count"; minimum: number })
  | (DesignAssertionBase & { kind: "axis_span"; axis: "x" | "y" | "z"; minimum: number })
  | (DesignAssertionBase & { kind: "distinct_elements"; minimum: number })
  | (DesignAssertionBase & { kind: "element_instances"; minimum: number })
  | (DesignAssertionBase & { kind: "distinct_materials"; minimum: number })
  | (DesignAssertionBase & { kind: "element_kind"; elementKind: DesignElementKind; minimum: number })
  | (DesignAssertionBase & {
      kind: "path_geometry";
      minimumPaths?: number;
      minimumControlPointsPerPath?: number;
      minimumVerticalDrop?: number;
      supportsRequired?: boolean;
    })
  | (DesignAssertionBase & { kind: "material_tag_count"; tag: string; minimumPlacements: number })
  | (DesignAssertionBase & { kind: "support_count"; minimumColumns: number })
  | (DesignAssertionBase & {
      kind: "boundary_contact";
      sides: Array<"north" | "south" | "east" | "west" | "top" | "bottom">;
      minimumPlacementsPerSide: number;
    });

export type DesignAtomicClaim = {
  id: string;
  sourceSpan: DesignSourceSpan;
  predicate: "extent" | "quantity" | "path" | "containment" | "enclosure" | "access" | "support" | "boundary" | "material" | "fixture" | "surface";
  status: "asserted" | "unsupported";
  reason?: string;
};

export type DesignRequirement = {
  id: string;
  text: string;
  elementIds: string[];
  /** Non-overlapping source spans that cover every substantive part of the compound requirement. */
  claims: DesignAtomicClaim[];
  /** Machine-checkable, source-grounded claims. Label-only element mappings are never sufficient. */
  assertions: DesignAssertion[];
};

type DesignElementBase = {
  id: string;
  intent: string;
  phase?: string;
  requirementIds: string[];
  /** Optional local offsets repeat the same generic operation without duplicating its definition. */
  offsets?: Vec3[];
};

export type DesignElement =
  | (DesignElementBase & { kind: "fill"; min: Vec3; max: Vec3; material: string })
  | (DesignElementBase & { kind: "shell"; min: Vec3; max: Vec3; material: string; thickness?: number })
  | (DesignElementBase & { kind: "carve"; min: Vec3; max: Vec3 })
  | (DesignElementBase & { kind: "cylinder"; center: Vec3; radius: number; height: number; material: string; hollow?: boolean; thickness?: number; cap?: boolean })
  | (DesignElementBase & {
      kind: "basin";
      min: Vec3;
      max: Vec3;
      wallMaterial: string;
      floorMaterial?: string;
      rimMaterial?: string;
      liquidMaterial?: string;
      liquidLevel?: number;
      wallThickness?: number;
    })
  | (DesignElementBase & {
      kind: "sweep";
      points: Vec3[];
      crossSection: "solid" | "open_channel" | "tube";
      material: string;
      width: number;
      height?: number;
      thickness?: number;
      innerMaterial?: string;
      supports?: { material: string; interval: number; toY: number; radius?: number };
    })
  | (DesignElementBase & {
      kind: "stairs" | "ramp";
      from: Vec3;
      to: Vec3;
      width: number;
      material: string;
      railingMaterial?: string;
    });

export type DesignProgram = {
  schemaVersion: 1;
  description: string;
  requirements: DesignRequirement[];
  elements: DesignElement[];
};

export type BuildInput = {
  name: string;
  edition: Edition;
  version: string;
  style: string;
  dimensions: Dimensions;
  /** Verbatim user intent retained to prevent a lossy tool call from looking complete. */
  sourceBrief?: string;
  palette?: string[];
  rolePalette?: Partial<RolePalette>;
  /** Open-ended named material vocabulary. There is intentionally no cardinality limit. */
  materialLibrary?: Record<string, DesignMaterial>;
  /** Generic geometry program supplied by the planning model; no domain-object catalog is required. */
  design?: DesignProgram;
  origin?: Vec3;
  features?: string[];
  blockBudget?: number;
  seed?: string;
  buildingType?: BuildingType;
  confirmationToken?: string;
};

export type ValidationIssue = {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  coordinates?: Vec3[];
};

export type ContractClauseSeverity = "hard" | "warning" | "aesthetic";
export type ContractClauseStatus = "pass" | "fail" | "unsupported" | "unevaluated" | "warning" | "observation";

export type ContractClause = {
  id: string;
  severity: ContractClauseSeverity;
  requirement: string;
  source: "implicit" | "feature" | "override";
  sourceText: string;
  evaluator?: string;
  supported: boolean;
  parameters: Record<string, string | number | boolean | string[]>;
};

export type ContractCheckResult = {
  clauseId: string;
  severity: ContractClauseSeverity;
  status: ContractClauseStatus;
  requirement: string;
  evaluator?: string;
  message: string;
  expected?: string;
  actual?: string;
  coordinates?: Vec3[];
};

export type BuildCertificate = {
  schemaVersion: 1;
  evaluatorVersion: string;
  buildId: string;
  buildHash: string;
  status: "valid" | "invalid";
  hard: { passed: number; failed: number; unsupported: number; unevaluated: number };
  warningCount: number;
  aestheticObservationCount: number;
  text: string;
};

export type BuildContractResult = {
  schemaVersion: 1;
  evaluatorVersion: string;
  buildHash: string;
  status: "valid" | "invalid";
  normalizedClauses: ContractClause[];
  hardResults: ContractCheckResult[];
  warnings: ContractCheckResult[];
  aestheticObservations: ContractCheckResult[];
  summary: { passed: number; failed: number; unsupported: number; unevaluated: number };
  certificate: BuildCertificate;
};

export type RiskLevel = "green" | "amber" | "red";

export type BuildPreflight = {
  dimensions: Dimensions;
  totalVolume: number;
  estimatedOccupiedBlocks: number;
  estimatedPlacementAttempts: number;
  estimatedUniqueMaterials: number;
  chunksTouched: number;
  estimatedCommandCount: number;
  estimatedExportBytes: number;
  estimatedMemoryBytes: number;
  estimatedGenerationMs: number;
  minecraftRisk: RiskLevel;
  worldEditRisk: RiskLevel;
  overallRisk: RiskLevel;
  requiresConfirmation: boolean;
  confirmationToken?: string;
  warnings: string[];
  choices: ("continue" | "simplify" | "split_into_phases" | "cancel")[];
  regionSize: number;
  estimatedRegions: number;
};

export type ArchitecturalPlan = {
  schemaVersion: 1;
  seed: string;
  program: { buildingType: BuildingType; spaces: string[] };
  footprint: { kind: "rectangle" | "courtyard" | "interlocking" | "tower"; width: number; depth: number; inset: number };
  massing: { volumes: { id: string; min: Vec3; max: Vec3; purpose: string }[]; asymmetry: number };
  roomGraph: { rooms: { id: string; purpose: string; floor: number }[]; links: { from: string; to: string }[] };
  circulation: { primary: string; vertical: string; exterior: string[] };
  floorHeights: number[];
  facadeBays: { side: "north" | "south" | "east" | "west"; count: number; rhythm: string }[];
  structuralFrame: { system: string; bayWidth: number; supports: string[] };
  roofGrammar: { type: "gable" | "hipped" | "flat" | "pagoda" | "stepped"; pitch: number; overhang: number; tiers: number };
  entrances: { side: string; width: number; emphasis: string }[];
  windows: { pattern: string; sill: number; height: number };
  details: string[];
  landscaping: string[];
  fingerprint: string;
};

export type BuildRegion = {
  id: string;
  chunkMin: { x: number; z: number };
  chunkMax: { x: number; z: number };
  bounds: { min: Vec3; max: Vec3 };
  placementCount: number;
};

export type BuildRecord = {
  schemaVersion: 2;
  id: string;
  hash: string;
  input: Required<BuildInput>;
  plan: ArchitecturalPlan;
  preflight: BuildPreflight;
  structuralFingerprint: string;
  bounds: { min: Vec3; max: Vec3; dimensions: Dimensions };
  placements: Placement[];
  regions: BuildRegion[];
  materialCounts: Record<string, number>;
  layerCounts: Record<string, number>;
  phases: { name: string; count: number }[];
  validation: {
    valid: boolean;
    blockingIssues: number;
    warnings: number;
    issues: ValidationIssue[];
    attemptedCollisions: number;
  };
  registry: {
    edition: Edition;
    requestedVersion: string;
    resolvedVersion?: string;
    coverageVersion: string;
    source: string;
    sourceUrl: string;
    syncedAt: string;
    worldVersion?: number;
    note?: string;
  };
  contract: BuildContractResult;
  certificate: BuildCertificate;
  createdAt: string;
};

export type SavedPalette = {
  id: string;
  name: string;
  edition: Edition;
  version: string;
  roles: RolePalette;
  lockedRoles: PaletteRole[];
  rejectedBlocks: string[];
  answers: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type DiscoveredWorld = {
  id: string;
  canonicalPath: string;
  folderName: string;
  displayName: string;
  dataVersion?: number;
  minecraftVersion?: string;
  lastPlayed?: number;
  gameMode?: string;
  location: string;
  locked: boolean;
  platform: "vanilla" | "fabric" | "neoforge" | "forge" | "paper" | "spigot" | "unknown";
  suggestedSchematicFolders: string[];
};

export type WorldRegion = {
  edition: Edition;
  version: string;
  origin: Vec3;
  dimensions: Dimensions;
  blocks?: Placement[];
  protectedCoordinates?: Vec3[];
  heightMap?: number[][];
  biomeMap?: string[][];
  structures?: { name: string; bounds: { min: Vec3; max: Vec3 } }[];
};
