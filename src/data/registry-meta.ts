export const REGISTRY_META = {
  java: {
    requestedVersion: "26.2",
    coverageVersion: "26.2",
    source: "Mojang Java client JAR blockstate assets",
    sourceUrl: "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
    syncedAt: "2026-09-02T20:00:00.000Z",
  },
  bedrock: {
    requestedVersion: "stable",
    coverageVersion: "1.26.40",
    source: "minecraft-data",
    sourceUrl: "https://github.com/PrismarineJS/minecraft-data",
    syncedAt: "2026-09-05T00:00:00.000Z",
  },
} as const;
