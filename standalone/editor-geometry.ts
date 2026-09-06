import { transformProceduralPrimitive } from "../src/lib/procedural-geometry.js";
import type { DesignPrimitive } from "../src/lib/types.js";

type Vec3 = { x: number; y: number; z: number };

type ComponentGeometryReferences = {
  elementIds: string[];
  templateInstances?: Array<{ templateId: string }>;
};

type DesignGeometryIndex = {
  elements: Array<{ id: string; kind: string; offsets?: Vec3[] }>;
  templates: Array<{ id: string; elementIds: string[] }>;
};

export function componentUsesProceduralGeometry(component: ComponentGeometryReferences, design: DesignGeometryIndex) {
  const proceduralElementIds = new Set(design.elements.filter(({ kind }) => kind === "procedural").map(({ id }) => id));
  if (component.elementIds.some((id) => proceduralElementIds.has(id))) return true;
  const templates = new Map(design.templates.map((template) => [template.id, template]));
  return (component.templateInstances ?? []).some(({ templateId }) =>
    templates.get(templateId)?.elementIds.some((id) => proceduralElementIds.has(id)) === true,
  );
}

const EXACT_RESIZE_KINDS = new Set(["fill", "shell", "carve"]);

export function componentCanResizeExactly(component: ComponentGeometryReferences, design: DesignGeometryIndex) {
  if (component.templateInstances?.length) return false;
  const elements = new Map(design.elements.map((element) => [element.id, element]));
  return component.elementIds.length > 0 && component.elementIds.every((id) => {
    const element = elements.get(id);
    return Boolean(element && EXACT_RESIZE_KINDS.has(element.kind));
  });
}

export function componentCanRotateOrMirrorExactly(component: ComponentGeometryReferences, design: DesignGeometryIndex) {
  if (component.templateInstances?.length) return false;
  const elements = new Map(design.elements.map((element) => [element.id, element]));
  return component.elementIds.length > 0 && component.elementIds.every((id) => {
    const element = elements.get(id);
    return Boolean(element && element.kind !== "procedural" && !element.offsets?.length);
  });
}

type TranslatableElement = {
  kind?: string;
  min?: Vec3;
  max?: Vec3;
  center?: Vec3;
  from?: Vec3;
  to?: Vec3;
  points?: Vec3[];
  primitive?: Record<string, unknown>;
  clip?: { min: Vec3; max: Vec3 };
  masks?: Array<{ primitive: Record<string, unknown>; invert?: boolean }>;
  liquidLevel?: number;
  supports?: { toY: number; [key: string]: unknown };
};

export function translateDesignElement(element: TranslatableElement, delta: Vec3) {
  const move = (point: Vec3) => {
    point.x += delta.x;
    point.y += delta.y;
    point.z += delta.z;
  };
  for (const point of [element.min, element.max, element.center, element.from, element.to]) if (point) move(point);
  element.points?.forEach(move);
  if (element.primitive) {
    element.primitive = transformProceduralPrimitive(element.primitive as unknown as DesignPrimitive, delta) as unknown as Record<string, unknown>;
  }
  if (element.clip) {
    move(element.clip.min);
    move(element.clip.max);
  }
  for (const mask of element.masks ?? []) {
    mask.primitive = transformProceduralPrimitive(mask.primitive as unknown as DesignPrimitive, delta) as unknown as Record<string, unknown>;
  }
  if (typeof element.liquidLevel === "number") element.liquidLevel += delta.y;
  if (element.supports && typeof element.supports.toY === "number") element.supports.toY += delta.y;
}

type TranslatableTemplateInstance = {
  origin?: Vec3;
  repetition?: Record<string, unknown>;
};

export function translateTemplateInstance(instance: TranslatableTemplateInstance, delta: Vec3) {
  const origin = instance.origin ?? { x: 0, y: 0, z: 0 };
  instance.origin = { x: origin.x + delta.x, y: origin.y + delta.y, z: origin.z + delta.z };
  const repetition = instance.repetition;
  if (repetition?.kind === "mirrored" && (repetition.axis === "x" || repetition.axis === "z") && typeof repetition.coordinate === "number") {
    repetition.coordinate += delta[repetition.axis];
  }
}

export function rotateBoundsY(bounds: { min: Vec3; max: Vec3 }, degrees: number) {
  const turns = (((degrees % 360) + 360) % 360) / 90;
  const center = { x: (bounds.min.x + bounds.max.x) / 2, z: (bounds.min.z + bounds.max.z) / 2 };
  const corners = [
    { x: bounds.min.x, z: bounds.min.z },
    { x: bounds.max.x, z: bounds.min.z },
    { x: bounds.min.x, z: bounds.max.z },
    { x: bounds.max.x, z: bounds.max.z },
  ].map((point) => {
    let x = point.x - center.x;
    let z = point.z - center.z;
    for (let index = 0; index < turns; index += 1) [x, z] = [-z, x];
    return { x: Math.round(center.x + x), z: Math.round(center.z + z) };
  });
  return {
    min: { x: Math.min(...corners.map(({ x }) => x)), y: bounds.min.y, z: Math.min(...corners.map(({ z }) => z)) },
    max: { x: Math.max(...corners.map(({ x }) => x)), y: bounds.max.y, z: Math.max(...corners.map(({ z }) => z)) },
  };
}
