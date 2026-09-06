export function compileProceduralGeometry(primitive, options = {}) {
    const maximumAttempts = options.maximumAttempts ?? 8_000_000;
    let attempts = 0;
    let collisions = 0;
    const collect = (target) => ({
        add(point) {
            assertIntegerPoint(point, primitive.type);
            attempts += 1;
            if (attempts > maximumAttempts)
                throw new Error(`DESIGN_OPERATION_LIMIT_EXCEEDED: procedural geometry exceeded ${maximumAttempts.toLocaleString()} coordinate candidates.`);
            const key = coordinateKey(point);
            if (target.has(key))
                collisions += 1;
            target.set(key, point);
        },
    });
    const raw = new Map();
    generatePrimitive(primitive, collect(raw));
    const clip = options.clip ? normalizedBox(options.clip.min, options.clip.max) : undefined;
    let selected = [...raw.values()].filter((point) => !clip || inside(point, clip));
    for (const mask of options.masks ?? []) {
        const maskPoints = new Map();
        generatePrimitive(mask.primitive, collect(maskPoints));
        const keys = new Set(maskPoints.keys());
        selected = selected.filter((point) => mask.invert ? !keys.has(coordinateKey(point)) : keys.has(coordinateKey(point)));
    }
    const offset = options.offset ?? { x: 0, y: 0, z: 0 };
    const translated = new Map();
    for (const point of selected) {
        const moved = add(point, offset);
        const key = coordinateKey(moved);
        if (translated.has(key))
            collisions += 1;
        translated.set(key, moved);
    }
    const points = [...translated.values()];
    if (!points.length) {
        const origin = add(primitiveBounds(primitive).min, offset);
        return { points: [], bounds: { min: origin, max: origin }, attempts, collisions };
    }
    const bounds = boundsOf(points);
    const occupied = new Set(points.map(coordinateKey));
    return {
        points: points.map((point) => ({ point, surfaceDirections: exposedDirections(point, occupied) })),
        bounds,
        attempts,
        collisions,
    };
}
export function proceduralPrimitiveBounds(primitive) {
    return primitiveBounds(primitive);
}
export function transformProceduralPrimitive(primitive, translation, mirror) {
    const point = (value) => reflect(add(value, translation), mirror);
    const vector = (value) => mirror?.axis === "x" ? { ...value, x: -value.x } : mirror?.axis === "z" ? { ...value, z: -value.z } : { ...value };
    const box = (min, max) => normalizedBox(point(min), point(max));
    if (primitive.type === "line")
        return { ...primitive, from: point(primitive.from), to: point(primitive.to) };
    if (primitive.type === "plane" || primitive.type === "pyramid" || primitive.type === "rounded_rectangle" || primitive.type === "rounded_square"
        || primitive.type === "roof_plane" || primitive.type === "roof_ridge") {
        const transformed = box(primitive.min, primitive.max);
        if (primitive.type === "roof_plane") {
            const flipsSlope = mirror?.axis === primitive.slopeAxis;
            return { ...primitive, ...transformed, highSide: flipsSlope ? (primitive.highSide === "min" ? "max" : "min") : primitive.highSide };
        }
        if (primitive.type === "roof_ridge") {
            const ridgeOffset = primitive.ridgeOffset === undefined ? undefined
                : mirror?.axis === (primitive.ridgeAxis === "x" ? "z" : "x") ? 2 * mirror.coordinate - (primitive.ridgeOffset + translation[mirror.axis]) : primitive.ridgeOffset + translation[primitive.ridgeAxis === "x" ? "z" : "x"];
            return { ...primitive, ...transformed, ridgeOffset };
        }
        return { ...primitive, ...transformed };
    }
    if (primitive.type === "circle" || primitive.type === "ellipse" || primitive.type === "sphere")
        return { ...primitive, center: point(primitive.center) };
    if (primitive.type === "cone")
        return { ...primitive, baseCenter: point(primitive.baseCenter) };
    if (primitive.type === "polygon")
        return { ...primitive, points: primitive.points.map(point) };
    if (primitive.type === "extrusion")
        return {
            ...primitive,
            origin: point(primitive.origin),
            profile: transformProfile(primitive.profile, mirror),
            offset: vector(primitive.offset),
        };
    if (primitive.type === "profile_extrusion")
        return { ...primitive, profile: transformProfile(primitive.profile, mirror), path: primitive.path.map(point) };
    const transformed = box(primitive.min, primitive.max);
    return {
        ...primitive,
        ...transformed,
        baseY: primitive.baseY + translation.y,
        fillToY: primitive.fillToY === undefined ? undefined : primitive.fillToY + translation.y,
    };
}
function generatePrimitive(primitive, collector) {
    if (primitive.type === "line") {
        for (const point of linePoints(primitive.from, primitive.to))
            addThickPoint(point, primitive.thickness ?? 1, collector);
        return;
    }
    if (primitive.type === "plane") {
        const { min, max } = normalizedBox(primitive.min, primitive.max);
        const flatAxes = axes.filter((axis) => min[axis] === max[axis]);
        if (!flatAxes.length)
            throw new Error("DESIGN_PRIMITIVE_INVALID: plane must be flat on at least one axis.");
        const normal = flatAxes[0];
        const filled = primitive.filled ?? true;
        forEachBox(min, max, (point) => {
            const boundary = axes.some((axis) => axis !== normal && (point[axis] === min[axis] || point[axis] === max[axis]));
            if (filled || boundary)
                collector.add(point);
        });
        return;
    }
    if (primitive.type === "circle" || primitive.type === "ellipse") {
        const radiusU = primitive.type === "circle" ? primitive.radius : primitive.radiusU;
        const radiusV = primitive.type === "circle" ? primitive.radius : primitive.radiusV;
        rasterEllipse(primitive.center, primitive.axis ?? "y", radiusU, radiusV, primitive.filled ?? false, primitive.thickness ?? 1, collector);
        return;
    }
    if (primitive.type === "sphere") {
        const radius = positiveRadius(primitive.radius, "sphere.radius");
        const thickness = positiveThickness(primitive.thickness);
        for (let dx = -radius; dx <= radius; dx += 1)
            for (let dy = -radius; dy <= radius; dy += 1)
                for (let dz = -radius; dz <= radius; dz += 1) {
                    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (distance > radius + 0.25 || (primitive.hollow && distance < Math.max(0, radius - thickness)))
                        continue;
                    collector.add({ x: primitive.center.x + dx, y: primitive.center.y + dy, z: primitive.center.z + dz });
                }
        return;
    }
    if (primitive.type === "cone") {
        const radius = positiveRadius(primitive.radius, "cone.radius");
        const height = positiveInteger(primitive.height, "cone.height");
        const thickness = positiveThickness(primitive.thickness);
        for (let layer = 0; layer < height; layer += 1) {
            const ratio = height === 1 ? 0 : layer / (height - 1);
            const layerRadius = radius * (1 - ratio);
            const y = primitive.baseCenter.y + (primitive.direction === "down" ? -layer : layer);
            for (let dx = -Math.ceil(layerRadius); dx <= Math.ceil(layerRadius); dx += 1)
                for (let dz = -Math.ceil(layerRadius); dz <= Math.ceil(layerRadius); dz += 1) {
                    const distance = Math.hypot(dx, dz);
                    if (distance > layerRadius + 0.25 || (primitive.hollow && distance < Math.max(0, layerRadius - thickness) && layer > 0))
                        continue;
                    collector.add({ x: primitive.baseCenter.x + dx, y, z: primitive.baseCenter.z + dz });
                }
        }
        return;
    }
    if (primitive.type === "pyramid") {
        const { min, max } = normalizedBox(primitive.min, primitive.max);
        const height = max.y - min.y + 1;
        const thickness = positiveThickness(primitive.thickness);
        for (let layer = 0; layer < height; layer += 1) {
            const ratio = height === 1 ? 0 : layer / (height - 1);
            const insetX = Math.floor(((max.x - min.x) / 2) * ratio);
            const insetZ = Math.floor(((max.z - min.z) / 2) * ratio);
            const layerMin = { x: min.x + insetX, y: min.y + layer, z: min.z + insetZ };
            const layerMax = { x: max.x - insetX, y: min.y + layer, z: max.z - insetZ };
            forEachBox(layerMin, layerMax, (point) => {
                const edge = Math.min(point.x - layerMin.x, layerMax.x - point.x, point.z - layerMin.z, layerMax.z - point.z);
                if (!primitive.hollow || edge < thickness || layer === 0 || layer === height - 1)
                    collector.add(point);
            });
        }
        return;
    }
    if (primitive.type === "polygon") {
        generateWorldPolygon(primitive.points, primitive.filled ?? true, collector);
        return;
    }
    if (primitive.type === "rounded_rectangle" || primitive.type === "rounded_square") {
        generateRoundedRectangle(primitive, collector);
        return;
    }
    if (primitive.type === "extrusion") {
        const profile = profilePoints(primitive.profile);
        for (const translation of linePoints({ x: 0, y: 0, z: 0 }, primitive.offset)) {
            for (const offset of profile)
                collector.add(add(primitive.origin, add(offset, translation)));
        }
        return;
    }
    if (primitive.type === "profile_extrusion") {
        if (primitive.path.length < 2)
            throw new Error("DESIGN_PRIMITIVE_INVALID: profile_extrusion needs at least two path points.");
        const profile = profilePoints(primitive.profile);
        for (const pathPoint of polylinePoints(primitive.path))
            for (const offset of profile)
                collector.add(add(pathPoint, offset));
        return;
    }
    if (primitive.type === "roof_plane") {
        generateRoofPlane(primitive, collector);
        return;
    }
    if (primitive.type === "roof_ridge") {
        generateRoofRidge(primitive, collector);
        return;
    }
    generateTerrainSurface(primitive, collector);
}
function rasterEllipse(center, axis, rawRadiusU, rawRadiusV, filled, rawThickness, collector) {
    const radiusU = positiveRadius(rawRadiusU, "ellipse.radiusU");
    const radiusV = positiveRadius(rawRadiusV, "ellipse.radiusV");
    const thickness = positiveThickness(rawThickness);
    for (let u = -radiusU; u <= radiusU; u += 1)
        for (let v = -radiusV; v <= radiusV; v += 1) {
            const outer = (u / radiusU) ** 2 + (v / radiusV) ** 2;
            const innerU = Math.max(0.5, radiusU - thickness);
            const innerV = Math.max(0.5, radiusV - thickness);
            const inner = (u / innerU) ** 2 + (v / innerV) ** 2;
            if (outer > 1.08 || (!filled && radiusU > thickness && radiusV > thickness && inner < 1))
                continue;
            collector.add(fromPlane(center, axis, u, v));
        }
}
function generateWorldPolygon(points, filled, collector) {
    if (points.length < 3)
        throw new Error("DESIGN_PRIMITIVE_INVALID: polygon needs at least three points.");
    points.forEach((point) => assertIntegerPoint(point, "polygon point"));
    const normal = ["y", "x", "z"].find((axis) => points.every((point) => point[axis] === points[0][axis]));
    if (!normal)
        throw new Error("DESIGN_PRIMITIVE_UNSUPPORTED: polygon points must lie on one axis-aligned plane.");
    const [uAxis, vAxis] = planeAxes(normal);
    const polygon = points.map((point) => ({ u: point[uAxis], v: point[vAxis] }));
    const constant = points[0][normal];
    const raster = polygon2dPoints(polygon, filled);
    for (const point of raster)
        collector.add(worldFrom2d(normal, constant, point.u, point.v));
}
function generateRoundedRectangle(primitive, collector) {
    const { min, max } = normalizedBox(primitive.min, primitive.max);
    const normal = axes.find((axis) => min[axis] === max[axis]);
    if (!normal)
        throw new Error(`DESIGN_PRIMITIVE_INVALID: ${primitive.type} must lie on an axis-aligned plane.`);
    const [uAxis, vAxis] = planeAxes(normal);
    const uMin = min[uAxis];
    const uMax = max[uAxis];
    const vMin = min[vAxis];
    const vMax = max[vAxis];
    if (primitive.type === "rounded_square" && uMax - uMin !== vMax - vMin)
        throw new Error("DESIGN_PRIMITIVE_INVALID: rounded_square requires equal side spans.");
    const radius = Math.min(positiveRadius(primitive.radius, `${primitive.type}.radius`), Math.floor(Math.min(uMax - uMin + 1, vMax - vMin + 1) / 2));
    const insideRounded = (u, v) => {
        const nearestU = Math.max(uMin + radius, Math.min(uMax - radius, u));
        const nearestV = Math.max(vMin + radius, Math.min(vMax - radius, v));
        return Math.hypot(u - nearestU, v - nearestV) <= radius + 0.25;
    };
    const all = new Set();
    for (let u = uMin; u <= uMax; u += 1)
        for (let v = vMin; v <= vMax; v += 1)
            if (insideRounded(u, v))
                all.add(`${u},${v}`);
    const thickness = positiveThickness(primitive.thickness);
    for (let u = uMin; u <= uMax; u += 1)
        for (let v = vMin; v <= vMax; v += 1) {
            if (!all.has(`${u},${v}`))
                continue;
            const boundary = Array.from({ length: thickness }, (_, distance) => distance + 1).some((distance) => (!all.has(`${u - distance},${v}`) || !all.has(`${u + distance},${v}`) || !all.has(`${u},${v - distance}`) || !all.has(`${u},${v + distance}`)));
            if ((primitive.filled ?? false) || boundary)
                collector.add(worldFrom2d(normal, min[normal], u, v));
        }
}
function generateRoofPlane(primitive, collector) {
    const { min, max } = normalizedBox(primitive.min, primitive.max);
    const thickness = positiveThickness(primitive.thickness);
    const span = Math.max(1, max[primitive.slopeAxis] - min[primitive.slopeAxis]);
    for (let x = min.x; x <= max.x; x += 1)
        for (let z = min.z; z <= max.z; z += 1) {
            let ratio = ((primitive.slopeAxis === "x" ? x : z) - min[primitive.slopeAxis]) / span;
            if ((primitive.highSide ?? "max") === "min")
                ratio = 1 - ratio;
            const top = Math.round(min.y + ratio * (max.y - min.y));
            for (let layer = 0; layer < thickness && top - layer >= min.y; layer += 1)
                collector.add({ x, y: top - layer, z });
        }
}
function generateRoofRidge(primitive, collector) {
    const { min, max } = normalizedBox(primitive.min, primitive.max);
    const crossAxis = primitive.ridgeAxis === "x" ? "z" : "x";
    const ridge = primitive.ridgeOffset ?? (min[crossAxis] + max[crossAxis]) / 2;
    const leftSpan = Math.max(1, ridge - min[crossAxis]);
    const rightSpan = Math.max(1, max[crossAxis] - ridge);
    const thickness = positiveThickness(primitive.thickness);
    for (let x = min.x; x <= max.x; x += 1)
        for (let z = min.z; z <= max.z; z += 1) {
            const coordinate = crossAxis === "x" ? x : z;
            const ratio = coordinate <= ridge ? (coordinate - min[crossAxis]) / leftSpan : (max[crossAxis] - coordinate) / rightSpan;
            const top = Math.round(min.y + Math.max(0, ratio) * (max.y - min.y));
            for (let layer = 0; layer < thickness && top - layer >= min.y; layer += 1)
                collector.add({ x, y: top - layer, z });
        }
}
function generateTerrainSurface(primitive, collector) {
    if (!primitive.seed.trim() || !Number.isFinite(primitive.scale) || primitive.scale <= 0 || !Number.isFinite(primitive.amplitude)) {
        throw new Error("DESIGN_PRIMITIVE_INVALID: terrain_surface requires a seed, positive scale, and finite amplitude.");
    }
    const { min, max } = normalizedBox(primitive.min, primitive.max);
    for (let x = min.x; x <= max.x; x += 1)
        for (let z = min.z; z <= max.z; z += 1) {
            const height = Math.max(min.y, Math.min(max.y, Math.round(primitive.baseY + (valueNoise2d(x, z, primitive.scale, primitive.seed) * 2 - 1) * primitive.amplitude)));
            const bottom = primitive.fillToY === undefined ? height : Math.min(height, Math.max(min.y, primitive.fillToY));
            for (let y = bottom; y <= height; y += 1)
                collector.add({ x, y, z });
        }
}
function profilePoints(profile) {
    if (profile.points.length < 3)
        throw new Error("DESIGN_PRIMITIVE_INVALID: extrusion profiles need at least three points.");
    for (const point of profile.points)
        if (!Number.isSafeInteger(point.u) || !Number.isSafeInteger(point.v))
            throw new Error("DESIGN_COORDINATE_INVALID: profile points must be integers.");
    return polygon2dPoints(profile.points, profile.filled ?? true).map(({ u, v }) => profile.plane === "xy"
        ? { x: u, y: v, z: 0 }
        : profile.plane === "xz" ? { x: u, y: 0, z: v } : { x: 0, y: u, z: v });
}
function polygon2dPoints(points, filled) {
    const edge = new Map();
    for (let index = 0; index < points.length; index += 1)
        for (const point of line2d(points[index], points[(index + 1) % points.length]))
            edge.set(`${point.u},${point.v}`, point);
    if (!filled)
        return [...edge.values()];
    const minU = Math.min(...points.map(({ u }) => u));
    const maxU = Math.max(...points.map(({ u }) => u));
    const minV = Math.min(...points.map(({ v }) => v));
    const maxV = Math.max(...points.map(({ v }) => v));
    const result = new Map(edge);
    for (let u = minU; u <= maxU; u += 1)
        for (let v = minV; v <= maxV; v += 1) {
            if (pointInPolygon(u, v, points))
                result.set(`${u},${v}`, { u, v });
        }
    return [...result.values()];
}
function pointInPolygon(u, v, polygon) {
    let insidePolygon = false;
    for (let left = 0, right = polygon.length - 1; left < polygon.length; right = left++) {
        const a = polygon[left];
        const b = polygon[right];
        if ((a.v > v) !== (b.v > v) && u < ((b.u - a.u) * (v - a.v)) / (b.v - a.v) + a.u)
            insidePolygon = !insidePolygon;
    }
    return insidePolygon;
}
function line2d(from, to) {
    const points = [];
    const du = to.u - from.u;
    const dv = to.v - from.v;
    const steps = Math.max(Math.abs(du), Math.abs(dv), 1);
    for (let step = 0; step <= steps; step += 1)
        points.push({ u: Math.round(from.u + du * step / steps), v: Math.round(from.v + dv * step / steps) });
    return points;
}
function linePoints(from, to) {
    assertIntegerPoint(from, "line.from");
    assertIntegerPoint(to, "line.to");
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz), 1);
    const points = new Map();
    for (let step = 0; step <= steps; step += 1) {
        const point = { x: Math.round(from.x + dx * step / steps), y: Math.round(from.y + dy * step / steps), z: Math.round(from.z + dz * step / steps) };
        points.set(coordinateKey(point), point);
    }
    return [...points.values()];
}
function polylinePoints(points) {
    const result = new Map();
    for (let index = 0; index < points.length - 1; index += 1)
        for (const point of linePoints(points[index], points[index + 1]))
            result.set(coordinateKey(point), point);
    return [...result.values()];
}
function addThickPoint(point, thickness, collector) {
    const size = positiveThickness(thickness);
    const low = -Math.floor((size - 1) / 2);
    const high = Math.ceil((size - 1) / 2);
    for (let dx = low; dx <= high; dx += 1)
        for (let dy = low; dy <= high; dy += 1)
            for (let dz = low; dz <= high; dz += 1)
                collector.add({ x: point.x + dx, y: point.y + dy, z: point.z + dz });
}
function fromPlane(center, axis, u, v) {
    return axis === "x" ? { x: center.x, y: center.y + u, z: center.z + v }
        : axis === "y" ? { x: center.x + u, y: center.y, z: center.z + v }
            : { x: center.x + u, y: center.y + v, z: center.z };
}
function planeAxes(normal) {
    return normal === "x" ? ["y", "z"] : normal === "y" ? ["x", "z"] : ["x", "y"];
}
function worldFrom2d(normal, constant, u, v) {
    return normal === "x" ? { x: constant, y: u, z: v } : normal === "y" ? { x: u, y: constant, z: v } : { x: u, y: v, z: constant };
}
function primitiveBounds(primitive) {
    if (primitive.type === "line") {
        const radius = Math.ceil((positiveThickness(primitive.thickness) - 1) / 2);
        const box = normalizedBox(primitive.from, primitive.to);
        return { min: { x: box.min.x - radius, y: box.min.y - radius, z: box.min.z - radius }, max: { x: box.max.x + radius, y: box.max.y + radius, z: box.max.z + radius } };
    }
    if (primitive.type === "plane" || primitive.type === "pyramid" || primitive.type === "rounded_rectangle" || primitive.type === "rounded_square"
        || primitive.type === "roof_plane" || primitive.type === "roof_ridge" || primitive.type === "terrain_surface")
        return normalizedBox(primitive.min, primitive.max);
    if (primitive.type === "circle" || primitive.type === "ellipse") {
        const u = primitive.type === "circle" ? primitive.radius : primitive.radiusU;
        const v = primitive.type === "circle" ? primitive.radius : primitive.radiusV;
        const axis = primitive.axis ?? "y";
        const extents = axis === "x" ? { x: 0, y: u, z: v } : axis === "y" ? { x: u, y: 0, z: v } : { x: u, y: v, z: 0 };
        return { min: { x: primitive.center.x - extents.x, y: primitive.center.y - extents.y, z: primitive.center.z - extents.z }, max: { x: primitive.center.x + extents.x, y: primitive.center.y + extents.y, z: primitive.center.z + extents.z } };
    }
    if (primitive.type === "sphere")
        return { min: { x: primitive.center.x - primitive.radius, y: primitive.center.y - primitive.radius, z: primitive.center.z - primitive.radius }, max: { x: primitive.center.x + primitive.radius, y: primitive.center.y + primitive.radius, z: primitive.center.z + primitive.radius } };
    if (primitive.type === "cone") {
        const otherY = primitive.baseCenter.y + (primitive.direction === "down" ? -(primitive.height - 1) : primitive.height - 1);
        return { min: { x: primitive.baseCenter.x - primitive.radius, y: Math.min(primitive.baseCenter.y, otherY), z: primitive.baseCenter.z - primitive.radius }, max: { x: primitive.baseCenter.x + primitive.radius, y: Math.max(primitive.baseCenter.y, otherY), z: primitive.baseCenter.z + primitive.radius } };
    }
    if (primitive.type === "polygon")
        return boundsOf(primitive.points);
    if (primitive.type === "extrusion") {
        const points = primitive.profile.points.map(({ u, v }) => add(primitive.origin, profileVector(primitive.profile.plane, u, v)));
        return boundsOf([...points, ...points.map((point) => add(point, primitive.offset))]);
    }
    const profile = primitive.profile.points.map(({ u, v }) => profileVector(primitive.profile.plane, u, v));
    return boundsOf(primitive.path.flatMap((point) => profile.map((offset) => add(point, offset))));
}
function profileVector(plane, u, v) {
    return plane === "xy" ? { x: u, y: v, z: 0 } : plane === "xz" ? { x: u, y: 0, z: v } : { x: 0, y: u, z: v };
}
function transformProfile(profile, mirror) {
    if (!mirror)
        return structuredClone(profile);
    return {
        ...profile,
        points: profile.points.map(({ u, v }) => {
            if ((profile.plane === "xy" || profile.plane === "xz") && mirror.axis === "x")
                return { u: -u, v };
            if (profile.plane === "xz" && mirror.axis === "z")
                return { u, v: -v };
            if (profile.plane === "yz" && mirror.axis === "z")
                return { u, v: -v };
            return { u, v };
        }),
    };
}
function exposedDirections(point, occupied) {
    const directions = [
        ["west", { x: -1, y: 0, z: 0 }], ["east", { x: 1, y: 0, z: 0 }],
        ["down", { x: 0, y: -1, z: 0 }], ["up", { x: 0, y: 1, z: 0 }],
        ["north", { x: 0, y: 0, z: -1 }], ["south", { x: 0, y: 0, z: 1 }],
    ];
    return directions.filter(([, delta]) => !occupied.has(coordinateKey(add(point, delta)))).map(([direction]) => direction);
}
function valueNoise2d(x, z, scale, seed) {
    const sx = x / scale;
    const sz = z / scale;
    const x0 = Math.floor(sx);
    const z0 = Math.floor(sz);
    const tx = smooth(sx - x0);
    const tz = smooth(sz - z0);
    const sample = (dx, dz) => hashUnit(`${seed}:${x0 + dx},${z0 + dz}`);
    return lerp(lerp(sample(0, 0), sample(1, 0), tx), lerp(sample(0, 1), sample(1, 1), tx), tz);
}
function boundsOf(points) {
    if (!points.length)
        throw new Error("DESIGN_PRIMITIVE_INVALID: geometry must contain at least one point.");
    const min = { ...points[0] };
    const max = { ...points[0] };
    for (const point of points.slice(1))
        for (const axis of axes) {
            min[axis] = Math.min(min[axis], point[axis]);
            max[axis] = Math.max(max[axis], point[axis]);
        }
    return { min, max };
}
function normalizedBox(left, right) {
    return { min: { x: Math.min(left.x, right.x), y: Math.min(left.y, right.y), z: Math.min(left.z, right.z) }, max: { x: Math.max(left.x, right.x), y: Math.max(left.y, right.y), z: Math.max(left.z, right.z) } };
}
function forEachBox(min, max, visit) {
    for (let x = min.x; x <= max.x; x += 1)
        for (let y = min.y; y <= max.y; y += 1)
            for (let z = min.z; z <= max.z; z += 1)
                visit({ x, y, z });
}
function linearlyContained(value, min, max) {
    return value >= min && value <= max;
}
function inside(point, bounds) {
    return linearlyContained(point.x, bounds.min.x, bounds.max.x) && linearlyContained(point.y, bounds.min.y, bounds.max.y) && linearlyContained(point.z, bounds.min.z, bounds.max.z);
}
function reflect(point, mirror) {
    if (!mirror)
        return point;
    return mirror.axis === "x" ? { ...point, x: 2 * mirror.coordinate - point.x } : { ...point, z: 2 * mirror.coordinate - point.z };
}
function add(left, right) {
    return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}
function coordinateKey({ x, y, z }) {
    return `${x},${y},${z}`;
}
function assertIntegerPoint(point, label) {
    if (![point.x, point.y, point.z].every(Number.isSafeInteger))
        throw new Error(`DESIGN_COORDINATE_INVALID: ${label} must contain integer coordinates.`);
}
function positiveRadius(value, label) {
    if (!Number.isFinite(value) || value <= 0)
        throw new Error(`DESIGN_PRIMITIVE_INVALID: ${label} must be positive.`);
    return Math.max(1, Math.round(value));
}
function positiveInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 1)
        throw new Error(`DESIGN_PRIMITIVE_INVALID: ${label} must be a positive integer.`);
    return value;
}
function positiveThickness(value) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0))
        throw new Error("DESIGN_PRIMITIVE_INVALID: thickness must be positive.");
    return Math.max(1, Math.round(value ?? 1));
}
function hashUnit(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0) / 0x1_0000_0000;
}
function smooth(value) { return value * value * (3 - 2 * value); }
function lerp(left, right, amount) { return left + (right - left) * amount; }
const axes = ["x", "y", "z"];
//# sourceMappingURL=procedural-geometry.js.map