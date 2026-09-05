export type Edition = "java" | "bedrock";
export type Vec3 = { x: number; y: number; z: number };
export type Dimensions = { width: number; depth: number; height: number };

export type PaletteRole = "foundation" | "wall" | "frame" | "roof" | "trim" | "glazing" | "lighting" | "doors" | "railings" | "accents" | "landscaping";
export type RolePalette = Record<PaletteRole, string>;

export type Placement = Vec3 & {
  block: string;
  state?: Record<string, string | number | boolean>;
  phase: string;
  blockEntity?: { id: string; data?: Record<string, unknown> };
};

export type BuildingType = "house" | "temple" | "tower" | "workshop" | "hall" | "courtyard" | "megabase" | "waterpark";

export type BuildInput = {
  name: string;
  edition: Edition;
  version: string;
  style: string;
  dimensions: Dimensions;
  palette?: string[];
  rolePalette?: Partial<RolePalette>;
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
  footprint: { kind: "rectangle" | "courtyard" | "interlocking" | "tower" | "campus"; width: number; depth: number; inset: number };
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
