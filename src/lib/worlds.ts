import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { parse, simplify } from "prismarine-nbt";
import { exportSchematic, importSchematic, type SchematicOptions } from "./schematic.js";
import type { BuildRecord, DiscoveredWorld, Vec3, WorldRegion } from "./types.js";

function stableWorldId(canonicalPath: string) {
  return `world_${createHash("sha256").update(canonicalPath.toLowerCase()).digest("hex").slice(0, 16)}`;
}

function defaultSavesRoot() {
  return resolve(process.env.APPDATA || process.cwd(), ".minecraft", "saves");
}

function safeRealPath(path: string) {
  try { return realpathSync.native(path); } catch { return resolve(path); }
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value) && value.length === 2) return value[0] * 0x1_0000_0000 + (value[1] >>> 0);
  return undefined;
}

function gameMode(value: unknown) {
  return ({ 0: "Survival", 1: "Creative", 2: "Adventure", 3: "Spectator" } as Record<number, string>)[Number(value)] ?? "Unknown";
}

function isWorldLocked(worldPath: string) {
  const lockPath = resolve(worldPath, "session.lock");
  if (!existsSync(lockPath)) return false;
  try { const descriptor = openSync(lockPath, "r+"); closeSync(descriptor); return false; } catch { return true; }
}

function detectPlatform(worldPath: string) {
  const savesRoot = dirname(worldPath); const instanceRoot = dirname(savesRoot); const serverRoot = dirname(worldPath);
  if (existsSync(resolve(serverRoot, "plugins", "WorldEdit")) || existsSync(resolve(serverRoot, "paper.yml"))) return "paper" as const;
  if (existsSync(resolve(serverRoot, "spigot.yml"))) return "spigot" as const;
  const mods = resolve(instanceRoot, "mods");
  if (existsSync(mods)) {
    const names = readdirSync(mods).map((name) => name.toLowerCase());
    if (names.some((name) => name.includes("neoforge"))) return "neoforge" as const;
    if (names.some((name) => name.includes("fabric") || name.includes("worldedit-fabric"))) return "fabric" as const;
    if (names.some((name) => name.includes("forge"))) return "forge" as const;
  }
  return safeRealPath(savesRoot).toLowerCase() === safeRealPath(defaultSavesRoot()).toLowerCase() ? "vanilla" as const : "unknown" as const;
}

function suggestedFolders(worldPath: string, platform: DiscoveredWorld["platform"]) {
  const savesRoot = dirname(worldPath); const instanceRoot = dirname(savesRoot); const serverRoot = dirname(worldPath);
  if (platform === "paper" || platform === "spigot") return [resolve(serverRoot, "plugins", "WorldEdit", "schematics")];
  return [resolve(instanceRoot, "config", "worldedit", "schematics")];
}

export async function readWorldMetadata(worldPath: string): Promise<DiscoveredWorld> {
  const canonicalPath = safeRealPath(worldPath); const levelPath = resolve(canonicalPath, "level.dat");
  if (!existsSync(levelPath) || !lstatSync(levelPath).isFile()) throw new Error(`No level.dat found in ${canonicalPath}`);
  const stats = statSync(levelPath);
  if (stats.size > 32 * 1024 * 1024) throw new Error(`level.dat is unexpectedly large: ${canonicalPath}`);
  const parsed = await parse(readFileSync(levelPath), "big"); const root = simplify(parsed.parsed) as any; const data = root.Data ?? root;
  const platform = detectPlatform(canonicalPath);
  return {
    id: stableWorldId(canonicalPath), canonicalPath, folderName: basename(canonicalPath), displayName: data.LevelName || basename(canonicalPath),
    dataVersion: asNumber(data.DataVersion), minecraftVersion: data.Version?.Name,
    lastPlayed: asNumber(data.LastPlayed), gameMode: gameMode(data.GameType), location: canonicalPath,
    locked: isWorldLocked(canonicalPath), platform, suggestedSchematicFolders: suggestedFolders(canonicalPath, platform),
  };
}

export async function discoverWorlds(authorizedRoot?: string) {
  const roots = [...new Set([defaultSavesRoot(), ...(authorizedRoot ? [resolve(authorizedRoot)] : [])])];
  const worlds: DiscoveredWorld[] = []; const warnings: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) { if (authorizedRoot && resolve(authorizedRoot) === root) warnings.push(`Authorized saves folder does not exist: ${root}`); continue; }
    let entries: string[] = [];
    try { entries = readdirSync(root); } catch { warnings.push(`Could not read saves folder: ${root}`); continue; }
    for (const name of entries.slice(0, 500)) {
      const candidate = resolve(root, name);
      try { if (lstatSync(candidate).isDirectory() && existsSync(resolve(candidate, "level.dat"))) worlds.push(await readWorldMetadata(candidate)); }
      catch (error) { warnings.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  worlds.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || a.displayName.localeCompare(b.displayName));
  return { roots: roots.map(safeRealPath), worlds, warnings, localOnly: "These worlds are available only while the local Blockwright companion on this PC is connected." };
}

function safeSchematicName(name: string) {
  const value = name.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  if (!value) throw new Error("A valid schematic name is required.");
  return extname(value).toLowerCase() === ".schem" ? value : `${value}.schem`;
}

export async function installWorldEditSchematic(input: {
  worldId: string; canonicalWorldPath: string; targetFolder: string; name: string; build: BuildRecord;
  confirmed: boolean; overwrite?: boolean; schematicOptions?: SchematicOptions; includeAir?: boolean;
  dimension?: "overworld" | "the_nether" | "the_end"; anchor?: Vec3; region?: WorldRegion;
}) {
  const world = await readWorldMetadata(input.canonicalWorldPath);
  if (world.id !== input.worldId) throw new Error("The selected world identifier does not match its canonical path.");
  const targetFolder = safeRealPath(input.targetFolder);
  const recommended = world.suggestedSchematicFolders.map((path) => resolve(path).toLowerCase());
  if (!recommended.includes(resolve(targetFolder).toLowerCase())) throw new Error("The target must exactly match a WorldEdit schematics folder suggested for the selected instance/server.");
  const filename = safeSchematicName(input.name); const target = resolve(targetFolder, filename);
  if (dirname(target).toLowerCase() !== resolve(targetFolder).toLowerCase()) throw new Error("Ambiguous schematic target path.");
  const schematic = exportSchematic(input.build, { ...input.schematicOptions, includeAir: input.includeAir });
  const verifiedSchematic = await importSchematic(schematic.bytes);
  const anchor = input.anchor ?? input.build.input.origin;
  const affectedBounds = {
    min: anchor,
    max: { x: anchor.x + verifiedSchematic.dimensions.width - 1, y: anchor.y + verifiedSchematic.dimensions.height - 1, z: anchor.z + verifiedSchematic.dimensions.depth - 1 },
  };
  const minChunk = { x: Math.floor(affectedBounds.min.x / 16), z: Math.floor(affectedBounds.min.z / 16) };
  const maxChunk = { x: Math.floor(affectedBounds.max.x / 16), z: Math.floor(affectedBounds.max.z / 16) };
  const chunksTouched = (maxChunk.x - minChunk.x + 1) * (maxChunk.z - minChunk.z + 1);
  const positionKey = ({ x, y, z }: Vec3) => `${x},${y},${z}`;
  let conflicts: { status: "not_scanned" | "scanned"; occupied: number | null; protected: number | null; note: string } = {
    status: "not_scanned", occupied: null, protected: null,
    note: "WorldEdit installation does not read chunk data. Provide a canonical region snapshot to analyze occupied and protected coordinates before pasting.",
  };
  if (input.region) {
    const occupied = new Set((input.region.blocks ?? []).map(positionKey));
    const protectedSet = new Set((input.region.protectedCoordinates ?? []).map(positionKey));
    const anchored = verifiedSchematic.placements.map((placement) => ({ x: placement.x + anchor.x, y: placement.y + anchor.y, z: placement.z + anchor.z }));
    conflicts = {
      status: "scanned",
      occupied: anchored.filter((position) => occupied.has(positionKey(position))).length,
      protected: anchored.filter((position) => protectedSet.has(positionKey(position))).length,
      note: "Conflicts were calculated against the supplied canonical region snapshot.",
    };
  }
  const dimension = input.dimension ?? "overworld";
  const pasteFlags = input.includeAir === false ? " -a" : "";
  const preview = {
    world, dimension, anchor, affectedBounds, chunkRange: { min: minChunk, max: maxChunk }, chunksTouched,
    blockCount: schematic.blockCount, paletteSize: schematic.paletteSize, conflicts,
    risk: { minecraft: input.build.preflight.minecraftRisk, worldEdit: input.build.preflight.worldEditRisk, warnings: input.build.preflight.warnings },
    installedPath: target, targetExists: existsSync(target), overwrite: Boolean(input.overwrite),
    transform: { rotation: input.schematicOptions?.rotation ?? 0, mirror: input.schematicOptions?.mirror ?? "none", offset: input.schematicOptions?.offset ?? { x: 0, y: 0, z: 0 }, includeAir: input.includeAir ?? false },
    instructions: [`Enter minecraft:${dimension}`, `Stand at ${anchor.x} ${anchor.y} ${anchor.z}`, `//schem load ${filename.replace(/\.schem$/i, "")}`, `//paste${pasteFlags}`],
    directWorldEditing: "unimplemented" as const,
  };
  if (!input.confirmed) return { ...preview, status: "confirmation_required" as const, verified: false, bytes: schematic.bytes.byteLength, sha256: createHash("sha256").update(schematic.bytes).digest("hex") };
  if (existsSync(target) && !input.overwrite) throw new Error(`A schematic already exists at ${target}; choose another name or explicitly allow overwrite.`);
  mkdirSync(targetFolder, { recursive: true });
  const temp = `${target}.${process.pid}.tmp`; writeFileSync(temp, schematic.bytes); renameSync(temp, target);
  const installed = readFileSync(target); const verified = await importSchematic(installed);
  return {
    ...preview, status: "installed" as const, bytes: installed.byteLength, sha256: createHash("sha256").update(installed).digest("hex"),
    verified: verified.placements.length === schematic.blockCount,
  };
}
