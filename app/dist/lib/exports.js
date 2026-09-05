import JSZip from "jszip";
import { createHash } from "node:crypto";
import { assertConstructionExportable, BEDROCK_FUNCTION_COMMAND_LIMIT } from "./export-policy.js";
import { createBedrockMcpack } from "./bedrock-structure.js";
import { exportSchematic } from "./schematic.js";
function serializeState(placement, edition) {
    const entries = Object.entries(placement.state ?? {});
    if (!entries.length)
        return "";
    if (edition === "java")
        return `[${entries.map(([key, value]) => `${key}=${String(value)}`).join(",")}]`;
    return ` [${entries.map(([key, value]) => `\"${key}\"=${typeof value === "string" ? `\"${value}\"` : value}`).join(",")}]`;
}
export function toJson(build) {
    return JSON.stringify(build, null, 2);
}
function csvTextCell(value) {
    const neutralized = /^[\t\r]|^\s*[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${neutralized.replaceAll('"', '""')}"`;
}
export function toCsv(build) {
    const rows = ["x,y,z,block,state,phase"];
    for (const p of build.placements) {
        rows.push(`${p.x},${p.y},${p.z},${p.block},${csvTextCell(JSON.stringify(p.state ?? {}))},${csvTextCell(p.phase)}`);
    }
    return rows.join("\n");
}
function renderMcfunction(build, edition) {
    return build.placements.map((p) => `setblock ${p.x} ${p.y} ${p.z} ${p.block}${serializeState(p, edition)} replace`).join("\n");
}
export function toMcfunction(build, edition) {
    assertConstructionExportable(build, edition === "java" ? "java_mcfunction" : "bedrock_mcfunction");
    return renderMcfunction(build, edition);
}
export function chunkMcfunction(build, edition, chunkSize = 8000) {
    if (!Number.isSafeInteger(chunkSize) || chunkSize < 1)
        throw new Error("Command chunk size must be a positive whole number.");
    if (edition === "bedrock" && chunkSize > BEDROCK_FUNCTION_COMMAND_LIMIT)
        throw new Error(`Bedrock command chunks cannot exceed ${BEDROCK_FUNCTION_COMMAND_LIMIT.toLocaleString()} commands.`);
    assertConstructionExportable(build, edition === "java" ? "java_mcfunction" : "bedrock_mcfunction", { allowChunkedBedrock: true });
    const commands = renderMcfunction(build, edition).split("\n");
    const chunks = [];
    for (let i = 0; i < commands.length; i += chunkSize)
        chunks.push(commands.slice(i, i + chunkSize).join("\n"));
    return chunks;
}
export function toBlueprint(build) {
    const lines = [
        `# ${build.input.name}`,
        `# ${build.bounds.dimensions.width}×${build.bounds.dimensions.depth}×${build.bounds.dimensions.height}`,
        "# Cells are space-delimited; . is empty.",
        "",
    ];
    const minY = build.bounds.min.y;
    const maxY = build.bounds.max.y;
    const symbols = new Map();
    Object.keys(build.materialCounts).forEach((block, index) => symbols.set(block, `M${index + 1}`));
    lines.push("Legend:");
    for (const [block, glyph] of symbols)
        lines.push(`${glyph} = ${block}`);
    for (let y = minY; y <= maxY; y += 1) {
        lines.push("", `Layer Y=${y}`);
        const layer = new Map(build.placements.filter((p) => p.y === y).map((p) => [`${p.x},${p.z}`, p]));
        for (let z = build.bounds.min.z; z <= build.bounds.max.z; z += 1) {
            const row = [];
            for (let x = build.bounds.min.x; x <= build.bounds.max.x; x += 1)
                row.push(layer.has(`${x},${z}`) ? symbols.get(layer.get(`${x},${z}`).block) : ".");
            lines.push(row.join(" "));
        }
    }
    return lines.join("\n");
}
const checksum = (content) => createHash("sha256").update(content).digest("hex");
export async function createBundle(build) {
    assertConstructionExportable(build, "bundle");
    const zip = new JSZip();
    const files = {
        "build.json": toJson(build),
        "coordinates.csv": toCsv(build),
        "blueprint.txt": toBlueprint(build),
        ...(build.input.edition === "java" ? { "build-java.mcfunction": toMcfunction(build, "java") } : {}),
    };
    const schematic = build.input.edition === "java" ? exportSchematic(build).bytes : undefined;
    const bedrockPack = build.input.edition === "bedrock" ? await createBedrockMcpack(build) : undefined;
    const manifest = {
        schemaVersion: 2,
        buildId: build.id,
        buildHash: build.hash,
        files: [
            ...Object.entries(files).map(([name, content]) => ({ name, bytes: Buffer.byteLength(content), sha256: checksum(content) })),
            ...(schematic ? [{ name: "build.schem", bytes: schematic.byteLength, sha256: checksum(schematic) }] : []),
            ...(bedrockPack ? [{ name: bedrockPack.fileName, bytes: bedrockPack.bytes.byteLength, sha256: checksum(bedrockPack.bytes) }] : []),
        ],
    };
    for (const [name, content] of Object.entries(files))
        zip.file(name, content);
    if (schematic)
        zip.file("build.schem", schematic);
    if (bedrockPack)
        zip.file(bedrockPack.fileName, bedrockPack.bytes);
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
//# sourceMappingURL=exports.js.map