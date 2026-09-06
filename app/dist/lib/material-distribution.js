export function resolveProceduralMaterial(reference, sources, context, allowDistributions) {
    return resolveReference(reference, sources, context, allowDistributions, []);
}
export function materialDependencyPayload(reference, sources) {
    return expandReference(reference, sources, []);
}
export function collectProceduralMaterialLeaves(materials, materialLibrary, rolePalette) {
    const sources = { materials, materialLibrary, rolePalette };
    return Object.keys(materials).sort().flatMap((name) => collectDefinitionLeaves(materials[name], sources, [`materials.${name}`], [name]));
}
function resolveReference(reference, sources, context, allowDistributions, stack) {
    if (stack.includes(reference))
        throw new Error(`DESIGN_MATERIAL_REFERENCE_CYCLE: ${[...stack, reference].join(" -> ")}.`);
    const definition = sources.materials?.[reference] ?? sources.materialLibrary?.[reference]
        ?? (reference in sources.rolePalette ? sources.rolePalette[reference] : reference);
    return resolveDefinition(definition, sources, context, allowDistributions, [...stack, reference], reference);
}
function resolveDefinition(definition, sources, context, allowDistributions, stack, label) {
    if (typeof definition === "string") {
        if (sources.materials?.[definition] !== undefined || sources.materialLibrary?.[definition] !== undefined || definition in sources.rolePalette) {
            return resolveReference(definition, sources, context, allowDistributions, stack);
        }
        return { block: definition };
    }
    if ("block" in definition)
        return exactMaterial(definition);
    if (!allowDistributions)
        throw new Error(`DESIGN_MATERIAL_DISTRIBUTION_REQUIRES_V2: ${label} uses ${definition.distribution}.`);
    validateDistribution(definition, label);
    if (definition.distribution === "weighted_random") {
        return resolveTarget(weightedTarget(definition.blocks, randomAt(definition.seed, context, "random")), sources, context, allowDistributions, stack);
    }
    if (definition.distribution === "weighted_noise") {
        const noise = valueNoise3d(context.coordinate, definition.scale, `${context.componentSeed}:${definition.seed}`);
        return resolveTarget(weightedTarget(definition.blocks, noise), sources, context, allowDistributions, stack);
    }
    if (definition.distribution === "clustered_noise") {
        const cell = {
            x: Math.floor(context.coordinate.x / definition.scale),
            y: Math.floor(context.coordinate.y / definition.scale),
            z: Math.floor(context.coordinate.z / definition.scale),
        };
        const value = hashUnit(`${context.componentSeed}:${definition.seed}:cluster:${cell.x},${cell.y},${cell.z}`);
        return resolveTarget(weightedTarget(definition.blocks, value), sources, context, allowDistributions, stack);
    }
    if (definition.distribution === "gradient") {
        const axis = definition.axis;
        const span = Math.max(1, context.bounds.max[axis] - context.bounds.min[axis]);
        const position = (context.coordinate[axis] - context.bounds.min[axis]) / span;
        const stops = [...definition.stops].sort((left, right) => left.at - right.at);
        let selected = stops[0].material;
        for (const stop of stops)
            if (position >= stop.at)
                selected = stop.material;
        return resolveTarget(selected, sources, context, allowDistributions, stack);
    }
    if (definition.distribution === "checker") {
        const { x, y, z } = context.coordinate;
        const index = positiveModulo(Math.floor(x / definition.size.x) + Math.floor(y / definition.size.y) + Math.floor(z / definition.size.z), definition.materials.length);
        return resolveTarget(definition.materials[index], sources, context, allowDistributions, stack);
    }
    if (definition.distribution === "pattern") {
        const stride = Math.round(definition.stride ?? 1);
        const index = positiveModulo(Math.floor(context.coordinate[definition.axis] / stride), definition.materials.length);
        return resolveTarget(definition.materials[index], sources, context, allowDistributions, stack);
    }
    let probability = definition.amount;
    if (definition.edge) {
        const exposedAxes = exposedAxisCount(context.surfaceDirections ?? []);
        if (exposedAxes >= (definition.edge.exposedAxesAtLeast ?? 2))
            probability += definition.edge.weight;
    }
    if (definition.height) {
        const aboveMinimum = definition.height.minY === undefined || context.coordinate.y >= definition.height.minY;
        const belowMaximum = definition.height.maxY === undefined || context.coordinate.y <= definition.height.maxY;
        if (aboveMinimum && belowMaximum)
            probability += definition.height.weight;
    }
    if (definition.surfaceDirection && definition.surfaceDirection.directions.some((direction) => context.surfaceDirections?.includes(direction))) {
        probability += definition.surfaceDirection.weight;
    }
    const target = randomAt(definition.seed, context, "weather") < clamp01(probability) ? definition.weathered : definition.base;
    return resolveTarget(target, sources, context, allowDistributions, stack);
}
function resolveTarget(target, sources, context, allowDistributions, stack) {
    if (typeof target === "string")
        return resolveReference(target, sources, context, allowDistributions, stack);
    if ("material" in target)
        return resolveReference(target.material, sources, context, allowDistributions, stack);
    return exactMaterial({ block: target.id, state: target.state, tags: target.tags });
}
function exactMaterial(material) {
    return {
        block: material.block,
        ...(material.state ? { state: { ...material.state } } : {}),
        ...(material.tags ? { tags: [...material.tags] } : {}),
    };
}
function weightedTarget(blocks, unit) {
    const total = blocks.reduce((sum, block) => sum + block.weight, 0);
    let cursor = unit * total;
    for (const block of blocks) {
        cursor -= block.weight;
        if (cursor < 0)
            return block;
    }
    return blocks.at(-1);
}
function validateDistribution(definition, label) {
    const invalid = (message) => { throw new Error(`DESIGN_MATERIAL_DISTRIBUTION_INVALID: ${label} ${message}`); };
    if ("seed" in definition && !definition.seed.trim())
        invalid("requires a non-empty seed.");
    if (definition.distribution === "weighted_random" || definition.distribution === "weighted_noise" || definition.distribution === "clustered_noise") {
        if (!definition.blocks.length || definition.blocks.some(({ weight }) => !Number.isFinite(weight) || weight <= 0))
            invalid("requires blocks with positive finite weights.");
    }
    if ((definition.distribution === "weighted_noise" || definition.distribution === "clustered_noise") && (!Number.isFinite(definition.scale) || definition.scale <= 0))
        invalid("requires a positive finite scale.");
    if (definition.distribution === "gradient") {
        if (!definition.stops.length || definition.stops.some(({ at }) => !Number.isFinite(at) || at < 0 || at > 1))
            invalid("requires stops in the inclusive 0..1 range.");
    }
    if (definition.distribution === "checker") {
        if (definition.materials.length < 2 || ![definition.size.x, definition.size.y, definition.size.z].every((value) => Number.isSafeInteger(value) && value > 0))
            invalid("requires at least two materials and positive integer cell sizes.");
    }
    if (definition.distribution === "pattern") {
        if (!definition.materials.length || !Number.isSafeInteger(definition.stride ?? 1) || (definition.stride ?? 1) < 1)
            invalid("requires materials and a positive integer stride.");
    }
    if (definition.distribution === "weathering") {
        if (!Number.isFinite(definition.amount) || definition.amount < 0 || definition.amount > 1)
            invalid("amount must be in the inclusive 0..1 range.");
        for (const weight of [definition.edge?.weight, definition.height?.weight, definition.surfaceDirection?.weight].filter((value) => value !== undefined)) {
            if (!Number.isFinite(weight) || weight < -1 || weight > 1)
                invalid("bias weights must be finite values from -1 through 1.");
        }
        if (definition.height?.minY !== undefined && !Number.isSafeInteger(definition.height.minY))
            invalid("height.minY must be an integer.");
        if (definition.height?.maxY !== undefined && !Number.isSafeInteger(definition.height.maxY))
            invalid("height.maxY must be an integer.");
        if (definition.height?.minY !== undefined && definition.height?.maxY !== undefined && definition.height.minY > definition.height.maxY)
            invalid("height bounds must be normalized.");
        if (definition.surfaceDirection && (!definition.surfaceDirection.directions.length || new Set(definition.surfaceDirection.directions).size !== definition.surfaceDirection.directions.length))
            invalid("surface directions must be non-empty and unique.");
    }
}
function expandReference(reference, sources, stack) {
    if (stack.includes(reference))
        throw new Error(`DESIGN_MATERIAL_REFERENCE_CYCLE: ${[...stack, reference].join(" -> ")}.`);
    const definition = sources.materials?.[reference] ?? sources.materialLibrary?.[reference]
        ?? (reference in sources.rolePalette ? sources.rolePalette[reference] : reference);
    return { reference, definition: expandDefinition(definition, sources, [...stack, reference]) };
}
function expandDefinition(definition, sources, stack) {
    if (typeof definition === "string") {
        return sources.materials?.[definition] !== undefined || sources.materialLibrary?.[definition] !== undefined || definition in sources.rolePalette
            ? expandReference(definition, sources, stack)
            : definition;
    }
    if ("block" in definition)
        return definition;
    if ("blocks" in definition)
        return {
            ...definition,
            blocks: definition.blocks.map((target) => "material" in target
                ? { weight: target.weight, target: expandReference(target.material, sources, stack) }
                : target),
        };
    if (definition.distribution === "gradient")
        return {
            ...definition,
            stops: definition.stops.map((stop) => ({ ...stop, material: expandTarget(stop.material, sources, stack) })),
        };
    if (definition.distribution === "checker" || definition.distribution === "pattern")
        return {
            ...definition,
            materials: definition.materials.map((target) => expandTarget(target, sources, stack)),
        };
    return { ...definition, base: expandTarget(definition.base, sources, stack), weathered: expandTarget(definition.weathered, sources, stack) };
}
function expandTarget(target, sources, stack) {
    return typeof target === "string" ? expandReference(target, sources, stack) : target;
}
function collectDefinitionLeaves(definition, sources, path, stack) {
    if (typeof definition === "string") {
        const nested = sources.materials?.[definition] ?? sources.materialLibrary?.[definition]
            ?? (definition in sources.rolePalette ? sources.rolePalette[definition] : undefined);
        if (nested !== undefined) {
            if (stack.includes(definition))
                throw new Error(`DESIGN_MATERIAL_REFERENCE_CYCLE: ${[...stack, definition].join(" -> ")}.`);
            return collectDefinitionLeaves(nested, sources, path, [...stack, definition]);
        }
        return [{ name: path.join("."), block: definition }];
    }
    if ("block" in definition)
        return [{ name: path.join("."), block: definition.block, state: definition.state }];
    validateDistribution(definition, path.join("."));
    if ("blocks" in definition)
        return definition.blocks.flatMap((target, index) => {
            if ("material" in target)
                return collectTargetLeaves(target.material, sources, [...path, `blocks[${index}]`], stack);
            return [{ name: [...path, `blocks[${index}]`].join("."), block: target.id, state: target.state }];
        });
    if (definition.distribution === "gradient")
        return definition.stops.flatMap((stop, index) => collectTargetLeaves(stop.material, sources, [...path, `stops[${index}]`], stack));
    if (definition.distribution === "checker" || definition.distribution === "pattern")
        return definition.materials.flatMap((target, index) => collectTargetLeaves(target, sources, [...path, `materials[${index}]`], stack));
    return [
        ...collectTargetLeaves(definition.base, sources, [...path, "base"], stack),
        ...collectTargetLeaves(definition.weathered, sources, [...path, "weathered"], stack),
    ];
}
function collectTargetLeaves(target, sources, path, stack) {
    if (typeof target !== "string")
        return [{ name: path.join("."), block: target.id, state: target.state }];
    if (stack.includes(target))
        throw new Error(`DESIGN_MATERIAL_REFERENCE_CYCLE: ${[...stack, target].join(" -> ")}.`);
    const nested = sources.materials?.[target] ?? sources.materialLibrary?.[target]
        ?? (target in sources.rolePalette ? sources.rolePalette[target] : target);
    return collectDefinitionLeaves(nested, sources, path, [...stack, target]);
}
function randomAt(seed, context, salt) {
    const { x, y, z } = context.coordinate;
    return hashUnit(`${context.componentSeed}:${seed}:${salt}:${x},${y},${z}`);
}
function valueNoise3d(point, scale, seed) {
    const x = point.x / scale;
    const y = point.y / scale;
    const z = point.z / scale;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    const tx = smooth(x - x0);
    const ty = smooth(y - y0);
    const tz = smooth(z - z0);
    const sample = (dx, dy, dz) => hashUnit(`${seed}:${x0 + dx},${y0 + dy},${z0 + dz}`);
    const x00 = lerp(sample(0, 0, 0), sample(1, 0, 0), tx);
    const x10 = lerp(sample(0, 1, 0), sample(1, 1, 0), tx);
    const x01 = lerp(sample(0, 0, 1), sample(1, 0, 1), tx);
    const x11 = lerp(sample(0, 1, 1), sample(1, 1, 1), tx);
    return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz);
}
function hashUnit(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0) / 0x1_0000_0000;
}
function exposedAxisCount(directions) {
    let axes = 0;
    if (directions.some((direction) => direction === "east" || direction === "west"))
        axes += 1;
    if (directions.some((direction) => direction === "up" || direction === "down"))
        axes += 1;
    if (directions.some((direction) => direction === "north" || direction === "south"))
        axes += 1;
    return axes;
}
function positiveModulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
}
function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}
function smooth(value) {
    return value * value * (3 - 2 * value);
}
function lerp(left, right, amount) {
    return left + (right - left) * amount;
}
//# sourceMappingURL=material-distribution.js.map