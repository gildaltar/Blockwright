import type { BuildRecord } from "./types.js";

export const BEDROCK_FUNCTION_COMMAND_LIMIT = 10_000;

export type ConstructionExportFormat = "java_mcfunction" | "bedrock_mcfunction" | "mcpack" | "schem" | "litematic" | "bundle";

function invalidContractReason(build: BuildRecord) {
  if (build.contract.status === "valid" && build.certificate.status === "valid" && build.certificate.buildHash === build.hash) return undefined;
  const { failed, unsupported, unevaluated } = build.contract.summary;
  return `the hash-bound contract is invalid (${failed} failed, ${unsupported} unsupported, ${unevaluated} unevaluated hard requirement(s))`;
}

export function constructionExportBlocker(build: BuildRecord, format: ConstructionExportFormat, options: { allowChunkedBedrock?: boolean } = {}): string | undefined {
  const invalid = invalidContractReason(build);
  if (invalid) return `Construction export blocked because ${invalid}.`;

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

export function assertConstructionExportable(build: BuildRecord, format: ConstructionExportFormat, options: { allowChunkedBedrock?: boolean } = {}) {
  const blocker = constructionExportBlocker(build, format, options);
  if (blocker) throw new Error(`CONSTRUCTION_EXPORT_BLOCKED: ${blocker}`);
}
