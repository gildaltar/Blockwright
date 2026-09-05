import { createHash } from "node:crypto";
import JSZip from "jszip";
import { exportLitematic, LITEMATIC_COMPATIBILITY } from "./litematic.js";
import { exportSchematic } from "./schematic.js";
function canonicalState(placement) {
    const entries = Object.entries(placement.state ?? {}).sort(([left], [right]) => left.localeCompare(right));
    return entries.length
        ? `${placement.block}[${entries.map(([key, value]) => `${key}=${String(value)}`).join(",")}]`
        : placement.block;
}
function estimateContainers(count) {
    const estimatedStacks = Math.ceil(count / 64);
    return { estimatedStacks, estimatedShulkerBoxes: Math.ceil(estimatedStacks / 27) };
}
export function createMaterialList(build, options = {}) {
    const exactCounts = new Map();
    const baseCounts = new Map();
    for (const placement of build.placements) {
        if (!options.includeAir && placement.block === "minecraft:air")
            continue;
        const state = canonicalState(placement);
        const exact = exactCounts.get(state) ?? { baseBlock: placement.block, count: 0 };
        exact.count += 1;
        exactCounts.set(state, exact);
        baseCounts.set(placement.block, (baseCounts.get(placement.block) ?? 0) + 1);
    }
    const lines = [...exactCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([canonicalBlockState, value]) => ({ canonicalBlockState, ...value, ...estimateContainers(value.count) }));
    const baseBlockTotals = [...baseCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([baseBlock, count]) => ({ baseBlock, count, ...estimateContainers(count) }));
    const estimatedStacks = baseBlockTotals.reduce((total, row) => total + row.estimatedStacks, 0);
    return {
        schemaVersion: 1,
        buildHash: build.hash,
        exact: true,
        totalBlocks: lines.reduce((total, row) => total + row.count, 0),
        uniqueBlockStates: lines.length,
        lines,
        baseBlockTotals,
        planningAid: {
            estimatedStacks,
            estimatedShulkerBoxes: Math.ceil(estimatedStacks / 27),
            assumptions: [
                "Stack estimates assume every block item stacks to 64; actual Minecraft stack limits may be lower.",
                "Shulker estimates use 27 slots and round each base material up to whole stacks.",
                "Exact counts describe canonical placed blocks, not crafting recipes or consumed inventory; multi-block constructs may use fewer items.",
                "Counts exclude transport, scaffolding, tools, fuel, breakage, and temporary construction blocks.",
            ],
        },
    };
}
function checksum(content) {
    return createHash("sha256").update(content).digest("hex");
}
function assertHashBound(document, expected, label) {
    if (document.buildHash !== expected)
        throw new Error(`${label} is bound to a different build hash.`);
}
function json(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}
function defaultCompatibility(build, format) {
    if (format === "litematic") {
        return {
            format,
            verificationStatus: "unverified",
            minecraftEdition: "java",
            minecraftVersion: build.input.version,
            notes: [LITEMATIC_COMPATIBILITY.note],
        };
    }
    return {
        format,
        verificationStatus: "unverified",
        minecraftEdition: "java",
        minecraftVersion: build.input.version,
        notes: ["Generated as Sponge Schematic v3; compatibility must be verified against the declared WorldEdit/runtime combination before delivery."],
    };
}
function validateCompatibility(build, format, supplied) {
    const compatibility = supplied ?? defaultCompatibility(build, format);
    if (compatibility.format !== format || compatibility.minecraftEdition !== "java" || compatibility.minecraftVersion !== build.input.version) {
        throw new Error("Compatibility metadata does not match the selected artifact and build target.");
    }
    if (format === "litematic" && compatibility.verificationStatus !== "unverified") {
        throw new Error("Litematic compatibility cannot be labeled verified until an external Litematica interoperability run is recorded.");
    }
    if (compatibility.verificationStatus === "verified" && !(compatibility.testedWith?.length)) {
        throw new Error("Verified compatibility requires at least one exact tested runtime declaration.");
    }
    if (!compatibility.notes.length || compatibility.notes.some((note) => !note.trim()))
        throw new Error("Compatibility metadata requires at least one non-empty limitation or verification note.");
    return compatibility;
}
export async function createDeliveryBundle(input) {
    const { build, format } = input;
    if (build.input.edition !== "java")
        throw new Error("Professional Java delivery bundles require a Java Edition build.");
    assertHashBound(input.contract, build.hash, "Build contract");
    assertHashBound(input.certificate, build.hash, "Review certificate");
    if (build.contract.buildHash !== build.hash || build.certificate.buildHash !== build.hash)
        throw new Error("Build audit artifacts are stale for the canonical build hash.");
    if (build.contract.status !== "valid" || build.certificate.status !== "valid" || input.contract.status !== "valid" || input.certificate.status !== "valid") {
        throw new Error("Delivery is blocked until every hard contract clause has a valid hash-bound certificate.");
    }
    if (input.reviewApproval && input.reviewApproval.buildHash !== build.hash)
        throw new Error("Review approval is bound to a different build hash.");
    if (input.reviewApproval && (input.reviewApproval.decision !== "approved"
        || input.reviewApproval.provenance !== "verified_blockwright_review_link"
        || input.reviewApproval.actorIdentityAssurance !== "self_asserted"
        || !/^link_[a-f0-9]{32}$/.test(input.reviewApproval.reviewLinkId)
        || !input.reviewApproval.actorId.trim()
        || !Number.isFinite(Date.parse(input.reviewApproval.createdAt)))) {
        throw new Error("Review approval requires persisted Blockwright review-link provenance, an approved decision, a self-asserted actor label, and a valid timestamp.");
    }
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(generatedAt)))
        throw new Error("Delivery generation time must be an ISO-compatible timestamp.");
    const origin = input.origin ?? build.bounds.min;
    const rotation = input.rotation ?? 0;
    if (![0, 90, 180, 270].includes(rotation))
        throw new Error("Delivery rotation must be 0, 90, 180, or 270 degrees.");
    if (![origin.x, origin.y, origin.z].every(Number.isSafeInteger))
        throw new Error("Delivery origin must use safe integer coordinates.");
    if (format === "litematic" && rotation !== 0) {
        throw new Error("Litematic delivery rotation is not implemented; export at 0 degrees and apply a declared rotation in a verified client workflow.");
    }
    const compatibility = validateCompatibility(build, format, input.compatibility);
    const artifact = format === "schem"
        ? exportSchematic(build, { offset: origin, rotation }).bytes
        : exportLitematic(build, { origin }).bytes;
    const artifactName = format === "schem" ? "build.schem" : "build.litematic";
    const materialList = createMaterialList(build);
    const instructions = [
        `Blockwright delivery for ${build.input.name}`,
        `Build hash: ${build.hash}`,
        `Minecraft target: Java ${build.input.version}`,
        `Artifact: ${artifactName}`,
        `Placement origin: ${origin.x}, ${origin.y}, ${origin.z}`,
        `Rotation: ${rotation} degrees clockwise around Y`,
        "Verify the target world, protected regions, block registry, origin, and rotation on a disposable copy before live placement.",
        "Stack and shulker estimates in material-list.json are planning aids, not exact inventory guarantees.",
    ].join("\n") + "\n";
    const textFiles = {
        "build.json": json(build),
        "material-list.json": json(materialList),
        "build-contract.json": json(input.contract),
        "review-certificate.json": json(input.certificate),
        "compatibility.json": json(compatibility),
        "placement-instructions.txt": instructions,
        ...(input.reviewApproval ? { "review-approval.json": json(input.reviewApproval) } : {}),
    };
    const files = [
        ...Object.entries(textFiles).map(([name, content]) => ({ name, bytes: Buffer.byteLength(content), sha256: checksum(content) })),
        { name: artifactName, bytes: artifact.byteLength, sha256: checksum(artifact) },
    ].sort((left, right) => left.name.localeCompare(right.name));
    const manifest = {
        schemaVersion: 1,
        buildId: build.id,
        buildHash: build.hash,
        edition: "java",
        minecraftVersion: build.input.version,
        artifactFormat: format,
        generatedAt,
        files,
    };
    const zip = new JSZip();
    for (const [name, content] of Object.entries(textFiles))
        zip.file(name, content);
    zip.file(artifactName, artifact);
    zip.file("manifest.json", json(manifest));
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
    return { bytes, manifest, materialList, compatibility };
}
//# sourceMappingURL=delivery.js.map