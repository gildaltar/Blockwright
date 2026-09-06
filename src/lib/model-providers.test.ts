import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LOCAL_MODEL_ENDPOINTS,
  ModelProviderError,
  ModelProviderRegistry,
  createModelProvider,
  discoverLocalModelProviders,
  providerErrorSummary,
  publicModelProviderConfig,
  validateModelProviderConfig,
  type FetchLike,
  type ModelInvocationRequest,
  type ModelProviderConfig,
} from "./model-providers.js";

const request: ModelInvocationRequest = {
  task: "planning",
  messages: [{ role: "user", content: "Plan a compact lodge." }],
};

function openAiResponse(content = "A structured plan", model = "local-model") {
  return new Response(JSON.stringify({
    model,
    choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 12, completion_tokens: 8 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function localConfig(overrides: Partial<ModelProviderConfig> = {}): ModelProviderConfig {
  return {
    id: "local-primary",
    label: "Local primary",
    kind: "openai-compatible-local",
    family: "lm-studio",
    baseUrl: "http://127.0.0.1:1234/v1/",
    model: "local-model",
    ...overrides,
  } as ModelProviderConfig;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("model provider configuration", () => {
  it("makes no-model mode explicit and performs no network request", async () => {
    const fetchMock = vi.fn<FetchLike>();
    const registry = new ModelProviderRegistry([localConfig()], { mode: "none", routes: { planning: ["local-primary"] } }, { fetch: fetchMock });

    await expect(registry.invoke(request)).resolves.toEqual({ status: "not_used", reason: "no_model", attemptedProviderIds: [] });
    await expect(registry.getStatus("none")).resolves.toMatchObject({ kind: "none", privacy: "none", availability: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects plaintext credentials and unsafe endpoint boundaries", () => {
    expect(() => validateModelProviderConfig({ ...localConfig(), apiKey: "must-not-live-in-json" } as unknown as ModelProviderConfig)).toThrow(/PLAINTEXT_CREDENTIAL_FORBIDDEN/);
    expect(() => validateModelProviderConfig({ ...localConfig(), baseUrl: "http://192.168.1.20:1234/v1/" } as ModelProviderConfig)).toThrow(/LOCAL_PROVIDER_NOT_LOOPBACK/);
    expect(() => validateModelProviderConfig({
      ...localConfig(),
      id: "cloud",
      kind: "openai-compatible-cloud",
      baseUrl: "http://api.example.test/v1/",
      credentialRef: "wincred:blockwright/cloud",
    } as ModelProviderConfig)).toThrow(/require HTTPS/);
  });

  it("keeps only an operating-system credential reference in public configuration", async () => {
    const secret = "super-secret-provider-key";
    const seenAuthorization: string[] = [];
    const config: ModelProviderConfig = {
      id: "cloud-primary",
      label: "Cloud primary",
      kind: "openai-compatible-cloud",
      baseUrl: "https://models.example.test/v1/",
      model: "cloud-model",
      credentialRef: "wincred:blockwright/cloud-primary",
    };
    const provider = createModelProvider(config, {
      credentialResolver: { resolve: async (reference) => reference === config.credentialRef ? secret : undefined },
      fetch: async (_input, init) => {
        const headers = new Headers(init?.headers);
        seenAuthorization.push(headers.get("authorization") ?? "");
        return openAiResponse("cloud plan", "cloud-model");
      },
    });

    await expect(provider.invoke(request)).resolves.toMatchObject({ content: "cloud plan" });
    expect(seenAuthorization).toEqual([`Bearer ${secret}`]);
    expect(JSON.stringify(publicModelProviderConfig(config))).toContain("wincred:blockwright/cloud-primary");
    expect(JSON.stringify(publicModelProviderConfig(config))).not.toContain(secret);
    expect(JSON.stringify(await provider.status())).not.toContain(secret);
  });
});

describe("local and OpenAI-compatible adapters", () => {
  it("uses Ollama's tags and chat contracts", async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    const provider = createModelProvider({
      id: "ollama-local",
      label: "Ollama",
      kind: "ollama",
      baseUrl: "http://127.0.0.1:11434/",
      model: "qwen-local",
    }, {
      fetch: async (input, init) => {
        const url = String(input);
        calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (url.endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "qwen-local" }] }), { status: 200 });
        return new Response(JSON.stringify({ model: "qwen-local", message: { content: "local plan" }, done_reason: "stop", prompt_eval_count: 4, eval_count: 3 }), { status: 200 });
      },
    });

    await expect(provider.status()).resolves.toMatchObject({ availability: "available", discoveredModels: ["qwen-local"] });
    await expect(provider.invoke({ ...request, json: true })).resolves.toMatchObject({ content: "local plan", usage: { inputTokens: 4, outputTokens: 3 } });
    expect(calls.map(({ url }) => url)).toEqual(["http://127.0.0.1:11434/api/tags", "http://127.0.0.1:11434/api/chat"]);
    expect(calls[1].body).toMatchObject({ model: "qwen-local", stream: false, format: "json" });
  });

  it("uses one generic adapter for LM Studio and llama.cpp OpenAI-compatible endpoints", async () => {
    const urls: string[] = [];
    for (const [id, family, port] of [["lmstudio", "lm-studio", 1234], ["llamacpp", "llama.cpp", 8080]] as const) {
      const provider = createModelProvider({
        id,
        label: family,
        kind: "openai-compatible-local",
        family,
        baseUrl: `http://127.0.0.1:${port}/v1/`,
        model: "loaded-model",
      }, {
        fetch: async (input) => {
          urls.push(String(input));
          return String(input).endsWith("/models")
            ? new Response(JSON.stringify({ data: [{ id: "loaded-model" }] }), { status: 200 })
            : openAiResponse(family, "loaded-model");
        },
      });
      await expect(provider.status()).resolves.toMatchObject({ availability: "available", discoveredModels: ["loaded-model"] });
      await expect(provider.invoke(request)).resolves.toMatchObject({ content: family });
    }
    expect(urls).toEqual([
      "http://127.0.0.1:1234/v1/models",
      "http://127.0.0.1:1234/v1/chat/completions",
      "http://127.0.0.1:8080/v1/models",
      "http://127.0.0.1:8080/v1/chat/completions",
    ]);
  });

  it("discovers known local endpoints through injected probes without real network access", async () => {
    const discovered = await discoverLocalModelProviders({
      targets: DEFAULT_LOCAL_MODEL_ENDPOINTS,
      fetch: async (input) => String(input).includes("api/tags")
        ? new Response(JSON.stringify({ models: [{ name: "ollama-model" }] }), { status: 200 })
        : new Response(JSON.stringify({ data: [{ id: "openai-local-model" }] }), { status: 200 }),
    });
    expect(discovered).toHaveLength(3);
    expect(discovered.every(({ available }) => available)).toBe(true);
    expect(discovered.find(({ id }) => id === "ollama-local")?.models).toEqual(["ollama-model"]);
    expect(discovered.find(({ id }) => id === "lm-studio-local")?.family).toBe("lm-studio");
  });
});

describe("privacy, routing, and runtime controls", () => {
  it("blocks cloud providers before probing or invoking in local-only/cloud-disabled modes", async () => {
    for (const mode of ["local-only", "cloud-disabled"] as const) {
      const fetchMock = vi.fn<FetchLike>();
      const registry = new ModelProviderRegistry([{
        id: "cloud-route",
        label: "Cloud route",
        kind: "openai-compatible-cloud",
        baseUrl: "https://models.example.test/v1/",
        model: "cloud-model",
        authentication: "none",
      }], { mode, routes: { planning: ["cloud-route"] } }, { fetch: fetchMock });

      await expect(registry.getStatus("cloud-route")).resolves.toMatchObject({ availability: "blocked", errorCode: "MODEL_PRIVACY_POLICY_BLOCKED" });
      await expect(registry.invoke(request)).resolves.toEqual({ status: "not_used", reason: "privacy_policy", attemptedProviderIds: [] });
      await expect(registry.invoke({ ...request, required: true })).rejects.toMatchObject({ code: "MODEL_PRIVACY_POLICY_BLOCKED" });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("falls back only after retry-safe failures and only within the configured privacy boundary", async () => {
    const calls: string[] = [];
    const sameBoundary = new ModelProviderRegistry([
      localConfig({ id: "local-a", label: "Local A", baseUrl: "http://127.0.0.1:11001/v1/" }),
      localConfig({ id: "local-b", label: "Local B", baseUrl: "http://127.0.0.1:11002/v1/" }),
    ], { mode: "local-only", fallbackPolicy: "same-privacy", routes: { planning: ["local-a", "local-b"] } }, {
      fetch: async (input) => {
        calls.push(String(input));
        return String(input).includes(":11001/") ? new Response(null, { status: 503 }) : openAiResponse("fallback plan", "local-b-model");
      },
    });
    await expect(sameBoundary.invoke(request)).resolves.toMatchObject({
      status: "completed",
      attemptedProviderIds: ["local-a", "local-b"],
      response: { providerId: "local-b", content: "fallback plan" },
    });

    const crossBoundaryFetch = vi.fn<FetchLike>(async (input) => String(input).includes(":11001/") ? new Response(null, { status: 503 }) : openAiResponse("cloud fallback"));
    const crossBoundary = new ModelProviderRegistry([
      localConfig({ id: "local-a", label: "Local A", baseUrl: "http://127.0.0.1:11001/v1/" }),
      { id: "cloud-b", label: "Cloud B", kind: "openai-compatible-cloud", baseUrl: "https://models.example.test/v1/", model: "cloud", authentication: "none" },
    ], { mode: "allow-cloud", fallbackPolicy: "same-privacy", routes: { planning: ["local-a", "cloud-b"] } }, { fetch: crossBoundaryFetch });
    await expect(crossBoundary.invoke(request)).rejects.toMatchObject({ code: "MODEL_PROVIDER_UNAVAILABLE" });
    expect(crossBoundaryFetch).toHaveBeenCalledTimes(1);
  });

  it("honors explicit retry, timeout, and concurrency limits", async () => {
    let retryCalls = 0;
    const retrying = createModelProvider(localConfig({ retryCount: 1, retryDelayMs: 0 }), {
      fetch: async () => ++retryCalls === 1 ? new Response(null, { status: 503 }) : openAiResponse("retried"),
    });
    await expect(retrying.invoke({ ...request, allowRetry: true })).resolves.toMatchObject({ content: "retried" });
    expect(retryCalls).toBe(2);

    vi.useFakeTimers();
    const timingOut = createModelProvider(localConfig({ id: "timeout-provider", requestTimeoutMs: 100 }), {
      fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    });
    const timed = expect(timingOut.invoke(request)).rejects.toMatchObject({ code: "MODEL_PROVIDER_TIMEOUT", retrySafe: false });
    await vi.advanceTimersByTimeAsync(101);
    await timed;
    vi.useRealTimers();

    let releaseFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => { releaseFirst = resolve; });
    let calls = 0;
    const bounded = createModelProvider(localConfig({ id: "bounded-provider", maximumConcurrency: 1, maximumQueue: 0 }), {
      fetch: async () => ++calls === 1 ? firstResponse : openAiResponse("unexpected"),
    });
    const first = bounded.invoke(request);
    await expect(bounded.invoke(request)).rejects.toMatchObject({ code: "MODEL_PROVIDER_BUSY", retrySafe: true });
    releaseFirst(openAiResponse("first"));
    await expect(first).resolves.toMatchObject({ content: "first" });
  });

  it("returns redacted provider errors suitable for status and diagnostics", () => {
    const error = new ModelProviderError({
      code: "MODEL_PROVIDER_UNAVAILABLE",
      message: "Authorization: Bearer private.token.value password=hidden",
      likelyCause: "Offline",
      retrySafe: true,
      retryReason: "No result",
      recommendedAction: "Start provider",
      providerId: "local-primary",
    });
    const summary = providerErrorSummary(error);
    expect(summary).toMatchObject({ code: "MODEL_PROVIDER_UNAVAILABLE", retrySafe: true });
    expect(JSON.stringify(summary)).not.toContain("private.token.value");
    expect(JSON.stringify(summary)).not.toContain("password=hidden");
  });
});
