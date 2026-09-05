import { createHash, timingSafeEqual } from "node:crypto";
import { FixedWindowRateLimiter, sessionTokenFromHeaders } from "./hosted-service.js";
const publicPrincipal = (principal) => ({
    userId: principal.userId,
    tenantId: principal.tenantId,
    email: principal.email,
    tenantName: principal.tenantName,
    role: principal.role,
    plan: principal.plan,
    sessionExpiresAt: principal.sessionExpiresAt,
});
const publicProjectVersion = (version) => {
    const { payload, tenantDigest: _tenantDigest, ...metadata } = version;
    return {
        ...metadata,
        buildId: payload.build.id,
        buildHash: payload.build.hash,
        blockCount: payload.build.placements.length,
        contractStatus: payload.build.contract.status,
    };
};
const publicProjectSnapshot = (snapshot) => ({
    project: snapshot.project,
    ...(snapshot.head ? { head: publicProjectVersion(snapshot.head) } : {}),
    versions: snapshot.versions.map(({ tenantDigest: _tenantDigest, ...metadata }) => metadata),
});
const PUBLIC_REVIEW_PRIMARY_MATERIALS = 8;
const PUBLIC_MATERIAL_STATE_CHARS = 512;
const PROJECT_DIFF_MATERIAL_PAGE_SIZE = 100;
function publicText(value, maximum) {
    return value.slice(0, maximum);
}
function publicMaterialState(state) {
    if (state.length <= PUBLIC_MATERIAL_STATE_CHARS)
        return { state };
    return {
        state: state.slice(0, PUBLIC_MATERIAL_STATE_CHARS),
        truncated: true,
        stateSha256: createHash("sha256").update(state).digest("hex"),
    };
}
function publicReviewBuild(build) {
    const primary = [];
    let materialStateCount = 0;
    for (const state in build.materialCounts) {
        if (!Object.hasOwn(build.materialCounts, state))
            continue;
        materialStateCount += 1;
        primary.push([state, build.materialCounts[state]]);
        primary.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
        if (primary.length > PUBLIC_REVIEW_PRIMARY_MATERIALS)
            primary.pop();
    }
    const primaryMaterials = primary.map(([state, count]) => ({ ...publicMaterialState(state), count }));
    return {
        id: build.id,
        hash: build.hash,
        input: {
            name: publicText(build.input.name, 80),
            edition: build.input.edition,
            version: publicText(build.input.version, 128),
            style: publicText(build.input.style, 80),
            dimensions: build.input.dimensions,
        },
        bounds: { dimensions: build.bounds.dimensions },
        placementCount: build.placements.length,
        materialStateCount,
        primaryMaterials,
        contractStatus: build.contract.status,
        certificate: { status: build.certificate.status },
    };
}
function sendError(response, error, status = 400) {
    const message = error instanceof Error ? error.message : "The request could not be completed.";
    const guardedStatus = error instanceof Error && "httpStatus" in error && typeof error.httpStatus === "number"
        ? error.httpStatus
        : status;
    response.status(guardedStatus).json({ ok: false, error: message });
}
function routeError(message, httpStatus) {
    return Object.assign(new Error(message), { httpStatus });
}
function cookieOptions(expiresAt) {
    return {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        path: "/",
        ...(expiresAt ? { expires: new Date(expiresAt) } : {}),
    };
}
function secureTokenEqual(left, right) {
    if (!right)
        return false;
    const leftDigest = createHash("sha256").update(left).digest();
    const rightDigest = createHash("sha256").update(right).digest();
    return timingSafeEqual(leftDigest, rightDigest);
}
export function configureHostedRoutes(app, dependencies) {
    const { config, store, billing, projectStore, reviewService, resolveBuild } = dependencies;
    const limiter = new FixedWindowRateLimiter(config.rateLimitWindowMs, config.rateLimitRequests);
    const authLimiter = new FixedWindowRateLimiter(config.rateLimitWindowMs, config.authRateLimitRequests);
    const registrationLimiter = new FixedWindowRateLimiter(24 * 60 * 60_000, config.maxRegistrationsPerDay);
    const loginWorkLimiter = new FixedWindowRateLimiter(60_000, config.maxLoginsPerMinute);
    const publicReviewLoadLimiter = new FixedWindowRateLimiter(60_000, 12);
    const publicReviewTenantLoadLimiter = new FixedWindowRateLimiter(60_000, 4);
    const projectReadWorkLimiter = new FixedWindowRateLimiter(60_000, 60);
    const projectTenantReadWorkLimiter = new FixedWindowRateLimiter(60_000, 15);
    const publicReviewVersionCache = new Map();
    const publicReviewLoads = new Map();
    const publicReviewCacheTtlMs = 5 * 60_000;
    const publicReviewCacheEntries = 2;
    let publicReviewLoadsInFlight = 0;
    let projectReadsInFlight = 0;
    const projectReadsInFlightByTenant = new Map();
    let registrationsInFlight = 0;
    let loginsInFlight = 0;
    app.use("/api", (request, response, next) => {
        response.setHeader("cache-control", "no-store");
        response.setHeader("x-content-type-options", "nosniff");
        response.setHeader("referrer-policy", "no-referrer");
        const key = `${request.ip || request.socket.remoteAddress || "unknown"}:${request.path.startsWith("/auth/") ? "auth" : "api"}`;
        const limit = (request.path.startsWith("/auth/") ? authLimiter : limiter).consume(key);
        response.setHeader("ratelimit-limit", String(limit.limit));
        response.setHeader("ratelimit-remaining", String(limit.remaining));
        response.setHeader("ratelimit-reset", limit.resetAt);
        if (!limit.allowed) {
            response.status(429).json({ ok: false, error: "Too many requests. Try again after the rate-limit reset time.", resetAt: limit.resetAt });
            return;
        }
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.origin && config.baseUrl) {
            try {
                if (new URL(request.headers.origin).origin !== new URL(config.baseUrl).origin) {
                    response.status(403).json({ ok: false, error: "Cross-origin state changes are not permitted." });
                    return;
                }
            }
            catch {
                response.status(403).json({ ok: false, error: "Invalid request origin." });
                return;
            }
        }
        next();
    });
    const unavailable = (response) => {
        response.status(503).json({
            ok: false,
            error: config.enabled ? "Hosted service configuration is incomplete." : "Hosted service mode is disabled on this Blockwright instance.",
        });
    };
    const principalFor = (request, response) => {
        if (!store) {
            unavailable(response);
            return undefined;
        }
        const token = sessionTokenFromHeaders(request.headers.authorization, request.headers.cookie);
        const principal = token ? store.authenticate(token) : undefined;
        if (!principal) {
            response.status(401).json({ ok: false, error: "Sign in to continue." });
            return undefined;
        }
        return { principal, token: token };
    };
    const writerFor = async (request, response) => {
        const authenticated = principalFor(request, response);
        if (!authenticated)
            return undefined;
        if (authenticated.principal.role === "reviewer") {
            response.status(403).json({ ok: false, error: "Reviewer accounts have read-only workspace access." });
            return undefined;
        }
        if (billing && store) {
            let state = store.billingState(authenticated.principal.tenantId);
            const stale = Date.now() - Date.parse(state.updatedAt) > 15 * 60_000;
            if (stale && state.subscriptionId && state.customerId) {
                try {
                    state = store.setBillingState(await billing.refreshSubscription(authenticated.principal, state.subscriptionId, state.customerId));
                }
                catch {
                    response.status(503).json({ ok: false, error: "Subscription status could not be verified. No project data was changed." });
                    return undefined;
                }
            }
            if (state.status !== "active" && state.status !== "trialing") {
                response.status(402).json({ ok: false, error: "An active Studio subscription is required for hosted project changes." });
                return undefined;
            }
        }
        return authenticated;
    };
    const ownerFor = (request, response) => {
        const authenticated = principalFor(request, response);
        if (!authenticated)
            return undefined;
        if (authenticated.principal.role !== "owner") {
            response.status(403).json({ ok: false, error: "Workspace-owner authorization is required." });
            return undefined;
        }
        return authenticated;
    };
    const canonicalBuild = (value, principal) => {
        if (!resolveBuild)
            throw new Error("Canonical build validation is unavailable on this instance.");
        return resolveBuild(value, principal);
    };
    const pageValue = (value, fallback, minimum, maximum, label) => {
        const raw = value === undefined ? String(fallback) : typeof value === "string" ? value : "";
        if (!/^\d+$/.test(raw))
            throw routeError(`${label} must be a non-negative integer.`, 400);
        const parsed = Number(raw);
        if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
            throw routeError(`${label} must be between ${minimum} and ${maximum}.`, 400);
        }
        return parsed;
    };
    const withProjectRead = async (principal, operation) => {
        const tenantLimit = projectTenantReadWorkLimiter.consume(principal.tenantId);
        if (!tenantLimit.allowed)
            throw routeError("This workspace has reached its hosted project-read work limit. Retry after the rate-limit reset time.", 429);
        const globalLimit = projectReadWorkLimiter.consume("global");
        if (!globalLimit.allowed)
            throw routeError("Hosted project storage has reached its read-work limit. Retry after the rate-limit reset time.", 429);
        if ((projectReadsInFlightByTenant.get(principal.tenantId) ?? 0) >= 1) {
            throw routeError("This workspace already has a project read in progress. Retry shortly.", 503);
        }
        if (projectReadsInFlight >= 2)
            throw routeError("Hosted project storage is busy. Retry shortly.", 503);
        projectReadsInFlight += 1;
        projectReadsInFlightByTenant.set(principal.tenantId, 1);
        try {
            return await operation();
        }
        finally {
            projectReadsInFlight -= 1;
            projectReadsInFlightByTenant.delete(principal.tenantId);
        }
    };
    const reviewVersion = async (review) => {
        if (!projectStore)
            throw routeError("Hosted project storage is unavailable.", 503);
        const now = Date.now();
        for (const [key, cached] of publicReviewVersionCache) {
            if (now - cached.loadedAt > publicReviewCacheTtlMs)
                publicReviewVersionCache.delete(key);
        }
        const key = `${review.tenantId}:${review.projectId}:${review.versionId}:${review.buildHash}`;
        const cached = publicReviewVersionCache.get(key);
        if (cached) {
            cached.lastUsedAt = now;
            return cached.version;
        }
        const existing = publicReviewLoads.get(key);
        if (existing)
            return existing;
        const tenantLoadLimit = publicReviewTenantLoadLimiter.consume(review.tenantId);
        if (!tenantLoadLimit.allowed)
            throw routeError("This workspace's public review storage is busy. Retry after the rate-limit reset time.", 429);
        const loadLimit = publicReviewLoadLimiter.consume("global");
        if (!loadLimit.allowed)
            throw routeError("Public review storage is busy. Retry after the rate-limit reset time.", 429);
        if (publicReviewLoadsInFlight >= 1)
            throw routeError("Public review storage is busy. Retry shortly.", 503);
        const pending = (async () => {
            publicReviewLoadsInFlight += 1;
            try {
                const version = await projectStore.getVersion(review.tenantId, review.projectId, review.versionId);
                if (version.payload.build.hash !== review.buildHash)
                    throw new Error("Review snapshot no longer matches its immutable build hash.");
                publicReviewVersionCache.set(key, { version, loadedAt: now, lastUsedAt: now });
                while (publicReviewVersionCache.size > publicReviewCacheEntries) {
                    const oldest = [...publicReviewVersionCache.entries()].sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)[0]?.[0];
                    if (!oldest)
                        break;
                    publicReviewVersionCache.delete(oldest);
                }
                return version;
            }
            finally {
                publicReviewLoadsInFlight -= 1;
            }
        })();
        publicReviewLoads.set(key, pending);
        try {
            return await pending;
        }
        finally {
            publicReviewLoads.delete(key);
        }
    };
    app.get("/api/service/status", (_request, response) => {
        response.json({
            ok: true,
            mode: config.enabled ? "hosted" : "local",
            hostedReady: Boolean(store),
            billingConfigured: Boolean(billing),
            registrationAccessRequired: Boolean(config.registrationAccessKey),
            supportEmail: config.supportEmail,
            telemetryEnabled: config.telemetryEnabled,
            limits: { uploadBytes: config.maxUploadBytes, expandedBytes: config.maxExpandedBytes, maxTenants: config.maxTenants, registrationsPerDay: config.maxRegistrationsPerDay, loginsPerMinute: config.maxLoginsPerMinute, requestsPerWindow: config.rateLimitRequests, authRequestsPerWindow: config.authRateLimitRequests, windowMs: config.rateLimitWindowMs },
            configurationIssues: config.enabled && !store ? config.issues : [],
            capabilities: {
                localWorkbench: true,
                accounts: Boolean(store),
                tenantStorage: Boolean(store),
                deletion: Boolean(store),
                persistentProjects: Boolean(store && projectStore),
                clientReviewLinks: Boolean(store && projectStore && reviewService),
                checkout: Boolean(billing),
                invoices: Boolean(billing),
                refundRequests: Boolean(store && config.supportEmail),
            },
        });
    });
    app.post("/api/auth/register", async (request, response) => {
        if (!store)
            return unavailable(response);
        const body = request.body && typeof request.body === "object" ? request.body : {};
        const { accessKey } = body;
        if (config.registrationAccessKey && !secureTokenEqual(config.registrationAccessKey, typeof accessKey === "string" ? accessKey : undefined)) {
            response.status(403).json({ ok: false, error: "Account registration is not available with the supplied access key." });
            return;
        }
        const registrationLimit = registrationLimiter.consume("global");
        if (!registrationLimit.allowed) {
            response.setHeader("retry-after", String(Math.max(1, Math.ceil((Date.parse(registrationLimit.resetAt) - Date.now()) / 1_000))));
            response.status(429).json({ ok: false, error: "Account registration is temporarily at capacity. Try again after the registration window resets.", resetAt: registrationLimit.resetAt });
            return;
        }
        if (registrationsInFlight >= 2) {
            response.status(503).json({ ok: false, error: "Account registration is busy. Retry shortly." });
            return;
        }
        registrationsInFlight += 1;
        try {
            const { email, password, tenantName } = body;
            if (typeof email !== "string" || typeof password !== "string" || typeof tenantName !== "string")
                throw new Error("Email, password, and workspace name are required.");
            const registration = await store.register({ email, password, tenantName });
            response.cookie("bw_session", registration.token, cookieOptions(registration.expiresAt));
            response.status(201).json({ ok: true, account: publicPrincipal(registration.principal) });
        }
        catch (error) {
            sendError(response, error);
        }
        finally {
            registrationsInFlight -= 1;
        }
    });
    app.post("/api/auth/login", async (request, response) => {
        if (!store)
            return unavailable(response);
        const loginLimit = loginWorkLimiter.consume("global");
        if (!loginLimit.allowed) {
            response.setHeader("retry-after", String(Math.max(1, Math.ceil((Date.parse(loginLimit.resetAt) - Date.now()) / 1_000))));
            response.status(429).json({ ok: false, error: "Sign-in verification is temporarily at capacity. Try again after the login window resets.", resetAt: loginLimit.resetAt });
            return;
        }
        if (loginsInFlight >= 4) {
            response.status(503).json({ ok: false, error: "Sign-in verification is busy. Retry shortly." });
            return;
        }
        loginsInFlight += 1;
        try {
            const body = request.body && typeof request.body === "object" ? request.body : {};
            const { email, password } = body;
            if (typeof email !== "string" || typeof password !== "string")
                throw new Error("Email and password are required.");
            const login = await store.login({ email, password });
            response.cookie("bw_session", login.token, cookieOptions(login.expiresAt));
            response.json({ ok: true, account: publicPrincipal(login.principal) });
        }
        catch (error) {
            sendError(response, error, 401);
        }
        finally {
            loginsInFlight -= 1;
        }
    });
    app.post("/api/auth/logout", (request, response) => {
        const authenticated = principalFor(request, response);
        if (!authenticated || !store)
            return;
        store.logout(authenticated.token);
        response.clearCookie("bw_session", cookieOptions());
        response.json({ ok: true });
    });
    app.get("/api/me", (request, response) => {
        const authenticated = principalFor(request, response);
        if (!authenticated || !store)
            return;
        response.json({ ok: true, account: publicPrincipal(authenticated.principal), billing: store.billingState(authenticated.principal.tenantId) });
    });
    app.delete("/api/me", async (request, response) => {
        const authenticated = ownerFor(request, response);
        if (!authenticated || !store)
            return;
        try {
            if (projectStore)
                await projectStore.deleteTenant(authenticated.principal.tenantId);
            const result = store.deleteAccount(authenticated.principal);
            response.clearCookie("bw_session", cookieOptions());
            response.json({ ok: true, ...result });
        }
        catch (error) {
            sendError(response, error, 403);
        }
    });
    app.get("/api/billing", (request, response) => {
        const authenticated = principalFor(request, response);
        if (!authenticated || !store)
            return;
        response.json({ ok: true, billing: store.billingState(authenticated.principal.tenantId), configured: Boolean(billing) });
    });
    app.post("/api/billing/checkout", async (request, response) => {
        const authenticated = ownerFor(request, response);
        if (!authenticated)
            return;
        if (!billing)
            return response.status(503).json({ ok: false, error: "Checkout is not configured on this instance." });
        try {
            response.json({ ok: true, ...(await billing.createCheckout(authenticated.principal)) });
        }
        catch (error) {
            sendError(response, error, 502);
        }
    });
    app.post("/api/billing/confirm", async (request, response) => {
        const authenticated = ownerFor(request, response);
        if (!authenticated || !store)
            return;
        if (!billing)
            return response.status(503).json({ ok: false, error: "Checkout is not configured on this instance." });
        try {
            const sessionId = request.body.sessionId;
            if (typeof sessionId !== "string")
                throw new Error("Checkout session id is required.");
            const verified = await billing.confirmCheckout(authenticated.principal, sessionId);
            response.json({ ok: true, billing: store.setBillingState(verified) });
        }
        catch (error) {
            sendError(response, error, 400);
        }
    });
    app.post("/api/billing/portal", async (request, response) => {
        const authenticated = ownerFor(request, response);
        if (!authenticated || !store)
            return;
        if (!billing)
            return response.status(503).json({ ok: false, error: "Billing portal is not configured on this instance." });
        const state = store.billingState(authenticated.principal.tenantId);
        if (!state.customerId)
            return response.status(409).json({ ok: false, error: "This workspace does not have a confirmed billing customer." });
        try {
            response.json({ ok: true, ...(await billing.createPortal(authenticated.principal, state.customerId)) });
        }
        catch (error) {
            sendError(response, error, 502);
        }
    });
    app.get("/api/billing/invoices", async (request, response) => {
        const authenticated = ownerFor(request, response);
        if (!authenticated || !store)
            return;
        if (!billing)
            return response.status(503).json({ ok: false, error: "Invoices are not configured on this instance." });
        const state = store.billingState(authenticated.principal.tenantId);
        if (!state.customerId)
            return response.json({ ok: true, invoices: [] });
        try {
            response.json({ ok: true, invoices: await billing.listInvoices(state.customerId) });
        }
        catch (error) {
            sendError(response, error, 502);
        }
    });
    app.post("/api/billing/refund-request", (request, response) => {
        const authenticated = ownerFor(request, response);
        if (!authenticated || !store)
            return;
        try {
            const reason = request.body.reason;
            if (typeof reason !== "string")
                throw new Error("A reason is required.");
            response.status(202).json({ ok: true, request: store.requestRefund(authenticated.principal, reason), note: "This records a support request; it does not falsely report that funds were returned." });
        }
        catch (error) {
            sendError(response, error);
        }
    });
    app.post("/api/telemetry", (request, response) => {
        if (!store || !config.telemetryEnabled)
            return response.status(204).end();
        const authenticated = principalFor(request, response);
        if (!authenticated)
            return;
        try {
            const { eventName, quantity } = request.body;
            if (typeof eventName !== "string")
                throw new Error("Telemetry event name is required.");
            store.recordUsage(authenticated.principal, eventName, typeof quantity === "number" ? quantity : 1, 0);
            response.status(202).json({ ok: true });
        }
        catch (error) {
            sendError(response, error);
        }
    });
    app.get("/api/projects", async (request, response) => {
        const authenticated = principalFor(request, response);
        if (!authenticated)
            return;
        if (!projectStore)
            return unavailable(response);
        try {
            response.json({ ok: true, projects: await projectStore.listProjects(authenticated.principal.tenantId) });
        }
        catch (error) {
            sendError(response, error, 500);
        }
    });
    app.post("/api/projects", async (request, response) => {
        const authenticated = await writerFor(request, response);
        if (!authenticated)
            return;
        if (!projectStore)
            return unavailable(response);
        try {
            const { name, description, build: value } = request.body;
            if (typeof name !== "string")
                throw new Error("Project name is required.");
            const build = value === undefined ? undefined : canonicalBuild(value, authenticated.principal);
            const project = await projectStore.createProject({
                tenantId: authenticated.principal.tenantId,
                name,
                ...(typeof description === "string" ? { description } : {}),
                ...(build ? { initialVersion: { build, contract: build.contract, certificate: build.certificate } } : {}),
                createdBy: authenticated.principal.userId,
            });
            store?.recordUsage(authenticated.principal, "project_created");
            response.status(201).json({ ok: true, project: publicProjectSnapshot(project) });
        }
        catch (error) {
            sendError(response, error);
        }
    });
    app.get("/api/projects/:projectId", async (request, response) => {
        const authenticated = principalFor(request, response);
        if (!authenticated)
            return;
        if (!projectStore)
            return unavailable(response);
        try {
            const offset = pageValue(request.query.offset, 0, 0, 250_000, "Project placement offset");
            const limit = pageValue(request.query.limit, 1_000, 1, 1_000, "Project placement limit");
            response.json({
                ok: true,
                project: await withProjectRead(authenticated.principal, () => (projectStore.getProjectPage(authenticated.principal.tenantId, request.params.projectId, offset, limit))),
            });
        }
        catch (error) {
            sendError(response, error, 404);
        }
    });
    app.post("/api/projects/:projectId/versions", async (request, response) => {
        const authenticated = await writerFor(request, response);
        if (!authenticated)
            return;
        if (!projectStore)
            return unavailable(response);
        try {
            const { build: value, reason, expectedHeadVersionId } = request.body;
            const build = canonicalBuild(value, authenticated.principal);
            if (reason !== undefined && reason !== "manual" && reason !== "autosave" && reason !== "region_revision")
                throw new Error("Unsupported project version reason.");
            const version = await projectStore.saveVersion({
                tenantId: authenticated.principal.tenantId,
                projectId: request.params.projectId,
                payload: { build, contract: build.contract, certificate: build.certificate },
                reason: reason,
                createdBy: authenticated.principal.userId,
                ...(typeof expectedHeadVersionId === "string" ? { expectedHeadVersionId } : {}),
            });
            response.status(201).json({ ok: true, version: publicProjectVersion(version) });
        }
        catch (error) {
            sendError(response, error);
        }
    });
    app.get("/api/projects/:projectId/diff", async (request, response) => {
        const authenticated = principalFor(request, response);
        if (!authenticated)
            return;
        if (!projectStore)
            return unavailable(response);
        try {
            const before = request.query.before;
            const after = request.query.after;
            if (typeof before !== "string" || typeof after !== "string")
                throw new Error("Both before and after version ids are required.");
            const offset = pageValue(request.query.offset, 0, 0, 500_000, "Project diff offset");
            const limit = pageValue(request.query.limit, 500, 1, 500, "Project diff limit");
            const materialOffset = pageValue(request.query.materialOffset, 0, 0, 500_000, "Project material-diff offset");
            const materialLimit = pageValue(request.query.materialLimit, PROJECT_DIFF_MATERIAL_PAGE_SIZE, 1, PROJECT_DIFF_MATERIAL_PAGE_SIZE, "Project material-diff limit");
            const diff = await withProjectRead(authenticated.principal, () => (projectStore.compareVersionsPage(authenticated.principal.tenantId, request.params.projectId, before, after, offset, limit)));
            const { materialDeltas: _materialDeltas, ...summary } = diff;
            const materialItems = [];
            let materialDeltaCount = 0;
            for (const state in diff.materialDeltas) {
                if (!Object.hasOwn(diff.materialDeltas, state))
                    continue;
                if (materialDeltaCount >= materialOffset && materialItems.length < materialLimit) {
                    materialItems.push({ ...publicMaterialState(state), delta: diff.materialDeltas[state] });
                }
                materialDeltaCount += 1;
            }
            response.json({
                ok: true,
                diff: {
                    ...summary,
                    materialDeltaCount,
                    materialDeltas: {
                        offset: materialOffset,
                        limit: materialLimit,
                        returned: materialItems.length,
                        total: materialDeltaCount,
                        items: materialItems,
                    },
                },
            });
        }
        catch (error) {
            sendError(response, error);
        }
    });
    app.post("/api/projects/:projectId/restore", async (request, response) => {
        const authenticated = await writerFor(request, response);
        if (!authenticated)
            return;
        if (!projectStore)
            return unavailable(response);
        try {
            const { versionId, expectedHeadVersionId } = request.body;
            if (typeof versionId !== "string")
                throw new Error("Version id is required.");
            const version = await projectStore.restoreVersion({
                tenantId: authenticated.principal.tenantId,
                projectId: request.params.projectId,
                versionId,
                createdBy: authenticated.principal.userId,
                ...(typeof expectedHeadVersionId === "string" ? { expectedHeadVersionId } : {}),
            });
            response.status(201).json({ ok: true, version: publicProjectVersion(version) });
        }
        catch (error) {
            sendError(response, error);
        }
    });
    app.delete("/api/projects/:projectId", async (request, response) => {
        const authenticated = ownerFor(request, response);
        if (!authenticated)
            return;
        if (!projectStore)
            return unavailable(response);
        try {
            response.json({ ok: true, ...(await projectStore.deleteProject(authenticated.principal.tenantId, request.params.projectId)) });
        }
        catch (error) {
            sendError(response, error, 404);
        }
    });
    app.post("/api/projects/:projectId/review-links", async (request, response) => {
        const authenticated = await writerFor(request, response);
        if (!authenticated)
            return;
        if (!projectStore || !reviewService)
            return unavailable(response);
        try {
            const { versionId, expiresInSeconds } = request.body;
            if (typeof versionId !== "string")
                throw new Error("Project version id is required.");
            const version = await projectStore.getVersion(authenticated.principal.tenantId, request.params.projectId, versionId);
            const link = await reviewService.create({
                tenantId: authenticated.principal.tenantId,
                projectId: request.params.projectId,
                versionId,
                buildHash: version.payload.build.hash,
                createdBy: authenticated.principal.userId,
                ...(typeof expiresInSeconds === "number" ? { expiresInSeconds } : {}),
            });
            response.status(201).json({ ok: true, link });
        }
        catch (error) {
            sendError(response, error);
        }
    });
    app.delete("/api/review-links/:linkId", async (request, response) => {
        const authenticated = await writerFor(request, response);
        if (!authenticated)
            return;
        if (!reviewService)
            return unavailable(response);
        try {
            response.json({ ok: true, ...(await reviewService.revoke({ tenantId: authenticated.principal.tenantId, linkId: request.params.linkId })) });
        }
        catch (error) {
            sendError(response, error, 404);
        }
    });
    app.get("/api/review/:token", async (request, response) => {
        if (!projectStore || !reviewService)
            return unavailable(response);
        try {
            const review = await reviewService.resolve(request.params.token);
            const [project, version] = await Promise.all([
                projectStore.getProjectSummary(review.tenantId, review.projectId),
                reviewVersion(review),
            ]);
            response.json({
                ok: true,
                project: { id: project.id, name: project.name, description: project.description },
                version: { id: version.id, createdAt: version.createdAt, build: publicReviewBuild(version.payload.build) },
                review: { id: review.id, access: review.access, expiresAt: review.expiresAt, decisions: review.decisions },
            });
        }
        catch (error) {
            sendError(response, error, 404);
        }
    });
    app.get("/api/review/:token/placements", async (request, response) => {
        if (!projectStore || !reviewService)
            return unavailable(response);
        try {
            const offset = Number.parseInt(String(request.query.offset ?? "0"), 10);
            const limit = Number.parseInt(String(request.query.limit ?? "1000"), 10);
            if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
                throw new Error("Review placement page must use offset >= 0 and limit between 1 and 1000.");
            const review = await reviewService.resolve(request.params.token);
            const version = await reviewVersion(review);
            const placements = version.payload.build.placements.slice(offset, offset + limit);
            response.json({ ok: true, buildHash: review.buildHash, offset, returned: placements.length, total: version.payload.build.placements.length, placements });
        }
        catch (error) {
            sendError(response, error, 404);
        }
    });
    app.post("/api/review/:token/decision", async (request, response) => {
        if (!reviewService)
            return unavailable(response);
        try {
            const { actorId, decision, comment } = request.body;
            if (typeof actorId !== "string" || (decision !== "approved" && decision !== "changes_requested"))
                throw new Error("Reviewer name and a supported decision are required.");
            const event = await reviewService.recordDecision({ token: request.params.token, actorId, decision, ...(typeof comment === "string" ? { comment } : {}) });
            response.status(201).json({ ok: true, event });
        }
        catch (error) {
            sendError(response, error);
        }
    });
    app.get("/api/operator/metrics", (request, response) => {
        if (!store || !config.operatorToken)
            return unavailable(response);
        const token = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7).trim() : "";
        if (!secureTokenEqual(token, config.operatorToken))
            return response.status(401).json({ ok: false, error: "Operator authorization is required." });
        const counts = store.database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM tenants) AS tenants,
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM sessions WHERE expires_at > ?) AS active_sessions,
        (SELECT COUNT(*) FROM refund_requests WHERE status = 'requested') AS pending_refunds
    `).get(new Date().toISOString());
        response.json({ ok: true, counts, usage: store.usage(), note: "Aggregates exclude passwords, tokens, build contents, world contents, and customer file paths." });
    });
}
//# sourceMappingURL=hosted-routes.js.map