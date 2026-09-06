import { describe, expect, it } from "vitest";
import { SecretFreeModelSettingsStore, validateModelSettingsDocument, type ModelSettingsStorage } from "./model-settings-store.js";
import type { ModelSettingsDocument } from "./model-settings-store.js";

class MemorySettingsStorage implements ModelSettingsStorage {
  content?: string;
  writes = 0;

  async read() {
    return this.content;
  }

  async writeAtomically(content: string) {
    this.content = content;
    this.writes += 1;
  }
}

const document: ModelSettingsDocument = {
  schemaVersion: 1,
  settings: {
    mode: "local-only",
    fallbackPolicy: "same-privacy",
    routes: { planning: ["ollama-local"] },
  },
  providers: [{
    id: "ollama-local",
    label: "Ollama",
    kind: "ollama",
    baseUrl: "http://127.0.0.1:11434/",
    model: "qwen-local",
    maximumConcurrency: 1,
  }],
};

describe("secret-free model settings", () => {
  it("validates, normalizes, saves, and loads without a credential value", async () => {
    const storage = new MemorySettingsStorage();
    const store = new SecretFreeModelSettingsStore(storage);
    const saved = await store.save(document);
    const loaded = await store.load();

    expect(storage.writes).toBe(1);
    expect(saved).toEqual(loaded);
    expect(loaded).toMatchObject({
      schemaVersion: 1,
      settings: { mode: "local-only", fallbackPolicy: "same-privacy" },
      providers: [{ id: "ollama-local", requestTimeoutMs: 30_000, retryCount: 0, maximumConcurrency: 1 }],
    });
    expect(storage.content).not.toMatch(/api.?key|password|secret/i);
  });

  it("persists credential references but rejects plaintext or unknown settings", async () => {
    const withReference: ModelSettingsDocument = {
      schemaVersion: 1,
      settings: { mode: "allow-cloud", routes: { planning: ["cloud-primary"] } },
      providers: [{
        id: "cloud-primary",
        label: "Cloud",
        kind: "openai-compatible-cloud",
        baseUrl: "https://models.example.test/v1/",
        model: "cloud-model",
        credentialRef: "wincred:blockwright/cloud-primary",
      }],
    };
    const storage = new MemorySettingsStorage();
    await new SecretFreeModelSettingsStore(storage).save(withReference);
    expect(storage.content).toContain("wincred:blockwright/cloud-primary");

    expect(() => validateModelSettingsDocument({
      ...withReference,
      providers: [{ ...withReference.providers[0], apiKey: "fake-plaintext-value" }],
    })).toThrow(/PLAINTEXT_CREDENTIAL_FORBIDDEN/);
    expect(() => validateModelSettingsDocument({ ...withReference, unknownSetting: true })).toThrow(/Unsupported model settings field/);
  });

  it("fails closed for malformed JSON, duplicate providers, and invalid routes", async () => {
    const malformed = new MemorySettingsStorage();
    malformed.content = "{not-json";
    await expect(new SecretFreeModelSettingsStore(malformed).load()).rejects.toThrow(/not valid JSON/);

    expect(() => validateModelSettingsDocument({ ...document, providers: [document.providers[0], document.providers[0]] })).toThrow(/duplicate provider ids/);
    expect(() => validateModelSettingsDocument({ ...document, settings: { mode: "local-only", routes: { exporting: ["ollama-local"] } } })).toThrow(/unsupported task/i);
    expect(() => validateModelSettingsDocument({ ...document, settings: { mode: "local-only", routes: { planning: ["missing-provider"] } } })).toThrow(/unknown provider/);
  });
});
