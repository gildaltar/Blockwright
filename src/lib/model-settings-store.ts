import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  publicModelProviderConfig,
  validateModelProviderConfig,
  validateModelProviderSettings,
  type ModelProviderConfig,
  type ModelProviderSettings,
} from "./model-providers.js";

export type ModelSettingsDocument = {
  schemaVersion: 1;
  settings: ModelProviderSettings;
  providers: ModelProviderConfig[];
};

export interface ModelSettingsStorage {
  read(): Promise<string | undefined>;
  writeAtomically(content: string): Promise<void>;
}

export class FileModelSettingsStorage implements ModelSettingsStorage {
  constructor(readonly path: string) {
    if (!path.trim()) throw new Error("Model settings path is required.");
  }

  async read() {
    try {
      return await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async writeAtomically(content: string) {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.path);
    } finally {
      await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
}

export function validateModelSettingsDocument(value: unknown): ModelSettingsDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Model settings must be a JSON object.");
  const input = value as Record<string, unknown>;
  const unknownKey = Object.keys(input).find((key) => !["schemaVersion", "settings", "providers"].includes(key));
  if (unknownKey) throw new Error(`Unsupported model settings field: ${unknownKey}.`);
  if (input.schemaVersion !== 1) throw new Error("Model settings require schemaVersion 1.");
  if (!input.settings || typeof input.settings !== "object" || Array.isArray(input.settings)) throw new Error("Model settings policy is required.");
  if (!Array.isArray(input.providers)) throw new Error("Model settings providers must be an array.");
  const settings = validateModelProviderSettings(input.settings as ModelProviderSettings);
  const providers = input.providers.map((provider) => validateModelProviderConfig(provider as ModelProviderConfig));
  if (new Set(providers.map(({ id }) => id)).size !== providers.length) throw new Error("Model settings contain duplicate provider ids.");
  const providerIds = new Set(["none", ...providers.map(({ id }) => id)]);
  const routedIds = [...Object.values(settings.routes ?? {}).flat(), ...(settings.defaultProviderIds ?? [])];
  const missingProvider = routedIds.find((id) => !providerIds.has(id));
  if (missingProvider) throw new Error(`Model settings route references unknown provider ${missingProvider}.`);
  return structuredClone({ schemaVersion: 1, settings, providers }) as ModelSettingsDocument;
}

export class SecretFreeModelSettingsStore {
  constructor(private readonly storage: ModelSettingsStorage) {}

  async load(): Promise<ModelSettingsDocument | undefined> {
    const content = await this.storage.read();
    if (content === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("Model settings are not valid JSON.");
    }
    return validateModelSettingsDocument(parsed);
  }

  async save(document: ModelSettingsDocument): Promise<ModelSettingsDocument> {
    const validated = validateModelSettingsDocument(document);
    const secretFree = {
      schemaVersion: 1 as const,
      settings: validated.settings,
      providers: validated.providers.map((provider) => publicModelProviderConfig(provider)),
    };
    const serialized = `${JSON.stringify(secretFree, null, 2)}\n`;
    await this.storage.writeAtomically(serialized);
    return structuredClone(secretFree) as ModelSettingsDocument;
  }
}
