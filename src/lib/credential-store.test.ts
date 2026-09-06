import { describe, expect, it, vi } from "vitest";
import type { PowerShellRunOptions, PowerShellRunner } from "./bounded-powershell.js";
import {
  CredentialStoreError,
  UnsupportedCredentialStore,
  WindowsCredentialManagerStore,
  createCredentialStore,
  credentialErrorSummary,
  type CredentialReference,
  type CredentialStore,
} from "./credential-store.js";

class FakeCredentialRunner implements PowerShellRunner {
  readonly values = new Map<string, string>();
  readonly calls: Array<{ script: string; input: string }> = [];

  async run(script: string, options?: PowerShellRunOptions) {
    const input = Buffer.from(options?.input ?? []).toString("utf8");
    this.calls.push({ script, input });
    const request = JSON.parse(input) as { operation: string; target?: string; prefix?: string; secretUtf8Base64?: string };
    if (request.operation === "set") {
      this.values.set(request.target!, Buffer.from(request.secretUtf8Base64!, "base64").toString("utf8"));
      return JSON.stringify({ ok: true, exists: true });
    }
    if (request.operation === "read") {
      const secret = this.values.get(request.target!);
      return JSON.stringify(secret === undefined ? { ok: true, exists: false } : { ok: true, exists: true, secretUtf8Base64: Buffer.from(secret).toString("base64") });
    }
    if (request.operation === "status") return JSON.stringify({ ok: true, exists: this.values.has(request.target!) });
    if (request.operation === "remove") return JSON.stringify({ ok: true, removed: this.values.delete(request.target!) });
    if (request.operation === "list") return JSON.stringify({ ok: true, targets: [...this.values.keys()].filter((target) => target.startsWith(request.prefix!)) });
    throw new Error("unsupported fake operation");
  }
}

const reference = "wincred:blockwright/provider-primary" as CredentialReference;

describe("Windows credential store", () => {
  it("adds, updates, test-reads, resolves, lists, and removes through references only", async () => {
    const runner = new FakeCredentialRunner();
    const store = new WindowsCredentialManagerStore(runner, 2_000);

    await expect(store.set(reference, "fake-test-value-one")).resolves.toEqual({ reference, availability: "available", exists: true });
    await expect(store.status(reference)).resolves.toEqual({ reference, availability: "available", exists: true });
    await expect(store.testRead(reference)).resolves.toEqual({ reference, readable: true, availability: "available" });
    await expect(store.resolve(reference)).resolves.toBe("fake-test-value-one");
    await expect(store.set(reference, "fake-test-value-two")).resolves.toMatchObject({ exists: true });
    await expect(store.read(reference)).resolves.toBe("fake-test-value-two");
    await expect(store.list()).resolves.toEqual([{ reference }]);
    await expect(store.remove(reference)).resolves.toEqual({ reference, removed: true });
    await expect(store.read(reference)).resolves.toBeUndefined();
    await expect(store.status(reference)).resolves.toEqual({ reference, availability: "missing", exists: false });

    const serializedPublicResults = JSON.stringify([await store.list(), await store.status(reference), await store.testRead(reference)]);
    expect(serializedPublicResults).not.toContain("fake-test-value");
  });

  it("sends secret material only through stdin and never interpolates it into the static script", async () => {
    const runner = new FakeCredentialRunner();
    const store = new WindowsCredentialManagerStore(runner);
    await store.set(reference, "fake-stdin-only-value");

    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0].script).not.toContain("fake-stdin-only-value");
    expect(runner.calls[0].input).not.toContain("fake-stdin-only-value");
    expect(Buffer.from(JSON.parse(runner.calls[0].input).secretUtf8Base64, "base64").toString("utf8")).toBe("fake-stdin-only-value");
  });

  it("validates references and values before launching a child process", async () => {
    const runner = new FakeCredentialRunner();
    const store = new WindowsCredentialManagerStore(runner);
    await expect(store.set("wincred:blockwright/../escape" as CredentialReference, "fake-value")).rejects.toMatchObject({ code: "CREDENTIAL_REFERENCE_INVALID" });
    await expect(store.set(reference, "")).rejects.toMatchObject({ code: "CREDENTIAL_VALUE_INVALID" });
    await expect(store.set(reference, "x".repeat(1_281))).rejects.toMatchObject({ code: "CREDENTIAL_VALUE_TOO_LARGE" });
    expect(runner.calls).toHaveLength(0);
  });

  it("fails closed off Windows unless an explicit adapter is supplied", async () => {
    const unsupported = createCredentialStore({ platform: "linux" });
    expect(unsupported).toBeInstanceOf(UnsupportedCredentialStore);
    await expect(unsupported.status(reference)).resolves.toEqual({ reference, availability: "unsupported", exists: false });
    await expect(unsupported.resolve(reference)).rejects.toMatchObject({ code: "CREDENTIAL_STORE_UNSUPPORTED" });
    await expect(unsupported.list()).rejects.toMatchObject({ code: "CREDENTIAL_STORE_UNSUPPORTED" });

    const adapter = { status: vi.fn(async () => ({ reference, availability: "missing" as const, exists: false })) } as unknown as CredentialStore;
    expect(createCredentialStore({ platform: "linux", adapter })).toBe(adapter);
  });

  it("returns sanitized failure summaries and never propagates runner output", async () => {
    const runner: PowerShellRunner = { run: async () => { throw new Error("password=fake-leak Authorization: Bearer fake.token.value"); } };
    const store = new WindowsCredentialManagerStore(runner);
    const failure = await store.status(reference).catch((error) => error as CredentialStoreError);
    const summary = credentialErrorSummary(failure);
    expect(summary).toMatchObject({ code: "CREDENTIAL_STORE_OPERATION_FAILED", retrySafe: true });
    expect(JSON.stringify(summary)).not.toContain("fake-leak");
    expect(JSON.stringify(summary)).not.toContain("fake.token.value");
  });
});
