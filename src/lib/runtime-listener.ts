import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isIP } from "node:net";

const LOCAL_BIND_ADDRESS = "127.0.0.1";
const MINIMUM_LOCAL_TOKEN_CHARACTERS = 43;
const MAXIMUM_LOCAL_TOKEN_CHARACTERS = 128;

type RunResult = { fetch: (...args: unknown[]) => unknown } | ((request: IncomingMessage, response: ServerResponse) => void) | undefined;
type RunnableServer = { run(): Promise<RunResult> };
type RuntimeOptions = {
  hostedMode: boolean;
  maximumJsonBodyBytes: number;
  maximumConcurrentJsonBodies?: number;
  maximumJsonBodiesPerMinute?: number;
  maximumJsonBodiesPerClientPerMinute?: number;
  maximumConcurrentJsonBodiesPerClient?: number;
  incompleteJsonBodyTimeoutMs?: number;
  trustProxyHops?: number;
  verifyHostedMcpBeforeJson?: (request: IncomingMessage) => void;
};
type IngressRequest = IncomingMessage & { blockwrightIngressClientAddress?: string };

function configuredPort() {
  const raw = process.env.__PORT ?? "3000";
  if (!/^\d{1,5}$/.test(raw)) throw new Error("Blockwright local runtime port must be an integer from 1 through 65535.");
  const port = Number.parseInt(raw, 10);
  if (port < 1 || port > 65_535) throw new Error("Blockwright local runtime port must be an integer from 1 through 65535.");
  return port;
}

function isCloudflareWorkersRuntime() {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

export function isStrongLocalMcpToken(token: string | undefined): token is string {
  return Boolean(
    token
    && token.length >= MINIMUM_LOCAL_TOKEN_CHARACTERS
    && token.length <= MAXIMUM_LOCAL_TOKEN_CHARACTERS
    && /^[A-Za-z0-9_-]+$/.test(token),
  );
}

function secureTokenEqual(expected: string, actual: string | undefined) {
  if (!actual) return false;
  const expectedDigest = createHash("sha256").update(expected).digest();
  const actualDigest = createHash("sha256").update(actual).digest();
  return timingSafeEqual(expectedDigest, actualDigest);
}

function expectedAuthorities(port: number) {
  const suffix = port === 80 ? "" : `:${port}`;
  return new Set([`127.0.0.1${suffix}`, `localhost${suffix}`]);
}

function isAllowedAuthority(value: string | string[] | undefined, port: number) {
  return typeof value === "string" && expectedAuthorities(port).has(value.trim().toLowerCase());
}

function isAllowedOrigin(value: string | string[] | undefined, port: number) {
  if (value === undefined) return true;
  if (typeof value !== "string") return false;
  try {
    const origin = new URL(value);
    return origin.protocol === "http:" && expectedAuthorities(port).has(origin.host.toLowerCase()) && origin.origin === value;
  } catch {
    return false;
  }
}

function isLoopbackPeer(address: string | undefined) {
  return address === LOCAL_BIND_ADDRESS || address === "::1" || address === `::ffff:${LOCAL_BIND_ADDRESS}`;
}

export function trustedClientAddress(request: IncomingMessage, trustProxyHops = 0) {
  const socketAddress = request.socket.remoteAddress || "unknown";
  if (trustProxyHops <= 0) return socketAddress;
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded !== "string") return socketAddress;
  const addresses = forwarded.split(",").map((value) => value.trim());
  if (addresses.length < trustProxyHops || addresses.some((value) => isIP(value) === 0)) return socketAddress;
  return addresses[addresses.length - trustProxyHops] || socketAddress;
}

function bearerToken(header: string | string[] | undefined) {
  if (typeof header !== "string") return undefined;
  return /^Bearer ([A-Za-z0-9_-]+)$/i.exec(header)?.[1];
}

function requestPathFromTarget(target: string | undefined) {
  return (target ?? "/").split("?", 1)[0];
}

function requestPath(request: IncomingMessage) {
  return requestPathFromTarget(request.url);
}

export function isCanonicalMcpRequestTarget(target: string | undefined) {
  const disposition = mcpRequestTargetDisposition(target);
  return disposition === "canonical" || disposition === "trailing-slash";
}

function normalizedPathCandidate(value: string) {
  const segments: string[] = [];
  for (const segment of value.replaceAll("\\", "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join("/")}${value.endsWith("/") ? "/" : ""}`;
}

function couldReachExpressMcpMount(path: string) {
  let candidate = path;
  for (let pass = 0; pass < 4; pass += 1) {
    const withForwardSlashes = candidate.replaceAll("\\", "/");
    if (/^\/mcp(?:\/|$)/i.test(withForwardSlashes) || /^\/mcp(?:\/|$)/i.test(normalizedPathCandidate(withForwardSlashes))) {
      return true;
    }
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) break;
      candidate = decoded;
    } catch {
      break;
    }
  }
  return false;
}

export function mcpRequestTargetDisposition(target: string | undefined): "canonical" | "trailing-slash" | "invalid" | "other" {
  const path = requestPathFromTarget(target);
  if (path === "/mcp") return "canonical";
  if (path === "/mcp/") return "trailing-slash";
  return couldReachExpressMcpMount(path) ? "invalid" : "other";
}

function canonicalizeMcpRequestTarget(request: IncomingMessage) {
  if (requestPath(request) !== "/mcp/") return;
  const target = request.url ?? "/mcp/";
  const queryIndex = target.indexOf("?");
  request.url = queryIndex < 0 ? "/mcp" : `/mcp${target.slice(queryIndex)}`;
}

function guardedJsonPath(request: IncomingMessage) {
  const path = requestPath(request);
  return path === "/mcp" || path === "/api" || path.startsWith("/api/");
}

function reject(response: ServerResponse, statusCode: number, message: string, authenticate = false, extra: Record<string, unknown> = {}) {
  response.statusCode = statusCode;
  response.setHeader("cache-control", "no-store");
  response.setHeader("connection", "close");
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("x-content-type-options", "nosniff");
  if (authenticate) response.setHeader("www-authenticate", "Bearer realm=\"Blockwright local MCP\"");
  response.end(JSON.stringify({ ok: false, error: message, ...extra }));
}

function isJsonRequest(request: IncomingMessage) {
  const contentType = request.headers["content-type"];
  const value = Array.isArray(contentType) ? contentType[0] : contentType;
  return typeof value === "string" && /^application\/(?:[A-Za-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(value.trim());
}

function declaredBodyLength(request: IncomingMessage) {
  if (request.headers["transfer-encoding"] !== undefined) return undefined;
  const contentLength = request.headers["content-length"];
  if (typeof contentLength !== "string" || !/^\d+$/.test(contentLength)) return undefined;
  const value = Number(contentLength);
  return Number.isSafeInteger(value) ? value : undefined;
}

function rejectHostedVerification(response: ServerResponse, error: unknown) {
  const guarded = error as Error & { code?: string; limit?: { limit: number; remaining: number; resetAt: string } };
  if (guarded.code === "HOSTED_MCP_RATE_LIMITED") {
    if (guarded.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(guarded.limit.resetAt) - Date.now()) / 1_000));
      response.setHeader("ratelimit-limit", String(guarded.limit.limit));
      response.setHeader("ratelimit-remaining", String(guarded.limit.remaining));
      response.setHeader("ratelimit-reset", guarded.limit.resetAt);
      response.setHeader("retry-after", String(retryAfterSeconds));
    }
    reject(
      response,
      429,
      "Too many hosted MCP requests. Try again after the rate-limit reset time.",
      false,
      guarded.limit ? { resetAt: guarded.limit.resetAt } : {},
    );
    return;
  }
  if (guarded.code === "HOSTED_MCP_STUDIO_REQUIRED") {
    reject(response, 402, "A Studio subscription is required to use hosted Blockwright MCP.");
    return;
  }
  if (guarded.code === "HOSTED_MCP_AUTH_REQUIRED") {
    reject(response, 401, "Sign in to use hosted Blockwright MCP.", true);
    return;
  }
  reject(response, 503, "Hosted MCP ingress validation is unavailable.");
}

function createProductionRequestBoundary(
  application: (request: IncomingMessage, response: ServerResponse) => void,
  port: number,
  options: RuntimeOptions,
  token?: string,
) {
  const maximumConcurrentJsonBodies = options.maximumConcurrentJsonBodies ?? 32;
  const maximumJsonBodiesPerMinute = options.maximumJsonBodiesPerMinute ?? 240;
  const maximumJsonBodiesPerClientPerMinute = options.maximumJsonBodiesPerClientPerMinute ?? 60;
  const maximumConcurrentJsonBodiesPerClient = options.maximumConcurrentJsonBodiesPerClient ?? 2;
  const incompleteJsonBodyTimeoutMs = options.incompleteJsonBodyTimeoutMs ?? 10_000;
  let activeJsonBodies = 0;
  const activeJsonBodiesByClient = new Map<string, number>();
  let jsonWindowStartedAt = Date.now();
  let jsonBodiesStarted = 0;
  const jsonBodiesStartedByClient = new Map<string, number>();
  return (request: IncomingMessage, response: ServerResponse) => {
    if (!request.url?.startsWith("/")) {
      reject(response, 400, "Blockwright accepts only origin-form HTTP request targets.");
      return;
    }
    const ingressRequest = request as IngressRequest;
    const clientAddress = trustedClientAddress(request, options.hostedMode ? options.trustProxyHops : 0);
    ingressRequest.blockwrightIngressClientAddress = clientAddress;
    const mcpDisposition = mcpRequestTargetDisposition(request.url);
    const isMcpRequest = mcpDisposition === "canonical" || mcpDisposition === "trailing-slash";
    if (!options.hostedMode && (!isAllowedAuthority(request.headers.host, port) || !isLoopbackPeer(request.socket.remoteAddress))) {
      reject(response, 403, "This Blockwright instance accepts requests only through its local loopback endpoint.");
      return;
    }
    if (mcpDisposition === "invalid") {
      reject(response, 404, "The Blockwright MCP endpoint is available only at /mcp.");
      return;
    }
    if (!options.hostedMode) {
      if (isMcpRequest) {
        if (!isAllowedOrigin(request.headers.origin, port)) {
          reject(response, 403, "Cross-origin access to the local Blockwright MCP endpoint is not permitted.");
          return;
        }
        if (!token || !secureTokenEqual(token, bearerToken(request.headers.authorization))) {
          reject(response, 401, "A valid per-launch Blockwright token is required.", true);
          return;
        }
      }
    } else if (isMcpRequest && options.verifyHostedMcpBeforeJson) {
      try {
        options.verifyHostedMcpBeforeJson(request);
      } catch (error) {
        rejectHostedVerification(response, error);
        return;
      }
    }
    if (isMcpRequest) canonicalizeMcpRequestTarget(request);

    let releaseBodySlot: (() => void) | undefined;
    if (guardedJsonPath(request) && isJsonRequest(request) && !["GET", "HEAD"].includes(request.method ?? "")) {
      const length = declaredBodyLength(request);
      if (length === undefined) {
        reject(response, 411, "JSON requests require one valid Content-Length header and may not use transfer encoding.");
        return;
      }
      if (length > options.maximumJsonBodyBytes) {
        reject(response, 413, "The JSON request exceeds this Blockwright instance's ingress limit.");
        return;
      }
      if (length > 0) {
        const now = Date.now();
        if (now - jsonWindowStartedAt >= 60_000) {
          jsonWindowStartedAt = now;
          jsonBodiesStarted = 0;
          jsonBodiesStartedByClient.clear();
        }
        const clientStarts = jsonBodiesStartedByClient.get(clientAddress) ?? 0;
        if (clientStarts >= maximumJsonBodiesPerClientPerMinute) {
          response.setHeader("retry-after", String(Math.max(1, Math.ceil((jsonWindowStartedAt + 60_000 - now) / 1_000))));
          reject(response, 429, "This client has reached its JSON request-start limit.");
          return;
        }
        if (jsonBodiesStarted >= maximumJsonBodiesPerMinute) {
          response.setHeader("retry-after", String(Math.max(1, Math.ceil((jsonWindowStartedAt + 60_000 - now) / 1_000))));
          reject(response, 429, "Blockwright has reached its global JSON request-start limit.");
          return;
        }
        if (activeJsonBodies >= maximumConcurrentJsonBodies) {
          response.setHeader("retry-after", "1");
          reject(response, 503, "Blockwright is already processing the maximum number of JSON request bodies.");
          return;
        }
        const clientBodies = activeJsonBodiesByClient.get(clientAddress) ?? 0;
        if (clientBodies >= maximumConcurrentJsonBodiesPerClient) {
          response.setHeader("retry-after", "1");
          reject(response, 503, "This client already has the maximum number of JSON request bodies in progress.");
          return;
        }
        jsonBodiesStarted += 1;
        jsonBodiesStartedByClient.set(clientAddress, clientStarts + 1);
        activeJsonBodies += 1;
        activeJsonBodiesByClient.set(clientAddress, clientBodies + 1);
        let released = false;
        const incompleteBodyTimer = setTimeout(() => {
          if (released) return;
          if (!response.headersSent) reject(response, 408, "The JSON request body was not completed within the ingress timeout.");
          request.destroy();
          releaseBodySlot?.();
        }, incompleteJsonBodyTimeoutMs);
        incompleteBodyTimer.unref();
        releaseBodySlot = () => {
          if (released) return;
          released = true;
          clearTimeout(incompleteBodyTimer);
          activeJsonBodies -= 1;
          const remainingForClient = (activeJsonBodiesByClient.get(clientAddress) ?? 1) - 1;
          if (remainingForClient > 0) activeJsonBodiesByClient.set(clientAddress, remainingForClient);
          else activeJsonBodiesByClient.delete(clientAddress);
        };
        request.once("end", releaseBodySlot);
        request.once("aborted", releaseBodySlot);
        request.once("close", releaseBodySlot);
      }
    }
    try {
      application(request, response);
    } catch (error) {
      releaseBodySlot?.();
      throw error;
    }
  };
}

function installShutdown(httpServer: HttpServer) {
  const shutdown = () => {
    process.off("SIGTERM", shutdown);
    process.off("SIGINT", shutdown);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3_000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

async function initializeAsHandler(server: RunnableServer) {
  const hadVercel = Object.prototype.hasOwnProperty.call(process.env, "VERCEL");
  const previousVercel = process.env.VERCEL;
  process.env.VERCEL = "1";
  try {
    const application = await server.run();
    if (typeof application !== "function") {
      throw new Error("Blockwright could not initialize the local Skybridge HTTP handler.");
    }
    return application;
  } finally {
    if (hadVercel) process.env.VERCEL = previousVercel;
    else delete process.env.VERCEL;
  }
}

async function runProductionNode(server: RunnableServer, options: RuntimeOptions) {
  const token = options.hostedMode ? undefined : process.env.BLOCKWRIGHT_LOCAL_MCP_TOKEN;
  if (!options.hostedMode && !isStrongLocalMcpToken(token)) {
    throw new Error(`Blockwright local production MCP requires a private ${MINIMUM_LOCAL_TOKEN_CHARACTERS}-to-${MAXIMUM_LOCAL_TOKEN_CHARACTERS}-character per-launch token.`);
  }
  const port = configuredPort();
  const application = await initializeAsHandler(server);
  const httpServer = createServer(createProductionRequestBoundary(application, port, options, token));
  await new Promise<void>((resolve, rejectPromise) => {
    const onError = (error: Error) => rejectPromise(error);
    httpServer.once("error", onError);
    const onListening = () => {
      httpServer.off("error", onError);
      resolve();
    };
    if (options.hostedMode) httpServer.listen(port, onListening);
    else httpServer.listen(port, LOCAL_BIND_ADDRESS, onListening);
  });
  installShutdown(httpServer);
  if (!options.hostedMode) console.log(`Blockwright listening on http://${LOCAL_BIND_ADDRESS}:${port}`);
  return undefined;
}

async function runLocalDevelopment(server: RunnableServer) {
  const port = configuredPort();
  const ownDescriptor = Object.getOwnPropertyDescriptor(HttpServer.prototype, "listen");
  const originalListen = HttpServer.prototype.listen;
  let intercepted = false;
  Object.defineProperty(HttpServer.prototype, "listen", {
    configurable: true,
    writable: true,
    value: function listenOnLoopback(this: HttpServer, ...args: unknown[]) {
      const requestedPort = typeof args[0] === "number" ? args[0] : Number.parseInt(String(args[0]), 10);
      if (!intercepted && requestedPort === port) {
        intercepted = true;
        if (typeof args[0] === "object" && args[0] !== null) {
          args[0] = { ...(args[0] as Record<string, unknown>), host: LOCAL_BIND_ADDRESS };
        } else if (typeof args[1] === "string") {
          args[1] = LOCAL_BIND_ADDRESS;
        } else {
          args.splice(1, 0, LOCAL_BIND_ADDRESS);
        }
      }
      return Reflect.apply(originalListen, this, args);
    },
  });
  try {
    const result = await server.run();
    if (!intercepted) throw new Error("Blockwright could not enforce the local development loopback listener.");
    return result;
  } finally {
    if (ownDescriptor) Object.defineProperty(HttpServer.prototype, "listen", ownDescriptor);
    else delete (HttpServer.prototype as unknown as { listen?: unknown }).listen;
  }
}

export async function runBlockwrightRuntime(server: RunnableServer, options: RuntimeOptions) {
  if (process.env.VERCEL === "1" || isCloudflareWorkersRuntime()) {
    // v0.6 persists identity, tenant deletion, and projects through filesystem-backed stores.
    // A request-lifetime filesystem cannot provide those durability guarantees.
    if (process.env.NODE_ENV === "production") {
      throw new Error("Blockwright v0.6 production serverless hosting requires a durable hosted data adapter; use the bounded Node listener with a persistent volume.");
    }
    return server.run();
  }
  if (process.env.NODE_ENV === "production") return runProductionNode(server, options);
  if (options.hostedMode) return server.run();
  return runLocalDevelopment(server);
}
