import { createHash } from "node:crypto";
import JSZip from "jszip";
import { optimizedBedrockCommands } from "./exports.js";
function safeToken(value, fallback) {
    return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 28) || fallback;
}
function uuidFrom(value) {
    const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
    hex[12] = "5";
    hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16], 16) % 4];
    const joined = hex.join("");
    return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}
function tickingAreas(build, namespace) {
    const chunkMinX = Math.floor(build.bounds.min.x / 16);
    const chunkMaxX = Math.floor(build.bounds.max.x / 16);
    const chunkMinZ = Math.floor(build.bounds.min.z / 16);
    const chunkMaxZ = Math.floor(build.bounds.max.z / 16);
    const areas = [];
    for (let chunkZ = chunkMinZ; chunkZ <= chunkMaxZ; chunkZ += 8)
        for (let chunkX = chunkMinX; chunkX <= chunkMaxX; chunkX += 8) {
            const index = areas.length + 1;
            areas.push({
                name: `${namespace.slice(0, 10)}_${String(index).padStart(2, "0")}`,
                minX: chunkX * 16,
                minZ: chunkZ * 16,
                maxX: Math.min(chunkMaxX, chunkX + 7) * 16 + 15,
                maxZ: Math.min(chunkMaxZ, chunkZ + 7) * 16 + 15,
            });
        }
    if (areas.length > 10)
        throw new Error("BEDROCK_MCPACK_TICKINGAREA_LIMIT_EXCEEDED: split this build into at most ten 8x8-chunk mobile phases.");
    return areas;
}
export async function createBedrockMcpack(build, commandsPerTick = 32) {
    if (build.input.edition !== "bedrock")
        throw new Error("BEDROCK_MCPACK_REQUIRES_BEDROCK_BUILD");
    if (!build.validation.valid || build.contract.status !== "valid" || build.certificate.status !== "valid") {
        throw new Error("BUILD_NOT_DELIVERABLE: Bedrock .mcpack export requires a valid hash-bound build contract and certificate.");
    }
    const boundedCommandsPerTick = Math.max(32, Math.min(512, Math.round(commandsPerTick)));
    const namespace = `${safeToken(build.input.name, "blockwright")}_${build.hash.slice(0, 6)}`;
    const objective = `bw_${build.hash.slice(0, 8)}`;
    const commands = optimizedBedrockCommands(build);
    const chunks = [];
    for (let index = 0; index < commands.length; index += boundedCommandsPerTick)
        chunks.push(commands.slice(index, index + boundedCommandsPerTick));
    const areas = tickingAreas(build, namespace);
    const inventory = {
        schemaVersion: 1,
        blockwrightVersion: "0.7.0",
        buildId: build.id,
        buildHash: build.hash,
        placementCount: build.placements.length,
        commandCount: commands.length,
        commandReduction: Number((1 - commands.length / Math.max(1, build.placements.length)).toFixed(6)),
        commandsPerTick: boundedCommandsPerTick,
        estimatedMaximumBlockChangesPerTick: boundedCommandsPerTick * 64,
        parts: chunks.length,
        tickingAreas: areas.length,
        bounds: build.bounds,
        materialCounts: build.materialCounts,
        contractStatus: build.contract.status,
    };
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({
        format_version: 2,
        header: {
            name: build.input.name,
            description: `Verified Blockwright ${inventory.blockwrightVersion} Bedrock build ${build.id}; ${build.placements.length} exact placements.`,
            uuid: uuidFrom(`${build.hash}:header`),
            version: [0, 7, 0],
            min_engine_version: [1, 21, 0],
        },
        modules: [{ type: "data", uuid: uuidFrom(`${build.hash}:module`), version: [0, 7, 0] }],
    }, null, 2));
    zip.file("functions/tick.json", JSON.stringify({ values: [`${namespace}/controller`] }, null, 2));
    zip.file(`functions/${namespace}/load_site.mcfunction`, [
        ...areas.flatMap((area) => [
            `tickingarea remove ${area.name}`,
            `tickingarea add ${area.minX} ${build.bounds.min.y} ${area.minZ} ${area.maxX} ${build.bounds.max.y} ${area.maxZ} ${area.name} true`,
        ]),
        `tellraw @s {"rawtext":[{"text":"${build.input.name}: ${areas.length} build area(s) are preloading. Wait 10 seconds, then run /function ${namespace}/install."}]}`,
    ].join("\n"));
    zip.file(`functions/${namespace}/install.mcfunction`, [
        `scoreboard objectives add ${objective} dummy`,
        `scoreboard players set #build ${objective} 1`,
        `tellraw @s {"rawtext":[{"text":"${build.input.name} installation started: ${chunks.length} mobile-safe part(s), at most ${boundedCommandsPerTick} commands per tick."}]}`,
    ].join("\n"));
    const controllerPageSize = 32;
    const controllerPages = Math.ceil(chunks.length / controllerPageSize);
    zip.file(`functions/${namespace}/controller.mcfunction`, Array.from({ length: controllerPages }, (_, index) => {
        const start = index * controllerPageSize + 1;
        const end = Math.min(chunks.length, start + controllerPageSize - 1);
        return `execute if score #build ${objective} matches ${start}..${end} run function ${namespace}/controller_${String(index + 1).padStart(2, "0")}`;
    }).join("\n"));
    for (let page = 0; page < controllerPages; page += 1) {
        const start = page * controllerPageSize + 1;
        const end = Math.min(chunks.length, start + controllerPageSize - 1);
        zip.file(`functions/${namespace}/controller_${String(page + 1).padStart(2, "0")}.mcfunction`, Array.from({ length: end - start + 1 }, (_, index) => {
            const stage = end - index;
            return `execute if score #build ${objective} matches ${stage} run function ${namespace}/part_${String(stage).padStart(3, "0")}`;
        }).join("\n"));
    }
    chunks.forEach((chunk, index) => {
        const stage = index + 1;
        const final = stage === chunks.length;
        zip.file(`functions/${namespace}/part_${String(stage).padStart(3, "0")}.mcfunction`, [
            ...chunk,
            final ? `scoreboard players set #build ${objective} 0` : `scoreboard players add #build ${objective} 1`,
            ...(final ? [`tellraw @a {"rawtext":[{"text":"${build.input.name} installation complete. Run /function ${namespace}/cleanup to release ticking areas."}]}`] : []),
        ].join("\n"));
    });
    zip.file(`functions/${namespace}/cancel.mcfunction`, `scoreboard players set #build ${objective} 0\ntellraw @s {"rawtext":[{"text":"${build.input.name} installation paused."}]}`);
    zip.file(`functions/${namespace}/cleanup.mcfunction`, areas.map((area) => `tickingarea remove ${area.name}`).join("\n"));
    zip.file("blockwright-inventory.json", JSON.stringify(inventory, null, 2));
    zip.file("README.txt", [
        `${build.input.name.toUpperCase()} — VERIFIED BEDROCK/IPHONE PACK`,
        "",
        `Build: ${build.id}`,
        `SHA-256: ${build.hash}`,
        `Contract: ${build.contract.status.toUpperCase()}`,
        `Bounds: X ${build.bounds.min.x}..${build.bounds.max.x}, Y ${build.bounds.min.y}..${build.bounds.max.y}, Z ${build.bounds.min.z}..${build.bounds.max.z}`,
        `Placements: ${build.placements.length}; optimized commands: ${commands.length}; commands/tick: ${boundedCommandsPerTick}; maximum block changes/tick: ${inventory.estimatedMaximumBlockChangesPerTick}`,
        "",
        "Use a disposable or backed-up world with Cheats enabled and the target area clear.",
        "1. Import this .mcpack into Minecraft and activate its Behavior Pack on the world.",
        `2. Run /function ${namespace}/load_site and wait 10 seconds.`,
        `3. Run /function ${namespace}/install and remain in the world until completion.`,
        `4. Run /function ${namespace}/cleanup after the completion message.`,
        `Pause: /function ${namespace}/cancel    Restart: /function ${namespace}/install`,
    ].join("\n"));
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
    return { bytes, inventory, namespace };
}
//# sourceMappingURL=bedrock-pack.js.map