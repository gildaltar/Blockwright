import { randomUUID } from "node:crypto";
export const TASK_STATES = [
    "queued",
    "preparing",
    "planning",
    "generating",
    "compiling",
    "validating",
    "auditing",
    "rendering",
    "exporting",
    "installing",
    "completed",
    "cancelling",
    "cancelled",
    "failed",
    "interrupted",
];
const terminalTaskStates = new Set(["completed", "cancelled", "failed", "interrupted"]);
export function isTerminalTaskState(state) {
    return terminalTaskStates.has(state);
}
/**
 * Translate internal result ownership into the client-facing availability
 * contract. A manager may consume its worker result after the service commits
 * an immutable summary elsewhere; clients can still retrieve that committed
 * result and must not be told it disappeared.
 */
export function exposeCommittedTaskResult(snapshot, committed) {
    if (!committed || snapshot.state !== "completed" || snapshot.resultAvailable)
        return snapshot;
    return { ...snapshot, resultAvailable: true };
}
export class ManagedTaskError extends Error {
    code;
    likelyCause;
    retrySafe;
    retryReason;
    recommendedAction;
    component;
    logReference;
    constructor(input) {
        super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
        this.name = "ManagedTaskError";
        this.code = normalizeDiagnosticCode(input.code);
        this.likelyCause = sanitizeDiagnosticText(input.likelyCause, 320);
        this.retrySafe = input.retrySafe;
        this.retryReason = sanitizeDiagnosticText(input.retryReason, 320);
        this.recommendedAction = sanitizeDiagnosticText(input.recommendedAction, 320);
        this.component = input.component ? sanitizeDiagnosticText(input.component, 120) : undefined;
        this.logReference = input.logReference;
    }
}
const secretAssignment = /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|credential)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const bearerToken = /\bBearer\s+[A-Za-z0-9._~+\/-]{6,}/gi;
const tokenLikeValue = /\b(?:sk|pk|tok|key)_[A-Za-z0-9._-]{8,}/g;
const userProfilePath = /\b[A-Za-z]:\\Users\\[^\\\s]+/gi;
export function sanitizeDiagnosticText(value, maximumLength = 512) {
    const raw = value instanceof Error ? value.message : typeof value === "string" ? value : String(value ?? "Unknown error");
    const sanitized = raw
        .replace(bearerToken, "Bearer [redacted]")
        .replace(secretAssignment, (_match, key) => `${key}=[redacted]`)
        .replace(tokenLikeValue, "[redacted-token]")
        .replace(userProfilePath, "C:\\Users\\[redacted]")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    if (sanitized.length <= maximumLength)
        return sanitized || "Unknown error";
    return `${sanitized.slice(0, Math.max(0, maximumLength - 1))}…`;
}
export function sanitizeLogReference(value) {
    const normalized = value?.trim().replaceAll("\\", "/");
    if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.includes(".."))
        return "logs/blockwright.log";
    if (!/^[A-Za-z0-9._/#-]{1,240}$/.test(normalized))
        return "logs/blockwright.log";
    return normalized;
}
export function normalizeDiagnosticCode(value) {
    const normalized = value.toUpperCase().replace(/[^A-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    return normalized.slice(0, 80) || "TASK_FAILED";
}
export function createTaskDiagnostic(input) {
    const managed = input.error instanceof ManagedTaskError ? input.error : undefined;
    return {
        id: input.diagnosticId ?? `diag_${randomUUID().replaceAll("-", "")}`,
        code: managed?.code ?? normalizeDiagnosticCode(input.defaultCode ?? "TASK_FAILED"),
        phase: input.phase,
        operation: sanitizeDiagnosticText(input.operation, 160),
        ...(managed?.component ? { component: managed.component } : {}),
        error: sanitizeDiagnosticText(input.error),
        likelyCause: managed?.likelyCause ?? sanitizeDiagnosticText(input.defaultLikelyCause ?? "The task ended before producing a valid result.", 320),
        retry: {
            safe: managed?.retrySafe ?? input.defaultRetrySafe ?? false,
            reason: managed?.retryReason ?? sanitizeDiagnosticText(input.defaultRetryReason ?? "Retry safety could not be established.", 320),
        },
        recommendedAction: managed?.recommendedAction ?? sanitizeDiagnosticText(input.defaultRecommendedAction ?? "Review diagnostics before retrying.", 320),
        logReference: sanitizeLogReference(managed?.logReference ?? input.logReference),
    };
}
export function validateTaskWork(work) {
    if (!work)
        return undefined;
    const normalized = { unit: sanitizeDiagnosticText(work.unit, 80) };
    for (const [key, value] of [["completedUnits", work.completedUnits], ["totalUnits", work.totalUnits], ["cacheHits", work.cacheHits], ["cacheReusedUnits", work.cacheReusedUnits]]) {
        if (value === undefined)
            continue;
        if (!Number.isSafeInteger(value) || value < 0)
            throw new Error(`${key} must be a non-negative safe integer when supplied.`);
        normalized[key] = value;
    }
    if (normalized.completedUnits !== undefined && normalized.totalUnits !== undefined && normalized.completedUnits > normalized.totalUnits) {
        throw new Error("completedUnits cannot exceed totalUnits.");
    }
    if (work.affectedComponent)
        normalized.affectedComponent = sanitizeDiagnosticText(work.affectedComponent, 160);
    return normalized;
}
//# sourceMappingURL=task-contract.js.map