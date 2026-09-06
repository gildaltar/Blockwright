import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRuntimeStateRoot } from "./runtime-state.js";

describe("runtime state root", () => {
  it("prefers the controller-provided state root and legacy state directory", () => {
    const root = resolve("C:/fixtures/portable-state");
    const directory = resolve("C:/fixtures/legacy-state");
    const localAppData = resolve("C:/fixtures/local-app-data");
    expect(resolveRuntimeStateRoot({
      BLOCKWRIGHT_STATE_ROOT: root,
      BLOCKWRIGHT_STATE_DIR: directory,
      LOCALAPPDATA: localAppData,
    }, "C:/fixtures/work")).toBe(root);
    expect(resolveRuntimeStateRoot({
      BLOCKWRIGHT_STATE_DIR: directory,
      LOCALAPPDATA: localAppData,
    }, "C:/fixtures/work")).toBe(directory);
  });

  it("retains the installed and source fallbacks when no override is supplied", () => {
    const localAppData = resolve("C:/fixtures/local-app-data");
    const workingDirectory = resolve("C:/fixtures/work");
    expect(resolveRuntimeStateRoot({ LOCALAPPDATA: localAppData }, workingDirectory)).toBe(resolve(localAppData, "Blockwright"));
    expect(resolveRuntimeStateRoot({}, workingDirectory)).toBe(resolve(workingDirectory, ".blockwright"));
  });
});
