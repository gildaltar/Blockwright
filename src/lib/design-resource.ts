import type { DesignElement, DesignProgram, Vec3 } from "./types.js";

const LIMIT = Number.MAX_SAFE_INTEGER;

function safeAdd(...values: number[]) {
  let total = 0;
  for (const value of values) {
    if (!Number.isFinite(value) || value >= LIMIT - total) return LIMIT;
    total += Math.max(0, Math.ceil(value));
  }
  return total;
}

function safeMultiply(...values: number[]) {
  let total = 1;
  for (const value of values) {
    const normalized = Math.max(0, Math.ceil(value));
    if (!Number.isFinite(normalized) || (normalized !== 0 && total > LIMIT / normalized)) return LIMIT;
    total *= normalized;
  }
  return total;
}

function inclusiveSpan(a: number, b: number) {
  return Math.abs(b - a) + 1;
}

function boxVolume(min: Vec3, max: Vec3) {
  return safeMultiply(inclusiveSpan(min.x, max.x), inclusiveSpan(min.y, max.y), inclusiveSpan(min.z, max.z));
}

function roundedPositive(value: number | undefined, fallback = 1) {
  return Math.max(1, Math.round(value ?? fallback));
}

function elementInstances(element: DesignElement) {
  return Math.max(1, element.offsets?.length ?? 0);
}

function sweepSampleUpperBound(points: Vec3[]) {
  if (points.length < 2) return 0;
  return safeAdd(
    1,
    ...points.slice(0, -1).map((point, index) => {
      const next = points[index + 1];
      // The compiler expands diagonal interpolation into face-adjacent steps;
      // Manhattan length is therefore the conservative/exact segment bound.
      return Math.max(
        Math.abs(next.x - point.x) + Math.abs(next.y - point.y) + Math.abs(next.z - point.z),
        1,
      );
    }),
  );
}

/**
 * Conservative upper bound on coordinate writes/deletes attempted by Design IR.
 * It deliberately counts overlaps and bounding boxes so a tiny final map cannot
 * conceal an expensive program.
 */
export function estimateDesignPlacementAttempts(program: DesignProgram) {
  let total = 0;
  for (const element of program.elements) {
    let perInstance = 0;
    if (element.kind === "fill" || element.kind === "shell" || element.kind === "carve") {
      perInstance = boxVolume(element.min, element.max);
    } else if (element.kind === "cylinder") {
      const radius = roundedPositive(element.radius);
      perInstance = safeMultiply(radius * 2 + 1, radius * 2 + 1, roundedPositive(element.height));
    } else if (element.kind === "basin") {
      const area = safeMultiply(inclusiveSpan(element.min.x, element.max.x), inclusiveSpan(element.min.z, element.max.z));
      const verticalSpan = inclusiveSpan(element.min.y, element.max.y);
      // Floor plus either wall/rim or contained liquid. This is at least every
      // put() the compiler can issue for a column, including intentional overlap.
      perInstance = safeMultiply(area, verticalSpan + roundedPositive(element.wallThickness) + 1);
    } else if (element.kind === "sweep") {
      const samples = sweepSampleUpperBound(element.points);
      const width = roundedPositive(element.width);
      const height = roundedPositive(element.height, width);
      const thickness = roundedPositive(element.thickness);
      const crossSection = element.crossSection === "solid"
        ? safeMultiply(width, height)
        : element.crossSection === "open_channel"
          ? safeMultiply(width, height + thickness + (element.innerMaterial ? 1 : 0))
          : safeMultiply(width, height, element.innerMaterial ? 2 : 1);
      let supports = 0;
      if (element.supports) {
        const radius = Math.max(0, Math.round(element.supports.radius ?? 0));
        const maximumPointY = Math.max(...element.points.map(({ y }) => y));
        const supportHeight = Math.max(0, maximumPointY - Math.round(element.supports.toY));
        supports = safeMultiply(samples, supportHeight, radius * 2 + 1, radius * 2 + 1);
      }
      perInstance = safeAdd(safeMultiply(samples, crossSection), supports);
    } else {
      const dx = Math.abs(element.to.x - element.from.x);
      const dy = Math.abs(element.to.y - element.from.y);
      const dz = Math.abs(element.to.z - element.from.z);
      const steps = Math.max(dx, dy, dz, 1) + 1;
      const width = roundedPositive(element.width);
      perInstance = safeMultiply(steps, width + (element.railingMaterial ? Math.min(width, 2) : 0));
    }
    total = safeAdd(total, safeMultiply(perInstance, elementInstances(element)));
  }
  return total;
}
