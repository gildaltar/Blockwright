import { performance } from "node:perf_hooks";
import { ManagedTaskError, sanitizeDiagnosticText } from "./task-contract.js";

export const MODEL_TASKS = ["planning", "critique", "revision"] as const;
export type ModelTask = (typeof MODEL_TASKS)[number];
export type ModelCapability = ModelTask | "structured-output";
export type ModelPrivacyBoundary = "none" | "local" | "cloud";
export type ModelProviderKind = "none" | "ollama" | "openai-compatible-local" | "openai-compatible-cloud";
export type OpenAICompatibleFamily = "generic" | "lm-studio" | "llama.cpp";
export type ModelPolicyMode = "none" | "local-only" | "cloud-disabled" | "allow-cloud";
export type ModelFallbackPolicy = "disabled" | "same-privacy" | "explicit";

export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ModelInvocationRequest = {
  task: ModelTask;
  messages: ModelMessage[];
  providerId?: string;
  model?: string;
  temperature?: number;
  maximumOutputTokens?: number;
  json?: boolean;
  /** Retries may duplicate provider cost. They occur only when explicitly allowed. */
  allowRetry?: boolean;
  required?: boolean;
};

export type ModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

export type ModelInvocationResponse = {
  providerId: string;
  model: string;
  content: string;
  finishReason?: string;
  usage?: ModelUsage;
  latencyMs: number;
};

export type ModelRouteResult =
  | { status: "not_used"; reason: "no_model" | "no_route" | "privacy_policy" | "capability_unavailable"; attemptedProviderIds: string[] }
  | { status: "completed"; response: ModelInvocationResponse; attemptedProviderIds: string[] };

type ProviderConfigBase = {
  id: string;
  label: string;
  enabled?: boolean;
  capabilities?: ModelCapability[];
  requestTimeoutMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
  maximumConcurrency?: number;
  maximumQueue?: number;
  contextWindow?: number;
  maximumOutputTokens?: number;
};

export type NoneModelProviderConfig = ProviderConfigBase & {
  kind: "none";
};

export type OllamaModelProviderConfig = ProviderConfigBase & {
  kind: "ollama";
  baseUrl: string;
  model: string;
};

export type OpenAICompatibleModelProviderConfig = ProviderConfigBase & {
  kind: "openai-compatible-local" | "openai-compatible-cloud";
  family?: OpenAICompatibleFamily;
  baseUrl: string;
  model: string;
  authentication?: "none" | "bearer";
  credentialRef?: string;
};

export type ModelProviderConfig = NoneModelProviderConfig | OllamaModelProviderConfig | OpenAICompatibleModelProviderConfig;

export type ModelProviderSettings = {
  mode: ModelPolicyMode;
  fallbackPolicy?: ModelFallbackPolicy;
  routes?: Partial<Record<ModelTask, string[]>>;
  defaultProviderIds?: string[];
};

export interface CredentialResolver {
  resolve(reference: string, signal?: AbortSignal): Promise<string | undefined>;
}

export type ModelProviderStatus = {
  id: string;
  label: string;
  kind: ModelProviderKind;
  privacy: ModelPrivacyBoundary;
  availability: "available" | "unavailable" | "disabled" | "blocked";
  capabilities: ModelCapability[];
  model?: string;
  endpoint?: string;
  latencyMs?: number;
  discoveredModels?: string[];
  errorCode?: string;
};

export interface ModelProvider {
  readonly id: string;
  readonly config: Readonly<ModelProviderConfig>;
  readonly privacy: ModelPrivacyBoundary;
  readonly capabilities: ReadonlySet<ModelCapability>;
  status(signal?: AbortSignal): Promise<ModelProviderStatus>;
  invoke(request: ModelInvocationRequest, signal?: AbortSignal): Promise<ModelInvocationResponse>;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ModelProviderDependencies = {
  fetch?: FetchLike;
  credentialResolver?: CredentialResolver;
  clock?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
};

const defaultCapabilities: ModelCapability[] = ["planning", "critique", "revision", "structured-output"];
const forbiddenConfigKeys = new Set(["apikey", "api_key", "token", "access_token", "password", "secret", "authorization", "headers", "credential", "credentials", "bearer", "bearertoken"]);
const commonProviderConfigKeys = new Set(["id", "label", "kind", "enabled", "capabilities", "requestTimeoutMs", "retryCount", "retryDelayMs", "maximumConcurrency", "maximumQueue", "contextWindow", "maximumOutputTokens"]);

function integerSetting(value: number | undefined, fallback: number, label: string, minimum: number, maximum: number) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  return resolved;
}

function validateIdentifier(value: string, label: string) {
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,79}$/.test(value)) throw new Error(`${label} must begin with a letter and contain only letters, digits, period, underscore, or hyphen.`);
  return value;
}

function validateNoPlaintextCredentials(value: unknown, path = "provider") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenConfigKeys.has(key.toLowerCase())) throw new Error(`PLAINTEXT_CREDENTIAL_FORBIDDEN: ${path}.${key} is not permitted; store the secret in the operating-system credential service and configure only credentialRef.`);
    if (nested && typeof nested === "object") validateNoPlaintextCredentials(nested, `${path}.${key}`);
  }
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(normalized);
  return Boolean(match && match.slice(1).every((part) => Number(part) <= 255) && Number(match[1]) === 127);
}

function validatedBaseUrl(value: string, privacy: Exclude<ModelPrivacyBoundary, "none">) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Model provider baseUrl must be an absolute URL.");
  }
  if (url.username || url.password || url.search || url.hash) throw new Error("Model provider baseUrl may not contain credentials, query parameters, or a fragment.");
  if (privacy === "local") {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Local model providers require an HTTP(S) loopback URL.");
    if (!isLoopbackHostname(url.hostname)) throw new Error("LOCAL_PROVIDER_NOT_LOOPBACK: local model providers may connect only to localhost or 127.0.0.0/8.");
  } else if (url.protocol !== "https:") {
    throw new Error("Cloud model providers require HTTPS.");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

function endpoint(baseUrl: string, relativePath: string) {
  return new URL(relativePath.replace(/^\//, ""), baseUrl).toString();
}

function validateCredentialReference(value: string | undefined) {
  if (!value || value.length > 240 || !/^[A-Za-z][A-Za-z0-9+.-]*:[A-Za-z0-9._/@-]+$/.test(value)) {
    throw new Error("credentialRef must be a short operating-system credential reference such as wincred:blockwright/provider-name.");
  }
  return value;
}

export function validateModelProviderConfig(raw: ModelProviderConfig): Readonly<ModelProviderConfig> {
  validateNoPlaintextCredentials(raw);
  const allowedKeys = new Set(commonProviderConfigKeys);
  if (raw.kind === "ollama") ["baseUrl", "model"].forEach((key) => allowedKeys.add(key));
  if (raw.kind === "openai-compatible-local" || raw.kind === "openai-compatible-cloud") ["baseUrl", "model", "family", "authentication", "credentialRef"].forEach((key) => allowedKeys.add(key));
  const unknownKey = Object.keys(raw).find((key) => !allowedKeys.has(key));
  if (unknownKey) throw new Error(`Unsupported model provider setting: ${unknownKey}.`);
  validateIdentifier(raw.id, "provider id");
  if (!raw.label?.trim() || raw.label.length > 120) throw new Error("provider label must contain 1-120 characters.");
  const capabilities = [...new Set(raw.capabilities ?? (raw.kind === "none" ? [] : defaultCapabilities))];
  if (capabilities.some((capability) => ![...MODEL_TASKS, "structured-output"].includes(capability))) throw new Error("Provider capabilities contain an unsupported value.");
  const common = {
    ...raw,
    label: raw.label.trim(),
    enabled: raw.enabled ?? true,
    capabilities,
    requestTimeoutMs: integerSetting(raw.requestTimeoutMs, 30_000, "requestTimeoutMs", 100, 10 * 60_000),
    retryCount: integerSetting(raw.retryCount, 0, "retryCount", 0, 5),
    retryDelayMs: integerSetting(raw.retryDelayMs, 250, "retryDelayMs", 0, 30_000),
    maximumConcurrency: integerSetting(raw.maximumConcurrency, 1, "maximumConcurrency", 1, 16),
    maximumQueue: integerSetting(raw.maximumQueue, 8, "maximumQueue", 0, 256),
    ...(raw.contextWindow === undefined ? {} : { contextWindow: integerSetting(raw.contextWindow, raw.contextWindow, "contextWindow", 256, 10_000_000) }),
    ...(raw.maximumOutputTokens === undefined ? {} : { maximumOutputTokens: integerSetting(raw.maximumOutputTokens, raw.maximumOutputTokens, "maximumOutputTokens", 1, 1_000_000) }),
  };
  if (raw.kind === "none") return Object.freeze({ ...common, kind: "none" });
  if (!raw.model?.trim() || raw.model.length > 240) throw new Error("Model providers require a model name of 1-240 characters.");
  if (raw.kind === "ollama") return Object.freeze({ ...common, kind: raw.kind, model: raw.model.trim(), baseUrl: validatedBaseUrl(raw.baseUrl, "local") });
  const privacy = raw.kind === "openai-compatible-local" ? "local" : "cloud";
  const authentication = raw.authentication ?? (privacy === "cloud" ? "bearer" : "none");
  const credentialRef = authentication === "bearer" ? validateCredentialReference(raw.credentialRef) : undefined;
  if (authentication === "none" && raw.credentialRef) throw new Error("credentialRef cannot be configured when authentication is none.");
  return Object.freeze({
    ...common,
    kind: raw.kind,
    family: raw.family ?? "generic",
    model: raw.model.trim(),
    baseUrl: validatedBaseUrl(raw.baseUrl, privacy),
    authentication,
    ...(credentialRef ? { credentialRef } : {}),
  });
}

export class ModelProviderError extends ManagedTaskError {
  readonly providerId?: string;

  constructor(input: {
    code: string;
    message: string;
    likelyCause: string;
    retrySafe: boolean;
    retryReason: string;
    recommendedAction: string;
    providerId?: string;
    cause?: unknown;
  }) {
    super({ ...input, component: input.providerId ? `model-provider:${input.providerId}` : "model-provider" });
    this.name = "ModelProviderError";
    this.providerId = input.providerId;
  }
}

function providerError(input: Partial<ConstructorParameters<typeof ModelProviderError>[0]> & Pick<ConstructorParameters<typeof ModelProviderError>[0], "code" | "message">) {
  return new ModelProviderError({
    likelyCause: "The configured model provider could not complete the request.",
    retrySafe: false,
    retryReason: "The provider did not identify this failure as safe to retry.",
    recommendedAction: "Test the provider configuration and review its local logs before retrying.",
    ...input,
  });
}

class AbortableSemaphore {
  private active = 0;
  private readonly waiting: Array<{ resolve: (release: () => void) => void; reject: (error: Error) => void; signal?: AbortSignal; abort?: () => void }> = [];

  constructor(private readonly maximum: number, private readonly maximumQueue: number, private readonly providerId: string) {}

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(providerError({
      code: "MODEL_REQUEST_CANCELLED",
      message: "The model request was cancelled before provider execution.",
      likelyCause: "The caller aborted the request.",
      retrySafe: true,
      retryReason: "The provider request did not begin.",
      recommendedAction: "Retry only if model assistance is still needed.",
      providerId: this.providerId,
    }));
    if (this.active < this.maximum) {
      this.active += 1;
      return Promise.resolve(this.releaseHandle());
    }
    if (this.waiting.length >= this.maximumQueue) return Promise.reject(providerError({
      code: "MODEL_PROVIDER_BUSY",
      message: "The model provider queue is full.",
      likelyCause: "The provider has reached its configured concurrency and queue limits.",
      retrySafe: true,
      retryReason: "No provider request was started.",
      recommendedAction: "Wait for another model task to finish or choose a different allowed provider.",
      providerId: this.providerId,
    }));
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, abort: undefined as (() => void) | undefined };
      waiter.abort = () => {
        const index = this.waiting.indexOf(waiter);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(providerError({
          code: "MODEL_REQUEST_CANCELLED",
          message: "The queued model request was cancelled.",
          likelyCause: "The caller aborted while waiting for provider capacity.",
          retrySafe: true,
          retryReason: "No provider request was started.",
          recommendedAction: "Retry only if model assistance is still needed.",
          providerId: this.providerId,
        }));
      };
      signal?.addEventListener("abort", waiter.abort, { once: true });
      this.waiting.push(waiter);
    });
  }

  private releaseHandle() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const waiter = this.waiting.shift();
      if (waiter) {
        waiter.signal?.removeEventListener("abort", waiter.abort!);
        waiter.resolve(this.releaseHandle());
      } else {
        this.active = Math.max(0, this.active - 1);
      }
    };
  }
}

function defaultSleep(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = () => {
      clearTimeout(timeout);
      reject(signal?.reason);
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    timeout.unref();
    signal?.addEventListener("abort", abort, { once: true });
  });
}

abstract class HttpModelProvider implements ModelProvider {
  readonly id: string;
  readonly config: Readonly<Exclude<ModelProviderConfig, NoneModelProviderConfig>>;
  readonly privacy: Exclude<ModelPrivacyBoundary, "none">;
  readonly capabilities: ReadonlySet<ModelCapability>;
  protected readonly fetch: FetchLike;
  protected readonly credentialResolver?: CredentialResolver;
  protected readonly clock: () => number;
  private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  private readonly semaphore: AbortableSemaphore;

  constructor(config: Exclude<ModelProviderConfig, NoneModelProviderConfig>, dependencies: ModelProviderDependencies) {
    this.config = validateModelProviderConfig(config) as Readonly<Exclude<ModelProviderConfig, NoneModelProviderConfig>>;
    this.id = this.config.id;
    this.privacy = this.config.kind === "openai-compatible-cloud" ? "cloud" : "local";
    this.capabilities = new Set(this.config.capabilities);
    this.fetch = dependencies.fetch ?? fetch;
    this.credentialResolver = dependencies.credentialResolver;
    this.clock = dependencies.clock ?? (() => performance.now());
    this.sleep = dependencies.sleep ?? defaultSleep;
    this.semaphore = new AbortableSemaphore(this.config.maximumConcurrency!, this.config.maximumQueue!, this.id);
  }

  protected abstract invokeOnce(request: ModelInvocationRequest, signal?: AbortSignal): Promise<ModelInvocationResponse>;
  protected abstract probeOnce(signal?: AbortSignal): Promise<string[]>;

  private async withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("Model provider request timed out."));
    }, this.config.requestTimeoutMs);
    timeout.unref();
    try {
      return await operation(controller.signal);
    } catch (error) {
      if (timedOut) throw providerError({
        code: "MODEL_PROVIDER_TIMEOUT",
        message: `The model provider exceeded its ${this.config.requestTimeoutMs}-millisecond deadline.`,
        likelyCause: "The provider was unavailable, overloaded, or the selected model took too long.",
        retrySafe: false,
        retryReason: "The remote provider may have received the request, so an automatic retry could duplicate cost.",
        recommendedAction: "Check provider status or explicitly retry with a longer timeout or another allowed provider.",
        providerId: this.id,
      });
      if (signal?.aborted) throw providerError({
        code: "MODEL_REQUEST_CANCELLED",
        message: "The model request was cancelled.",
        likelyCause: "The caller aborted the request.",
        retrySafe: true,
        retryReason: "No model response was accepted by Blockwright.",
        recommendedAction: "Retry only if model assistance is still needed.",
        providerId: this.id,
      });
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }

  async invoke(request: ModelInvocationRequest, signal?: AbortSignal): Promise<ModelInvocationResponse> {
    if (!this.config.enabled) throw providerError({
      code: "MODEL_PROVIDER_DISABLED",
      message: "The selected model provider is disabled.",
      likelyCause: "The provider was disabled in settings.",
      retrySafe: false,
      retryReason: "Retrying does not change provider settings.",
      recommendedAction: "Enable the provider or select another allowed provider.",
      providerId: this.id,
    });
    if (!this.capabilities.has(request.task)) throw providerError({
      code: "MODEL_CAPABILITY_UNAVAILABLE",
      message: `The selected provider does not advertise the ${request.task} capability.`,
      likelyCause: "The task route and provider capabilities do not match.",
      retrySafe: false,
      retryReason: "Retrying the same provider cannot add the missing capability.",
      recommendedAction: "Select a provider that advertises the required capability.",
      providerId: this.id,
    });
    const release = await this.semaphore.acquire(signal);
    try {
      const attempts = request.allowRetry ? this.config.retryCount! + 1 : 1;
      let lastError: unknown;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          return await this.withTimeout((boundedSignal) => this.invokeOnce(request, boundedSignal), signal);
        } catch (error) {
          lastError = error;
          if (!(error instanceof ModelProviderError) || !error.retrySafe || attempt + 1 >= attempts) throw error;
          await this.sleep(this.config.retryDelayMs!, signal);
        }
      }
      throw lastError;
    } finally {
      release();
    }
  }

  async status(signal?: AbortSignal): Promise<ModelProviderStatus> {
    const base: ModelProviderStatus = {
      id: this.id,
      label: this.config.label,
      kind: this.config.kind,
      privacy: this.privacy,
      availability: this.config.enabled ? "unavailable" : "disabled",
      capabilities: [...this.capabilities],
      model: this.config.model,
      endpoint: this.config.baseUrl,
    };
    if (!this.config.enabled) return base;
    const started = this.clock();
    try {
      const discoveredModels = await this.withTimeout((boundedSignal) => this.probeOnce(boundedSignal), signal);
      return { ...base, availability: "available", latencyMs: Math.max(0, Math.round(this.clock() - started)), discoveredModels };
    } catch (error) {
      return { ...base, availability: "unavailable", latencyMs: Math.max(0, Math.round(this.clock() - started)), errorCode: error instanceof ManagedTaskError ? error.code : "MODEL_PROVIDER_UNAVAILABLE" };
    }
  }

  protected async credential(signal?: AbortSignal) {
    if (this.config.kind === "ollama" || this.config.authentication === "none") return undefined;
    if (!this.credentialResolver) throw providerError({
      code: "MODEL_CREDENTIAL_RESOLVER_UNAVAILABLE",
      message: "The configured credential reference cannot be resolved on this runtime.",
      likelyCause: "No operating-system credential resolver was installed for the service.",
      retrySafe: false,
      retryReason: "Retrying cannot install a credential resolver.",
      recommendedAction: "Configure the operating-system credential integration, then test the provider again.",
      providerId: this.id,
    });
    const secret = await this.credentialResolver.resolve(this.config.credentialRef!, signal);
    if (!secret) throw providerError({
      code: "MODEL_CREDENTIAL_NOT_FOUND",
      message: "The operating-system credential reference did not resolve to a secret.",
      likelyCause: "The referenced credential was removed, renamed, or is unavailable to this account.",
      retrySafe: false,
      retryReason: "Retrying cannot restore a missing credential.",
      recommendedAction: "Save the provider credential again and retest the provider.",
      providerId: this.id,
    });
    return secret;
  }

  protected async checkedJson(response: Response) {
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw providerError({
        code: "MODEL_AUTHENTICATION_FAILED",
        message: "The model provider rejected its credential.",
        likelyCause: "The referenced credential is invalid, expired, or lacks access.",
        retrySafe: false,
        retryReason: "Retrying with the same credential is not expected to succeed.",
        recommendedAction: "Replace the operating-system credential reference and test the provider.",
        providerId: this.id,
      });
      if (response.status === 429) throw providerError({
        code: "MODEL_RATE_LIMITED",
        message: "The model provider is rate-limiting requests.",
        likelyCause: "The provider's request or token quota was exceeded.",
        retrySafe: true,
        retryReason: "No response content was accepted, and a later request may succeed.",
        recommendedAction: "Wait before retrying or reduce provider concurrency.",
        providerId: this.id,
      });
      if (response.status >= 500) throw providerError({
        code: "MODEL_PROVIDER_UNAVAILABLE",
        message: `The model provider returned HTTP ${response.status}.`,
        likelyCause: "The provider is temporarily unavailable or overloaded.",
        retrySafe: true,
        retryReason: "No response content was accepted, and the server reported a transient failure.",
        recommendedAction: "Retry later or use another provider allowed by the fallback policy.",
        providerId: this.id,
      });
      throw providerError({
        code: "MODEL_PROVIDER_REJECTED",
        message: `The model provider rejected the request with HTTP ${response.status}.`,
        likelyCause: "The selected model, request shape, or account policy is not accepted by the provider.",
        retrySafe: false,
        retryReason: "Retrying an unchanged rejected request is not expected to succeed.",
        recommendedAction: "Verify the model name and provider configuration before retrying.",
        providerId: this.id,
      });
    }
    try {
      return await response.json() as unknown;
    } catch (error) {
      throw providerError({
        code: "MODEL_INVALID_RESPONSE",
        message: "The model provider returned invalid JSON.",
        likelyCause: "The endpoint is incompatible or returned a proxy/error page.",
        retrySafe: false,
        retryReason: "Retrying the same incompatible endpoint is not expected to repair its response contract.",
        recommendedAction: "Verify that baseUrl points to the provider's API root.",
        providerId: this.id,
        cause: error,
      });
    }
  }
}

export class NoneModelProvider implements ModelProvider {
  readonly id: string;
  readonly config: Readonly<NoneModelProviderConfig>;
  readonly privacy = "none" as const;
  readonly capabilities = new Set<ModelCapability>();

  constructor(config: NoneModelProviderConfig = { id: "none", label: "No model", kind: "none" }) {
    this.config = validateModelProviderConfig(config) as Readonly<NoneModelProviderConfig>;
    this.id = this.config.id;
  }

  async status(): Promise<ModelProviderStatus> {
    return { id: this.id, label: this.config.label, kind: "none", privacy: "none", availability: "disabled", capabilities: [] };
  }

  async invoke(): Promise<ModelInvocationResponse> {
    throw providerError({
      code: "MODEL_DISABLED",
      message: "No model is configured for this operation.",
      likelyCause: "Blockwright is operating in explicit no-model mode.",
      retrySafe: false,
      retryReason: "Retrying cannot enable a provider.",
      recommendedAction: "Continue with deterministic/manual tools or explicitly configure an allowed provider.",
      providerId: this.id,
    });
  }
}

export class OllamaModelProvider extends HttpModelProvider {
  constructor(config: OllamaModelProviderConfig, dependencies: ModelProviderDependencies = {}) {
    super(config, dependencies);
  }

  protected async probeOnce(signal?: AbortSignal) {
    let response: Response;
    try {
      response = await this.fetch(endpoint(this.config.baseUrl, "api/tags"), { method: "GET", signal });
    } catch (error) {
      throw networkProviderError(this.id, error, true);
    }
    const json = await this.checkedJson(response) as { models?: Array<{ name?: unknown; model?: unknown }> };
    return Array.isArray(json.models) ? json.models.map((model) => typeof model.name === "string" ? model.name : typeof model.model === "string" ? model.model : "").filter(Boolean) : [];
  }

  protected async invokeOnce(request: ModelInvocationRequest, signal?: AbortSignal): Promise<ModelInvocationResponse> {
    const started = this.clock();
    let response: Response;
    try {
      response = await this.fetch(endpoint(this.config.baseUrl, "api/chat"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: request.model ?? this.config.model,
          messages: request.messages,
          stream: false,
          ...(request.json ? { format: "json" } : {}),
          ...((request.maximumOutputTokens ?? this.config.maximumOutputTokens) ? { options: { num_predict: request.maximumOutputTokens ?? this.config.maximumOutputTokens } } : {}),
        }),
        signal,
      });
    } catch (error) {
      throw networkProviderError(this.id, error, true);
    }
    const json = await this.checkedJson(response) as { model?: unknown; message?: { content?: unknown }; done_reason?: unknown; prompt_eval_count?: unknown; eval_count?: unknown };
    if (!json.message || typeof json.message.content !== "string") throw invalidResponseError(this.id, "Ollama response did not contain message.content.");
    return {
      providerId: this.id,
      model: typeof json.model === "string" ? json.model : request.model ?? this.config.model,
      content: json.message.content,
      ...(typeof json.done_reason === "string" ? { finishReason: json.done_reason } : {}),
      usage: {
        ...(Number.isSafeInteger(json.prompt_eval_count) ? { inputTokens: Number(json.prompt_eval_count) } : {}),
        ...(Number.isSafeInteger(json.eval_count) ? { outputTokens: Number(json.eval_count) } : {}),
      },
      latencyMs: Math.max(0, Math.round(this.clock() - started)),
    };
  }
}

export class OpenAICompatibleModelProvider extends HttpModelProvider {
  constructor(config: OpenAICompatibleModelProviderConfig, dependencies: ModelProviderDependencies = {}) {
    super(config, dependencies);
  }

  private async headers(signal?: AbortSignal) {
    const credential = await this.credential(signal);
    return { "content-type": "application/json", ...(credential ? { authorization: `Bearer ${credential}` } : {}) };
  }

  protected async probeOnce(signal?: AbortSignal) {
    let response: Response;
    try {
      response = await this.fetch(endpoint(this.config.baseUrl, "models"), { method: "GET", headers: await this.headers(signal), signal });
    } catch (error) {
      if (error instanceof ModelProviderError) throw error;
      throw networkProviderError(this.id, error, this.privacy === "local");
    }
    const json = await this.checkedJson(response) as { data?: Array<{ id?: unknown }> };
    return Array.isArray(json.data) ? json.data.map((model) => typeof model.id === "string" ? model.id : "").filter(Boolean) : [];
  }

  protected async invokeOnce(request: ModelInvocationRequest, signal?: AbortSignal): Promise<ModelInvocationResponse> {
    const started = this.clock();
    let response: Response;
    try {
      response = await this.fetch(endpoint(this.config.baseUrl, "chat/completions"), {
        method: "POST",
        headers: await this.headers(signal),
        body: JSON.stringify({
          model: request.model ?? this.config.model,
          messages: request.messages,
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...((request.maximumOutputTokens ?? this.config.maximumOutputTokens) ? { max_tokens: request.maximumOutputTokens ?? this.config.maximumOutputTokens } : {}),
          ...(request.json ? { response_format: { type: "json_object" } } : {}),
        }),
        signal,
      });
    } catch (error) {
      if (error instanceof ModelProviderError) throw error;
      throw networkProviderError(this.id, error, this.privacy === "local");
    }
    const json = await this.checkedJson(response) as {
      model?: unknown;
      choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    };
    const choice = json.choices?.[0];
    if (!choice?.message || typeof choice.message.content !== "string") throw invalidResponseError(this.id, "OpenAI-compatible response did not contain choices[0].message.content.");
    return {
      providerId: this.id,
      model: typeof json.model === "string" ? json.model : request.model ?? this.config.model,
      content: choice.message.content,
      ...(typeof choice.finish_reason === "string" ? { finishReason: choice.finish_reason } : {}),
      usage: {
        ...(Number.isSafeInteger(json.usage?.prompt_tokens) ? { inputTokens: Number(json.usage?.prompt_tokens) } : {}),
        ...(Number.isSafeInteger(json.usage?.completion_tokens) ? { outputTokens: Number(json.usage?.completion_tokens) } : {}),
      },
      latencyMs: Math.max(0, Math.round(this.clock() - started)),
    };
  }
}

function networkProviderError(providerId: string, cause: unknown, retrySafe: boolean) {
  return providerError({
    code: "MODEL_PROVIDER_UNAVAILABLE",
    message: "The model provider could not be reached.",
    likelyCause: "No compatible service is listening at the configured endpoint or the connection failed.",
    retrySafe,
    retryReason: retrySafe
      ? "The local provider produced no accepted response and repeating local computation has no external side effect."
      : "A cloud request may have reached the provider, so automatic retry or fallback could duplicate cost.",
    recommendedAction: retrySafe
      ? "Start or test the provider, then retry or choose another allowed local provider."
      : "Test provider status and explicitly retry only after reviewing possible cloud usage.",
    providerId,
    cause,
  });
}

function invalidResponseError(providerId: string, message: string) {
  return providerError({
    code: "MODEL_INVALID_RESPONSE",
    message,
    likelyCause: "The endpoint is not compatible with the selected provider adapter.",
    retrySafe: false,
    retryReason: "Retrying the same incompatible response contract is not expected to succeed.",
    recommendedAction: "Verify the provider family and API base URL.",
    providerId,
  });
}

export function createModelProvider(config: ModelProviderConfig, dependencies: ModelProviderDependencies = {}): ModelProvider {
  const validated = validateModelProviderConfig(config);
  if (validated.kind === "none") return new NoneModelProvider(validated);
  if (validated.kind === "ollama") return new OllamaModelProvider(validated, dependencies);
  return new OpenAICompatibleModelProvider(validated, dependencies);
}

function isAllowedByPolicy(provider: ModelProvider, mode: ModelPolicyMode) {
  if (provider.privacy === "none") return false;
  if (mode === "none") return false;
  if (provider.privacy === "cloud" && mode !== "allow-cloud") return false;
  return true;
}

export function validateModelProviderSettings(settings: ModelProviderSettings): Required<Pick<ModelProviderSettings, "mode" | "fallbackPolicy">> & ModelProviderSettings {
  const unknownKey = Object.keys(settings).find((key) => !["mode", "fallbackPolicy", "routes", "defaultProviderIds"].includes(key));
  if (unknownKey) throw new Error(`Unsupported model provider setting group: ${unknownKey}.`);
  if (!["none", "local-only", "cloud-disabled", "allow-cloud"].includes(settings.mode)) throw new Error("Unsupported model policy mode.");
  const fallbackPolicy = settings.fallbackPolicy ?? "disabled";
  if (!["disabled", "same-privacy", "explicit"].includes(fallbackPolicy)) throw new Error("Unsupported model fallback policy.");
  for (const [task, ids] of Object.entries(settings.routes ?? {})) {
    if (!MODEL_TASKS.includes(task as ModelTask) || !Array.isArray(ids)) throw new Error("Model routes contain an unsupported task.");
    ids.forEach((id) => validateIdentifier(id, "routed provider id"));
  }
  settings.defaultProviderIds?.forEach((id) => validateIdentifier(id, "default provider id"));
  return { ...settings, fallbackPolicy };
}

export class ModelProviderRegistry {
  readonly settings: Readonly<ModelProviderSettings>;
  private readonly providers = new Map<string, ModelProvider>();

  constructor(configs: ModelProviderConfig[], settings: ModelProviderSettings, dependencies: ModelProviderDependencies = {}) {
    this.settings = Object.freeze(validateModelProviderSettings(settings));
    const includesNone = configs.some(({ kind }) => kind === "none");
    for (const config of includesNone ? configs : [{ id: "none", label: "No model", kind: "none" } as const, ...configs]) {
      const provider = createModelProvider(config, dependencies);
      if (this.providers.has(provider.id)) throw new Error(`Duplicate model provider id: ${provider.id}.`);
      this.providers.set(provider.id, provider);
    }
  }

  get(providerId: string) {
    return this.providers.get(providerId);
  }

  async getStatus(providerId: string, signal?: AbortSignal): Promise<ModelProviderStatus> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Model provider ${providerId} was not found.`);
    if (!isAllowedByPolicy(provider, this.settings.mode) && provider.privacy !== "none") {
      return {
        id: provider.id,
        label: provider.config.label,
        kind: provider.config.kind,
        privacy: provider.privacy,
        availability: "blocked",
        capabilities: [...provider.capabilities],
        ...("model" in provider.config ? { model: provider.config.model } : {}),
        errorCode: "MODEL_PRIVACY_POLICY_BLOCKED",
      };
    }
    return provider.status(signal);
  }

  async listStatus(signal?: AbortSignal): Promise<ModelProviderStatus[]> {
    return Promise.all([...this.providers.keys()].map((id) => this.getStatus(id, signal)));
  }

  private candidateIds(request: ModelInvocationRequest) {
    if (request.providerId) return [validateIdentifier(request.providerId, "provider override")];
    return [...new Set(this.settings.routes?.[request.task] ?? this.settings.defaultProviderIds ?? [])];
  }

  async invoke(request: ModelInvocationRequest, signal?: AbortSignal): Promise<ModelRouteResult> {
    if (this.settings.mode === "none") return { status: "not_used", reason: "no_model", attemptedProviderIds: [] };
    const ids = this.candidateIds(request);
    if (!ids.length) return { status: "not_used", reason: "no_route", attemptedProviderIds: [] };
    const attemptedProviderIds: string[] = [];
    let firstPrivacy: ModelPrivacyBoundary | undefined;
    let lastError: ModelProviderError | undefined;
    let sawPolicyBlock = false;
    let sawCapabilityMiss = false;

    for (const id of ids) {
      const provider = this.providers.get(id);
      if (!provider || provider.privacy === "none") continue;
      if (!isAllowedByPolicy(provider, this.settings.mode)) {
        sawPolicyBlock = true;
        continue;
      }
      if (!provider.capabilities.has(request.task)) {
        sawCapabilityMiss = true;
        continue;
      }
      if (firstPrivacy === undefined) firstPrivacy = provider.privacy;
      else if (this.settings.fallbackPolicy === "disabled") break;
      else if (this.settings.fallbackPolicy === "same-privacy" && provider.privacy !== firstPrivacy) continue;

      attemptedProviderIds.push(provider.id);
      try {
        return { status: "completed", response: await provider.invoke(request, signal), attemptedProviderIds };
      } catch (error) {
        if (!(error instanceof ModelProviderError)) throw error;
        lastError = error;
        if (!error.retrySafe || request.providerId || this.settings.fallbackPolicy === "disabled") throw error;
      }
    }

    if (lastError) throw lastError;
    const reason = sawPolicyBlock ? "privacy_policy" : sawCapabilityMiss ? "capability_unavailable" : "no_route";
    if (request.required) throw providerError({
      code: reason === "privacy_policy" ? "MODEL_PRIVACY_POLICY_BLOCKED" : "MODEL_PROVIDER_UNAVAILABLE",
      message: reason === "privacy_policy" ? "No routed provider is permitted by the active privacy policy." : "No routed provider can perform the requested model task.",
      likelyCause: reason === "privacy_policy" ? "Cloud providers are disabled or local-only mode is active." : "No enabled route advertises the required capability.",
      retrySafe: false,
      retryReason: "Retrying cannot change provider policy or routing.",
      recommendedAction: "Continue without a model or explicitly update provider settings.",
    });
    return { status: "not_used", reason, attemptedProviderIds };
  }
}

export const DEFAULT_LOCAL_MODEL_ENDPOINTS = [
  { id: "ollama-local", label: "Ollama", kind: "ollama" as const, baseUrl: "http://127.0.0.1:11434/", model: "local" },
  { id: "lm-studio-local", label: "LM Studio", kind: "openai-compatible-local" as const, family: "lm-studio" as const, baseUrl: "http://127.0.0.1:1234/v1/", model: "local" },
  { id: "llama-cpp-local", label: "llama.cpp", kind: "openai-compatible-local" as const, family: "llama.cpp" as const, baseUrl: "http://127.0.0.1:8080/v1/", model: "local" },
] satisfies ModelProviderConfig[];

export type LocalModelDiscovery = {
  id: string;
  label: string;
  kind: Exclude<ModelProviderKind, "none" | "openai-compatible-cloud">;
  family?: OpenAICompatibleFamily;
  baseUrl: string;
  available: boolean;
  latencyMs?: number;
  models: string[];
  errorCode?: string;
};

export async function discoverLocalModelProviders(options: {
  targets?: ModelProviderConfig[];
  fetch?: FetchLike;
  timeoutMs?: number;
  signal?: AbortSignal;
} = {}): Promise<LocalModelDiscovery[]> {
  const targets = options.targets ?? DEFAULT_LOCAL_MODEL_ENDPOINTS;
  return Promise.all(targets.map(async (target) => {
    if (target.kind === "none" || target.kind === "openai-compatible-cloud") throw new Error("Local discovery accepts only local model provider targets.");
    const targetTimeout = "requestTimeoutMs" in target ? target.requestTimeoutMs : undefined;
    const config = validateModelProviderConfig({ ...target, requestTimeoutMs: options.timeoutMs ?? targetTimeout });
    if (config.kind === "none" || config.kind === "openai-compatible-cloud") throw new Error("Local discovery validation produced a non-local provider.");
    const provider = createModelProvider(config, { fetch: options.fetch });
    const status = await provider.status(options.signal);
    return {
      id: status.id,
      label: status.label,
      kind: status.kind as LocalModelDiscovery["kind"],
      ...(config.kind === "openai-compatible-local" ? { family: config.family } : {}),
      baseUrl: config.baseUrl,
      available: status.availability === "available",
      ...(status.latencyMs === undefined ? {} : { latencyMs: status.latencyMs }),
      models: status.discoveredModels ?? [],
      ...(status.errorCode ? { errorCode: status.errorCode } : {}),
    };
  }));
}

/** Returns a JSON-safe provider configuration and never resolves or exposes credentials. */
export function publicModelProviderConfig(config: ModelProviderConfig) {
  const validated = validateModelProviderConfig(config);
  return structuredClone(validated);
}

export function providerErrorSummary(error: unknown) {
  return error instanceof ModelProviderError
    ? { code: error.code, message: sanitizeDiagnosticText(error), retrySafe: error.retrySafe, recommendedAction: error.recommendedAction }
    : { code: "MODEL_PROVIDER_FAILED", message: sanitizeDiagnosticText(error), retrySafe: false, recommendedAction: "Test the provider configuration before retrying." };
}
