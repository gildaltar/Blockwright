import { createHash } from "node:crypto";
import { materialDependencyPayload } from "./material-distribution.js";
import { transformProceduralPrimitive } from "./procedural-geometry.js";
const ID_PATTERN = /^[a-z0-9][a-z0-9_.-]*$/i;
const PHASE_ORDER = [
    "terrain_foundation", "primary_mass", "structure", "walls", "roof", "cuts_openings",
    "trim", "detail", "lighting", "landscaping", "explicit_overrides",
];
const PHASES = new Set(PHASE_ORDER);
export function resolveComponentGraph(design, context) {
    const elements = uniqueById(design.elements, "element");
    const templates = uniqueById(design.templates, "template");
    const components = uniqueById(design.components, "component");
    if (!design.components.length)
        throw new Error("DESIGN_COMPONENTS_EMPTY: Design IR v2 must contain at least one component.");
    for (const template of design.templates) {
        if (!template.elementIds.length)
            throw new Error(`DESIGN_TEMPLATE_EMPTY: ${template.id} must reference at least one element.`);
        assertUniqueReferences(template.elementIds, `template ${template.id}`);
        for (const elementId of template.elementIds)
            if (!elements.has(elementId))
                throw new Error(`DESIGN_TEMPLATE_ELEMENT_UNKNOWN: ${template.id} references ${elementId}.`);
    }
    for (const component of design.components) {
        if (!component.name.trim() || !component.type.trim() || !component.seed.trim())
            throw new Error(`DESIGN_COMPONENT_METADATA_INVALID: ${component.id} needs non-empty name, type, and seed values.`);
        if (!PHASES.has(component.operationPhase))
            throw new Error(`DESIGN_COMPONENT_PHASE_INVALID: ${component.id} uses ${String(component.operationPhase)}.`);
        assertBounds(component, context.dimensions);
        assertUniqueReferences(component.dependencies, `component ${component.id} dependencies`);
        assertUniqueReferences(component.elementIds, `component ${component.id} elements`);
        for (const dependency of component.dependencies) {
            if (!components.has(dependency))
                throw new Error(`DESIGN_COMPONENT_DEPENDENCY_UNKNOWN: ${component.id} depends on ${dependency}.`);
            if (dependency === component.id)
                throw new Error(`DESIGN_COMPONENT_DEPENDENCY_CYCLE: ${component.id} depends on itself.`);
        }
        for (const elementId of component.elementIds)
            if (!elements.has(elementId))
                throw new Error(`DESIGN_COMPONENT_ELEMENT_UNKNOWN: ${component.id} references ${elementId}.`);
        const instanceIds = new Set();
        for (const instance of component.templateInstances ?? []) {
            assertId(instance.id, "template instance");
            if (instanceIds.has(instance.id))
                throw new Error(`DESIGN_TEMPLATE_INSTANCE_ID_DUPLICATE: ${component.id}.${instance.id}`);
            instanceIds.add(instance.id);
            if (!templates.has(instance.templateId))
                throw new Error(`DESIGN_TEMPLATE_UNKNOWN: ${component.id}.${instance.id} references ${instance.templateId}.`);
            if (instance.origin)
                assertIntegerPoint(instance.origin, `${component.id}.${instance.id}.origin`);
            validateRepetition(instance.repetition, `${component.id}.${instance.id}`);
        }
        if (!component.elementIds.length && !(component.templateInstances?.length)) {
            throw new Error(`DESIGN_COMPONENT_EMPTY: ${component.id} must own an element or template instance.`);
        }
        if (!Number.isSafeInteger(component.revision.revision) || component.revision.revision < 1) {
            throw new Error(`DESIGN_COMPONENT_REVISION_INVALID: ${component.id} revision must be a positive safe integer.`);
        }
        if (component.revision.parentRevision !== undefined && (!Number.isSafeInteger(component.revision.parentRevision) || component.revision.parentRevision < 1)) {
            throw new Error(`DESIGN_COMPONENT_REVISION_INVALID: ${component.id} parentRevision must be a positive safe integer.`);
        }
    }
    const order = topologicalPhaseOrder(design.components);
    const combinedById = new Map();
    const resolvedById = new Map();
    for (const componentId of order) {
        const definition = components.get(componentId);
        const resolvedElements = definition.elementIds.map((elementId) => ({
            element: cloneElement(elements.get(elementId)),
            instancePrefix: `${definition.id}/direct/${elementId}`,
        }));
        for (const instance of definition.templateInstances ?? []) {
            const template = templates.get(instance.templateId);
            const transforms = repetitionTransforms(instance);
            transforms.forEach((transform, repetitionIndex) => {
                for (const elementId of template.elementIds) {
                    const transformed = transformElement(elements.get(elementId), transform, instance.materialOverrides ?? {});
                    resolvedElements.push({
                        element: transformed,
                        instancePrefix: `${definition.id}/${instance.id}/${repetitionIndex + 1}/${elementId}`,
                    });
                }
            });
        }
        const geometryHash = hashCanonical({
            id: definition.id,
            type: definition.type,
            bounds: definition.bounds,
            seed: definition.seed,
            operationPhase: definition.operationPhase,
            operations: resolvedElements.map(({ element, instancePrefix }) => ({ instancePrefix, element: withoutMaterialFields(element) })),
        });
        const materialHash = hashCanonical(resolvedElements.map(({ element, instancePrefix }) => ({
            instancePrefix,
            materials: materialReferences(element).map((reference) => ({
                reference,
                value: materialDependencyPayload(reference, {
                    materials: context.materials,
                    materialLibrary: context.materialLibrary,
                    rolePalette: context.rolePalette,
                }),
            })),
        })));
        const dependencyHashes = [...definition.dependencies].sort().map((id) => ({ id, combinedHash: combinedById.get(id) }));
        const combinedHash = hashCanonical({ geometryHash, materialHash, dependencies: dependencyHashes });
        const cacheKey = hashCanonical({
            compiler: "component-ir-v2.2",
            combinedHash,
            edition: context.edition,
            dimensions: context.dimensions,
            origin: context.origin,
        });
        combinedById.set(definition.id, combinedHash);
        const manifest = {
            id: definition.id,
            name: definition.name,
            type: definition.type,
            dependencies: [...definition.dependencies].sort(),
            bounds: cloneBounds(definition.bounds),
            seed: definition.seed,
            operationPhase: definition.operationPhase,
            revision: { ...definition.revision },
            geometryHash,
            materialHash,
            combinedHash,
            cacheKey,
        };
        resolvedById.set(definition.id, { definition, elements: resolvedElements, manifest });
    }
    const resolved = order.map((id) => resolvedById.get(id));
    const manifestWithoutHash = { schemaVersion: 1, order, components: resolved.map(({ manifest }) => manifest) };
    return { components: resolved, manifest: { ...manifestWithoutHash, graphHash: hashCanonical(manifestWithoutHash) } };
}
export function hashCanonical(value) {
    return createHash("sha256").update(stableStringify(value)).digest("hex");
}
function topologicalPhaseOrder(definitions) {
    const byId = new Map(definitions.map((component) => [component.id, component]));
    const indegree = new Map(definitions.map((component) => [component.id, component.dependencies.length]));
    const dependents = new Map();
    for (const component of definitions)
        for (const dependency of component.dependencies) {
            const list = dependents.get(dependency) ?? [];
            list.push(component.id);
            dependents.set(dependency, list);
        }
    const compare = (left, right) => {
        const phaseDifference = PHASE_ORDER.indexOf(byId.get(left).operationPhase) - PHASE_ORDER.indexOf(byId.get(right).operationPhase);
        return phaseDifference || left.localeCompare(right);
    };
    const ready = definitions.filter(({ id }) => indegree.get(id) === 0).map(({ id }) => id).sort(compare);
    const order = [];
    while (ready.length) {
        const id = ready.shift();
        order.push(id);
        for (const dependent of (dependents.get(id) ?? []).sort()) {
            const next = indegree.get(dependent) - 1;
            indegree.set(dependent, next);
            if (next === 0) {
                ready.push(dependent);
                ready.sort(compare);
            }
        }
    }
    if (order.length !== definitions.length) {
        const cycle = definitions.map(({ id }) => id).filter((id) => !order.includes(id)).sort();
        throw new Error(`DESIGN_COMPONENT_DEPENDENCY_CYCLE: ${cycle.join(" -> ")}.`);
    }
    return order;
}
function repetitionTransforms(instance) {
    const origin = instance.origin ?? { x: 0, y: 0, z: 0 };
    const repetition = instance.repetition;
    if (!repetition)
        return [{ translation: { ...origin } }];
    if (repetition.kind === "linear")
        return Array.from({ length: repetition.count }, (_, index) => ({ translation: add(origin, scale(repetition.step, index)) }));
    if (repetition.kind === "grid") {
        const transforms = [];
        for (let y = 0; y < repetition.count.y; y += 1)
            for (let z = 0; z < repetition.count.z; z += 1)
                for (let x = 0; x < repetition.count.x; x += 1) {
                    transforms.push({ translation: add(origin, { x: repetition.step.x * x, y: repetition.step.y * y, z: repetition.step.z * z }) });
                }
        return transforms;
    }
    if (repetition.kind === "radial")
        return Array.from({ length: repetition.count }, (_, index) => {
            const angle = ((repetition.startAngleDegrees ?? 0) + (360 * index) / repetition.count) * Math.PI / 180;
            return { translation: add(origin, {
                    x: repetition.center.x + Math.round(Math.cos(angle) * repetition.radius),
                    y: repetition.center.y,
                    z: repetition.center.z + Math.round(Math.sin(angle) * repetition.radius),
                }) };
        });
    if (repetition.kind === "mirrored") {
        return [
            { translation: { ...origin } },
            { translation: { ...origin }, mirror: { axis: repetition.axis, coordinate: repetition.coordinate } },
        ];
    }
    if (repetition.kind === "alternating")
        return Array.from({ length: repetition.count }, (_, index) => ({ translation: add(add(origin, scale(repetition.step, index)), index % 2 ? repetition.alternateOffset : { x: 0, y: 0, z: 0 }) }));
    return repetition.positions.map((position) => ({ translation: add(origin, position) }));
}
function validateRepetition(repetition, label) {
    if (!repetition)
        return;
    if (repetition.kind === "position_list") {
        if (!repetition.positions.length)
            throw new Error(`DESIGN_REPETITION_INVALID: ${label} position_list must not be empty.`);
        repetition.positions.forEach((point, index) => assertIntegerPoint(point, `${label}.positions[${index}]`));
        return;
    }
    if (repetition.kind === "mirrored") {
        if (!Number.isSafeInteger(repetition.coordinate))
            throw new Error(`DESIGN_REPETITION_INVALID: ${label}.coordinate must be an integer.`);
        return;
    }
    if (repetition.kind === "grid") {
        for (const axis of ["x", "y", "z"])
            if (!Number.isSafeInteger(repetition.count[axis]) || repetition.count[axis] < 1) {
                throw new Error(`DESIGN_REPETITION_INVALID: ${label}.count.${axis} must be a positive safe integer.`);
            }
    }
    else if (!Number.isSafeInteger(repetition.count) || repetition.count < 1) {
        throw new Error(`DESIGN_REPETITION_INVALID: ${label}.count must be a positive safe integer.`);
    }
    if (repetition.kind === "radial" && (!Number.isFinite(repetition.radius) || repetition.radius < 0))
        throw new Error(`DESIGN_REPETITION_INVALID: ${label}.radius must be non-negative.`);
    if (repetition.kind === "radial") {
        assertIntegerPoint(repetition.center, `${label}.center`);
        if (repetition.startAngleDegrees !== undefined && !Number.isFinite(repetition.startAngleDegrees))
            throw new Error(`DESIGN_REPETITION_INVALID: ${label}.startAngleDegrees must be finite.`);
    }
    if ("step" in repetition)
        assertIntegerPoint(repetition.step, `${label}.step`);
    if (repetition.kind === "alternating")
        assertIntegerPoint(repetition.alternateOffset, `${label}.alternateOffset`);
}
function transformElement(element, transform, overrides) {
    const translated = cloneElement(element);
    const translatedPoint = (point) => reflectPoint(add(point, transform.translation), transform.mirror);
    if (translated.kind === "fill" || translated.kind === "shell" || translated.kind === "carve" || translated.kind === "basin") {
        const first = translatedPoint(translated.min);
        const second = translatedPoint(translated.max);
        translated.min = { x: Math.min(first.x, second.x), y: Math.min(first.y, second.y), z: Math.min(first.z, second.z) };
        translated.max = { x: Math.max(first.x, second.x), y: Math.max(first.y, second.y), z: Math.max(first.z, second.z) };
        if (translated.kind === "basin" && translated.liquidLevel !== undefined)
            translated.liquidLevel += transform.translation.y;
    }
    else if (translated.kind === "cylinder")
        translated.center = translatedPoint(translated.center);
    else if (translated.kind === "sweep") {
        translated.points = translated.points.map(translatedPoint);
        if (translated.supports)
            translated.supports = { ...translated.supports, toY: translated.supports.toY + transform.translation.y };
    }
    else if (translated.kind === "procedural") {
        translated.primitive = transformProceduralPrimitive(translated.primitive, transform.translation, transform.mirror);
        if (translated.clip) {
            const first = translatedPoint(translated.clip.min);
            const second = translatedPoint(translated.clip.max);
            translated.clip = {
                min: { x: Math.min(first.x, second.x), y: Math.min(first.y, second.y), z: Math.min(first.z, second.z) },
                max: { x: Math.max(first.x, second.x), y: Math.max(first.y, second.y), z: Math.max(first.z, second.z) },
            };
        }
        if (translated.masks)
            translated.masks = translated.masks.map((mask) => ({
                ...mask,
                primitive: transformProceduralPrimitive(mask.primitive, transform.translation, transform.mirror),
            }));
    }
    else {
        translated.from = translatedPoint(translated.from);
        translated.to = translatedPoint(translated.to);
    }
    if (translated.offsets)
        translated.offsets = translated.offsets.map((offset) => transform.mirror?.axis === "x"
            ? { ...offset, x: -offset.x }
            : transform.mirror?.axis === "z" ? { ...offset, z: -offset.z } : offset);
    return overrideMaterials(translated, overrides);
}
function reflectPoint(point, mirror) {
    if (!mirror)
        return point;
    return mirror.axis === "x"
        ? { ...point, x: 2 * mirror.coordinate - point.x }
        : { ...point, z: 2 * mirror.coordinate - point.z };
}
function overrideMaterials(element, overrides) {
    const replace = (reference) => reference === undefined ? undefined : overrides[reference] ?? reference;
    if (element.kind === "carve")
        return element;
    if (element.kind === "procedural")
        return { ...element, material: replace(element.material) };
    if (element.kind === "basin")
        return {
            ...element,
            wallMaterial: replace(element.wallMaterial),
            floorMaterial: replace(element.floorMaterial),
            rimMaterial: replace(element.rimMaterial),
            liquidMaterial: replace(element.liquidMaterial),
        };
    if (element.kind === "sweep")
        return {
            ...element,
            material: replace(element.material),
            innerMaterial: replace(element.innerMaterial),
            supports: element.supports ? { ...element.supports, material: replace(element.supports.material) } : undefined,
        };
    if (element.kind === "stairs" || element.kind === "ramp")
        return { ...element, material: replace(element.material), railingMaterial: replace(element.railingMaterial) };
    return { ...element, material: replace(element.material) };
}
function materialReferences(element) {
    if (element.kind === "carve")
        return [];
    if (element.kind === "procedural")
        return element.material ? [element.material] : [];
    if (element.kind === "basin")
        return [element.wallMaterial, element.floorMaterial, element.rimMaterial, element.liquidMaterial].filter((value) => Boolean(value));
    if (element.kind === "sweep")
        return [element.material, element.innerMaterial, element.supports?.material].filter((value) => Boolean(value));
    if (element.kind === "stairs" || element.kind === "ramp")
        return [element.material, element.railingMaterial].filter((value) => Boolean(value));
    return [element.material];
}
function withoutMaterialFields(element) {
    const clone = cloneElement(element);
    for (const key of ["material", "wallMaterial", "floorMaterial", "rimMaterial", "liquidMaterial", "innerMaterial", "railingMaterial"])
        delete clone[key];
    if (clone.supports && typeof clone.supports === "object") {
        const supports = { ...clone.supports };
        delete supports.material;
        clone.supports = supports;
    }
    return clone;
}
function uniqueById(values, label) {
    const map = new Map();
    for (const value of values) {
        assertId(value.id, label);
        if (map.has(value.id))
            throw new Error(`DESIGN_${label.toUpperCase()}_ID_DUPLICATE: ${value.id}`);
        map.set(value.id, value);
    }
    return map;
}
function assertId(id, label) {
    if (!ID_PATTERN.test(id))
        throw new Error(`DESIGN_${label.toUpperCase().replace(/ /g, "_")}_ID_INVALID: ${id}`);
}
function assertUniqueReferences(values, label) {
    if (new Set(values).size !== values.length)
        throw new Error(`DESIGN_REFERENCE_DUPLICATE: ${label} contains duplicate IDs.`);
}
function assertBounds(component, dimensions) {
    assertIntegerPoint(component.bounds.min, `${component.id}.bounds.min`);
    assertIntegerPoint(component.bounds.max, `${component.id}.bounds.max`);
    const { min, max } = component.bounds;
    if (min.x > max.x || min.y > max.y || min.z > max.z)
        throw new Error(`DESIGN_COMPONENT_BOUNDS_INVALID: ${component.id} bounds must be normalized.`);
    if (min.x < 0 || min.y < 0 || min.z < 0 || max.x >= dimensions.width || max.y >= dimensions.height || max.z >= dimensions.depth) {
        throw new Error(`DESIGN_COMPONENT_BOUNDS_INVALID: ${component.id} bounds exceed the build dimensions.`);
    }
}
function assertIntegerPoint(point, label) {
    if (![point.x, point.y, point.z].every(Number.isSafeInteger))
        throw new Error(`DESIGN_COORDINATE_INVALID: ${label} must contain integer coordinates.`);
}
function stableStringify(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(",")}]`;
    const record = value;
    return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}
function cloneElement(element) {
    return structuredClone(element);
}
function cloneBounds(bounds) {
    return { min: { ...bounds.min }, max: { ...bounds.max } };
}
function add(left, right) {
    return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}
function scale(point, multiplier) {
    return { x: point.x * multiplier, y: point.y * multiplier, z: point.z * multiplier };
}
//# sourceMappingURL=component-graph.js.map