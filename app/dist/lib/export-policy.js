export const BEDROCK_FUNCTION_COMMAND_LIMIT = 10_000;
function invalidContractReason(build) {
    if (build.contract.status === "valid" && build.certificate.status === "valid" && build.certificate.buildHash === build.hash)
        return undefined;
    const { failed, unsupported, unevaluated } = build.contract.summary;
    return `the hash-bound contract is invalid (${failed} failed, ${unsupported} unsupported, ${unevaluated} unevaluated hard requirement(s))`;
}
export function constructionExportBlocker(build, format, options = {}) {
    const invalid = invalidContractReason(build);
    if (invalid)
        return `Construction export blocked because ${invalid}.`;
    if ((format === "schem" || format === "litematic" || format === "java_mcfunction") && build.input.edition !== "java") {
        return `${format} requires a valid Java Edition build; this build targets ${build.input.edition}.`;
    }
    if (format === "bedrock_mcfunction" && build.input.edition !== "bedrock") {
        return `bedrock_mcfunction requires a valid Bedrock Edition build; this build targets ${build.input.edition}.`;
    }
    if (format === "mcpack" && build.input.edition !== "bedrock") {
        return `mcpack requires a valid Bedrock Edition build; this build targets ${build.input.edition}.`;
    }
    if (!options.allowChunkedBedrock && format === "bedrock_mcfunction" && build.placements.length > BEDROCK_FUNCTION_COMMAND_LIMIT) {
        return `Bedrock command export requires ${build.placements.length.toLocaleString()} commands, above Minecraft Bedrock's ${BEDROCK_FUNCTION_COMMAND_LIMIT.toLocaleString()}-command function-call ceiling. Export the valid build as a tiled mcpack instead.`;
    }
    return undefined;
}
export function assertConstructionExportable(build, format, options = {}) {
    const blocker = constructionExportBlocker(build, format, options);
    if (blocker)
        throw new Error(`CONSTRUCTION_EXPORT_BLOCKED: ${blocker}`);
}
//# sourceMappingURL=export-policy.js.map