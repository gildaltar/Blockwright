import type { BuildRecord, Placement, Vec3 } from "./types.js";

export type ReviewCategory = "change" | "fix" | "remove" | "liked";

export type ReviewBounds = { min: Vec3; max: Vec3 };

export type ReviewAnnotation = {
  id: string;
  category: ReviewCategory;
  note: string;
  bounds: ReviewBounds;
  blockCount: number;
  pickedBlock?: string;
  pickedState?: Placement["state"];
  createdAt: string;
};

export type AuditFinding = {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  total: number;
  coordinates: Vec3[];
};

export type BuildAudit = {
  buildId: string;
  hash: string;
  scannedPlacements: number;
  statefulPlacements: number;
  findings: AuditFinding[];
  totals: { errors: number; warnings: number; info: number; affectedPlacements: number };
  checks: string[];
};

const directions = {
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  west: { x: -1, y: 0, z: 0 },
  east: { x: 1, y: 0, z: 0 },
} as const;

const coordinateKey = ({ x, y, z }: Vec3) => `${x},${y},${z}`;
const offset = (value: Vec3, delta: Vec3): Vec3 => ({ x: value.x + delta.x, y: value.y + delta.y, z: value.z + delta.z });
const isAir = (placement: Placement | undefined) => !placement || /(^|:)air$/.test(placement.block);
const isDecorativeGround = (placement: Placement) => /landscap|garden|foliage|path|terrain/i.test(placement.phase) || /grass|flower|leaves|vine|moss|carpet|snow/.test(placement.block);

export function isRoofPlacement(placement: Placement, build?: BuildRecord) {
  const paletteRoof = build?.input.rolePalette?.roof;
  return placement.block === paletteRoof
    || /roof|eave|ridge|gable|tile|finial|soffit/i.test(placement.phase)
    || /roof_tile/.test(placement.block);
}

function stateValue(placement: Placement, name: string) {
  const value = placement.state?.[name];
  return value === undefined ? undefined : String(value);
}

function canConnect(placement: Placement | undefined) {
  if (isAir(placement)) return false;
  return !/torch|button|lever|flower|grass|carpet|snow|rail/.test(placement!.block);
}

function collect(findings: Map<string, AuditFinding>, code: string, severity: AuditFinding["severity"], message: string, coordinate: Vec3) {
  const existing = findings.get(code) ?? { code, severity, message, total: 0, coordinates: [] };
  existing.total += 1;
  if (existing.coordinates.length < 250) existing.coordinates.push({ x: coordinate.x, y: coordinate.y, z: coordinate.z });
  findings.set(code, existing);
}

export function auditBuild(build: BuildRecord): BuildAudit {
  const byCoordinate = new Map(build.placements.map((placement) => [coordinateKey(placement), placement]));
  const findings = new Map<string, AuditFinding>();
  let statefulPlacements = 0;

  for (const placement of build.placements) {
    const state = placement.state ?? {};
    if (Object.keys(state).length) statefulPlacements += 1;
    const below = byCoordinate.get(coordinateKey(offset(placement, { x: 0, y: -1, z: 0 })));
    const above = byCoordinate.get(coordinateKey(offset(placement, { x: 0, y: 1, z: 0 })));

    if (/_stairs$/.test(placement.block)) {
      const facing = stateValue(placement, "facing");
      const half = stateValue(placement, "half");
      if (!facing || !(facing in directions) || (half !== undefined && !["top", "bottom"].includes(half))) {
        collect(findings, "INCOMPLETE_STAIR_STATE", "error", "Stairs must preserve a cardinal facing and top/bottom half in the canonical build.", placement);
      }
      if (isRoofPlacement(placement, build) && isAir(below) && facing && facing in directions) {
        const direction = directions[facing as keyof typeof directions];
        const backing = byCoordinate.get(coordinateKey(offset(placement, { x: -direction.x, y: 0, z: -direction.z })));
        const uphill = byCoordinate.get(coordinateKey(offset(placement, { x: -direction.x, y: 1, z: -direction.z })));
        if (isAir(backing) && isAir(uphill)) {
          collect(findings, "UNSUPPORTED_ROOF_STAIR", "warning", "Roof stairs with no block below, behind, or uphill may read as detached eaves; review every reported coordinate.", placement);
        }
      }
    }

    if (/_slab$/.test(placement.block)) {
      const type = stateValue(placement, "type");
      if (type !== undefined && !["top", "bottom", "double"].includes(type)) {
        collect(findings, "INCOMPLETE_SLAB_STATE", "warning", "Slabs should preserve their top, bottom, or double state for trustworthy review rendering.", placement);
      }
    }

    if (/_trapdoor$/.test(placement.block)) {
      const trapdoorValues = { facing: stateValue(placement, "facing"), half: stateValue(placement, "half"), open: stateValue(placement, "open") };
      if ((trapdoorValues.facing !== undefined && !(trapdoorValues.facing in directions)) || (trapdoorValues.half !== undefined && !["top", "bottom"].includes(trapdoorValues.half)) || (trapdoorValues.open !== undefined && !["true", "false"].includes(trapdoorValues.open))) {
        collect(findings, "INVALID_TRAPDOOR_STATE", "warning", "Trapdoor facing, half, or open state contains an unsupported value.", placement);
      }
    }

    if (/_door$/.test(placement.block) && !/_trapdoor$/.test(placement.block)) {
      const doorValues = { facing: stateValue(placement, "facing"), half: stateValue(placement, "half"), hinge: stateValue(placement, "hinge"), open: stateValue(placement, "open") };
      if ((doorValues.facing !== undefined && !(doorValues.facing in directions)) || (doorValues.half !== undefined && !["upper", "lower"].includes(doorValues.half)) || (doorValues.hinge !== undefined && !["left", "right"].includes(doorValues.hinge)) || (doorValues.open !== undefined && !["true", "false"].includes(doorValues.open))) {
        collect(findings, "INVALID_DOOR_STATE", "warning", "Door facing, half, hinge, or open state contains an unsupported value.", placement);
      }
    }

    if (/(^|:)lantern$|soul_lantern$/.test(placement.block)) {
      const hanging = stateValue(placement, "hanging") === "true";
      if ((hanging && isAir(above)) || (!hanging && isAir(below))) {
        collect(findings, "UNSUPPORTED_LIGHT", "warning", "Lantern support does not match its hanging state.", placement);
      }
    }

    if (/glass_pane|iron_bars|_fence$|_wall$/.test(placement.block)) {
      for (const [name, delta] of Object.entries(directions)) {
        const declared = stateValue(placement, name);
        if (declared === undefined) continue;
        const neighbor = byCoordinate.get(coordinateKey(offset(placement, delta)));
        const connected = declared === "true" || declared === "low" || declared === "tall";
        if (connected && !canConnect(neighbor)) {
          collect(findings, "DANGLING_CONNECTION_STATE", "warning", "A pane, fence, bars, or wall arm points toward empty or non-connectable space.", placement);
          break;
        }
      }
    }

    if (!isDecorativeGround(placement)) {
      const neighbors = [
        { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 },
        { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
      ].some((delta) => byCoordinate.has(coordinateKey(offset(placement, delta))));
      if (!neighbors) collect(findings, "ISOLATED_PLACEMENT", "warning", "A non-landscape block has no face-adjacent support or connection.", placement);
    }
  }

  if (build.validation.attemptedCollisions > 0) {
    findings.set("OVERLAPPING_GENERATOR_WRITES", {
      code: "OVERLAPPING_GENERATOR_WRITES",
      severity: "info",
      message: "The generator attempted to write more than one block at the same coordinate. The canonical record kept one placement; inspect phase boundaries for roof or trim overlap.",
      total: build.validation.attemptedCollisions,
      coordinates: [],
    });
  }

  const severityOrder = { error: 0, warning: 1, info: 2 } as const;
  const result = [...findings.values()].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.total - a.total);
  const totals = result.reduce((summary, finding) => {
    summary[finding.severity === "error" ? "errors" : finding.severity === "warning" ? "warnings" : "info"] += finding.total;
    summary.affectedPlacements += finding.total;
    return summary;
  }, { errors: 0, warnings: 0, info: 0, affectedPlacements: 0 });

  return {
    buildId: build.id,
    hash: build.hash,
    scannedPlacements: build.placements.length,
    statefulPlacements,
    findings: result,
    totals,
    checks: [
      "state preservation for stairs, slabs, doors, and trapdoors",
      "lantern support versus hanging state",
      "roof-stair contact below, behind, or uphill",
      "pane, fence, bars, and wall connection arms",
      "isolated non-landscape placements",
      "overlapping generator writes across all phases",
    ],
  };
}
