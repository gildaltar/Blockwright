import { describe, expect, it } from "vitest";
import { isValidJavaRegistrySnapshot, readJavaRegistry } from "./java-registry.js";
import { chooseModelReference, placementTextureKey } from "./resource-pack.js";

describe("Java version registry", () => {
  it("loads the verified Java 26.2 blockstate index", () => {
    const registry = readJavaRegistry("26.2");
    expect(registry?.client.sha1).toBe("2dc72797acbc1b63fc16a11c4ac393605f453754");
    expect(registry?.protocolVersion).toBe(776);
    expect(registry?.resourcePackVersion.major).toBe(88);
    expect(registry?.blocks.some(({ id }) => id === "minecraft:spruce_planks")).toBe(true);
    expect(registry?.blockCount).toBe(1198);
  });

  it("rejects truncated, inconsistent, and duplicate Java registry snapshots", () => {
    const registry = readJavaRegistry("26.2");
    expect(registry).toBeDefined();
    expect(isValidJavaRegistrySnapshot(registry, "26.2")).toBe(true);
    expect(isValidJavaRegistrySnapshot({ schemaVersion: 1, edition: "java", version: "26.2" }, "26.2")).toBe(false);
    expect(isValidJavaRegistrySnapshot({ ...registry, blockCount: registry!.blockCount + 1 }, "26.2")).toBe(false);
    expect(isValidJavaRegistrySnapshot({ ...registry, blocks: [registry!.blocks[0], registry!.blocks[0]], blockCount: 2 }, "26.2")).toBe(false);
  });
});

describe("resource-pack resolution", () => {
  it("creates stable keys regardless of state property order", () => {
    expect(placementTextureKey("minecraft:spruce_stairs", { half: "bottom", facing: "east" }))
      .toBe(placementTextureKey("minecraft:spruce_stairs", { facing: "east", half: "bottom" }));
  });

  it("chooses a blockstate model compatible with the placement state", () => {
    const blockstate = {
      variants: {
        "facing=west,half=bottom,shape=straight": { model: "minecraft:block/west" },
        "facing=east,half=bottom,shape=straight": { model: "minecraft:block/east" },
      },
    };
    expect(chooseModelReference(blockstate, { facing: "east", half: "bottom" })).toBe("minecraft:block/east");
  });
});
