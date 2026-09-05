import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { MinecraftBlockTypes } from "@minecraft/vanilla-data";
import { readJavaRegistry } from "./java-registry.js";
import type { Edition, PaletteRole, RolePalette, SavedPalette } from "./types.js";

export const PALETTE_ROLES: PaletteRole[] = ["foundation", "wall", "frame", "roof", "trim", "glazing", "lighting", "doors", "railings", "accents", "landscaping"];
const BEDROCK_BLOCK_IDS = new Set<string>(Object.values(MinecraftBlockTypes));
const MINECRAFT_BLOCK_ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

type PaletteSession = SavedPalette & { complete: boolean };
type PaletteDatabase = { schemaVersion: 1; palettes: SavedPalette[]; sessions: PaletteSession[] };

function statePath() {
  const appData = process.env.APPDATA || process.cwd();
  return resolve(process.env.BLOCKWRIGHT_STATE_DIR || resolve(appData, "Blockwright"), "palettes.json");
}

function readDatabase(): PaletteDatabase {
  const path = statePath();
  if (!existsSync(path)) return { schemaVersion: 1, palettes: [], sessions: [] };
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as PaletteDatabase;
    return value.schemaVersion === 1 ? value : { schemaVersion: 1, palettes: [], sessions: [] };
  } catch {
    return { schemaVersion: 1, palettes: [], sessions: [] };
  }
}

function writeDatabase(database: PaletteDatabase) {
  const path = statePath();
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(database, null, 2));
  renameSync(temp, path);
}

const styleRoles: Record<string, Partial<RolePalette>> = {
  nordic: { foundation: "minecraft:stone_bricks", wall: "minecraft:spruce_planks", frame: "minecraft:stripped_spruce_log", roof: "minecraft:spruce_stairs", trim: "minecraft:spruce_slab", glazing: "minecraft:glass_pane", lighting: "minecraft:lantern", doors: "minecraft:spruce_door", railings: "minecraft:spruce_fence", accents: "minecraft:mossy_stone_bricks", landscaping: "minecraft:moss_block" },
  japanese: { foundation: "minecraft:stone_bricks", wall: "minecraft:white_concrete", frame: "minecraft:dark_oak_log", roof: "minecraft:dark_oak_stairs", trim: "minecraft:dark_oak_slab", glazing: "minecraft:white_stained_glass_pane", lighting: "minecraft:lantern", doors: "minecraft:dark_oak_door", railings: "minecraft:dark_oak_fence", accents: "minecraft:red_terracotta", landscaping: "minecraft:moss_block" },
  modern: { foundation: "minecraft:smooth_stone", wall: "minecraft:white_concrete", frame: "minecraft:gray_concrete", roof: "minecraft:smooth_quartz", trim: "minecraft:polished_blackstone_slab", glazing: "minecraft:tinted_glass", lighting: "minecraft:sea_lantern", doors: "minecraft:iron_door", railings: "minecraft:iron_bars", accents: "minecraft:cut_copper", landscaping: "minecraft:moss_block" },
  medieval: { foundation: "minecraft:cobblestone", wall: "minecraft:oak_planks", frame: "minecraft:stripped_dark_oak_log", roof: "minecraft:deepslate_tile_stairs", trim: "minecraft:dark_oak_slab", glazing: "minecraft:glass_pane", lighting: "minecraft:lantern", doors: "minecraft:dark_oak_door", railings: "minecraft:dark_oak_fence", accents: "minecraft:mossy_cobblestone", landscaping: "minecraft:grass_block" },
};

const universalRoles: RolePalette = {
  foundation: "minecraft:stone_bricks", wall: "minecraft:spruce_planks", frame: "minecraft:stripped_spruce_log",
  roof: "minecraft:spruce_stairs", trim: "minecraft:spruce_slab", glazing: "minecraft:glass_pane",
  lighting: "minecraft:lantern", doors: "minecraft:spruce_door", railings: "minecraft:spruce_fence",
  accents: "minecraft:mossy_stone_bricks", landscaping: "minecraft:moss_block",
};

function normalizeBlock(block: string) {
  const normalized = block.trim().toLowerCase().replaceAll(" ", "_");
  return normalized.includes(":") ? normalized : `minecraft:${normalized}`;
}

export function validatePaletteIdentifiers(edition: Edition, version: string, roles: Partial<RolePalette>) {
  const registry = edition === "java" ? readJavaRegistry(version) : undefined;
  if (edition === "java" && !registry) throw new Error(`Java ${version} is not synchronized. Run sync_java_version first.`);
  const allowed = new Set(registry?.blocks.map(({ id }) => id));
  const normalized = Object.fromEntries(Object.entries(roles).map(([role, block]) => [role, normalizeBlock(block!)])) as Partial<RolePalette>;
  const invalid = Object.entries(normalized).filter(([, block]) => !MINECRAFT_BLOCK_ID.test(block!) || (edition === "java" ? !allowed.has(block!) : !BEDROCK_BLOCK_IDS.has(block!)));
  return { valid: invalid.length === 0, normalized, invalid: invalid.map(([role, block]) => ({ role: role as PaletteRole, block: block! })) };
}

export function defaultRolePalette(style: string, edition: Edition, version: string, overrides: Partial<RolePalette> = {}): RolePalette {
  const overrideCheck = validatePaletteIdentifiers(edition, version, overrides);
  if (!overrideCheck.valid) throw new Error(`Invalid palette blocks: ${overrideCheck.invalid.map(({ role, block }) => `${role}=${block}`).join(", ")}`);
  const proposed = { ...universalRoles, ...(styleRoles[style.trim().toLowerCase()] ?? {}), ...overrides };
  const checked = validatePaletteIdentifiers(edition, version, proposed);
  if (!checked.valid) {
    for (const { role } of checked.invalid) proposed[role] = universalRoles[role];
  }
  const finalCheck = validatePaletteIdentifiers(edition, version, proposed);
  if (!finalCheck.valid) throw new Error(`Palette contains invalid ${edition} ${version} blocks: ${finalCheck.invalid.map(({ role, block }) => `${role}=${block}`).join(", ")}`);
  return finalCheck.normalized as RolePalette;
}

const interviewOrder = ["buildType", "architecturalDirection", "biome", "mood", "interpretation", "constraints", "dominantMaterials", "contrast", "weathering", "landscaping", "avoidBlocks", "resourcePack"] as const;

function nextQuestion(answers: Record<string, string>) {
  const key = interviewOrder.find((candidate) => !answers[candidate]);
  if (!key) return undefined;
  const survival = /survival/i.test(answers.constraints ?? "");
  const direction = answers.architecturalDirection || "the build";
  const questions: Record<typeof interviewOrder[number], string> = {
    buildType: "What are you building, and what must it do for you?",
    architecturalDirection: `What architectural direction should shape this ${answers.buildType || "build"}?`,
    biome: `Which biome or surrounding terrain should ${direction} respond to?`,
    mood: `What mood should someone feel when approaching it in ${answers.biome || "that setting"}?`,
    interpretation: "Should the architecture feel historically grounded, fantasy-forward, or intentionally mixed?",
    constraints: "Is this for survival, creative, or a server—and which resources or mechanics are constrained?",
    dominantMaterials: survival ? "Which locally obtainable materials should dominate the survival palette?" : "Which materials should carry the main visual identity?",
    contrast: `Should the palette use quiet tonal variation or strong contrast against ${answers.dominantMaterials || "the dominant material"}?`,
    weathering: "How new, aged, mossy, repaired, or weather-exposed should it look?",
    landscaping: `How should paths, water, plants, terrain, or courtyards connect the build to ${answers.biome || "its site"}?`,
    avoidBlocks: "Are there blocks, colors, crafting costs, or visual clichés you want excluded?",
    resourcePack: "Will you preview this with vanilla textures or a specific resource pack?",
  };
  return { key, question: questions[key] };
}

export function continuePaletteInterview(input: {
  sessionId?: string; name?: string; edition: Edition; version: string; style?: string;
  answers?: Record<string, string>; roleChanges?: Partial<RolePalette>; lockRoles?: PaletteRole[];
  unlockRoles?: PaletteRole[]; rejectBlocks?: string[];
}) {
  const db = readDatabase();
  const now = new Date().toISOString();
  let session = input.sessionId ? db.sessions.find(({ id }) => id === input.sessionId) : undefined;
  if (!session) {
    session = {
      id: input.sessionId || `palette_session_${randomUUID()}`, name: input.name?.trim() || "Untitled Palette",
      edition: input.edition, version: input.version, roles: defaultRolePalette(input.style || "nordic", input.edition, input.version),
      lockedRoles: [], rejectedBlocks: [], answers: {}, createdAt: now, updatedAt: now, complete: false,
    };
    db.sessions.push(session);
  }
  if (session.edition !== input.edition || session.version !== input.version) throw new Error("A palette interview cannot switch edition or version mid-session. Start a new session.");
  session.answers = { ...session.answers, ...(input.answers ?? {}) };
  const changes = validatePaletteIdentifiers(session.edition, session.version, input.roleChanges ?? {});
  if (!changes.valid) throw new Error(`Invalid palette blocks: ${changes.invalid.map(({ role, block }) => `${role}=${block}`).join(", ")}`);
  for (const [role, block] of Object.entries(changes.normalized)) {
    if (!session.lockedRoles.includes(role as PaletteRole)) session.roles[role as PaletteRole] = block!;
  }
  session.lockedRoles = [...new Set([...session.lockedRoles.filter((role) => !(input.unlockRoles ?? []).includes(role)), ...(input.lockRoles ?? [])])];
  session.rejectedBlocks = [...new Set([...session.rejectedBlocks, ...(input.rejectBlocks ?? []).map(normalizeBlock)])];
  const rejectedAssignments = Object.entries(session.roles).filter(([, block]) => session!.rejectedBlocks.includes(block));
  if (rejectedAssignments.length) throw new Error(`Rejected blocks remain assigned: ${rejectedAssignments.map(([role, block]) => `${role}=${block}`).join(", ")}. Replace them before continuing.`);
  session.updatedAt = now;
  const next = nextQuestion(session.answers);
  session.complete = !next;
  writeDatabase(db);
  return { session, nextQuestion: next, remainingTopics: interviewOrder.filter((key) => !session!.answers[key]) };
}

export function savePalette(sessionId: string, name: string) {
  const db = readDatabase();
  const session = db.sessions.find(({ id }) => id === sessionId);
  if (!session) throw new Error(`Palette session not found: ${sessionId}`);
  const now = new Date().toISOString();
  const existing = db.palettes.find(({ id }) => id === sessionId.replace("palette_session_", "palette_"));
  const saved: SavedPalette = { ...session, id: existing?.id ?? session.id.replace("palette_session_", "palette_"), name: name.trim() || session.name, createdAt: existing?.createdAt ?? now, updatedAt: now };
  delete (saved as SavedPalette & { complete?: boolean }).complete;
  db.palettes = [...db.palettes.filter(({ id }) => id !== saved.id), saved];
  writeDatabase(db);
  return saved;
}

export const listPalettes = () => readDatabase().palettes;
export function loadPalette(id: string) {
  const value = readDatabase().palettes.find((palette) => palette.id === id);
  if (!value) throw new Error(`Palette not found: ${id}`);
  return value;
}
export function renamePalette(id: string, name: string) {
  const db = readDatabase();
  const value = db.palettes.find((palette) => palette.id === id);
  if (!value) throw new Error(`Palette not found: ${id}`);
  value.name = name.trim(); value.updatedAt = new Date().toISOString(); writeDatabase(db); return value;
}
export function deletePalette(id: string) {
  const db = readDatabase();
  const before = db.palettes.length;
  db.palettes = db.palettes.filter((palette) => palette.id !== id);
  if (db.palettes.length === before) throw new Error(`Palette not found: ${id}`);
  writeDatabase(db); return { id, deleted: true };
}

export function paletteFingerprint(palette: RolePalette) {
  return createHash("sha256").update(JSON.stringify(PALETTE_ROLES.map((role) => [role, palette[role]]))).digest("hex").slice(0, 16);
}
