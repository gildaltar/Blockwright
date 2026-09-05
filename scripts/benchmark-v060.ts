import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { compileBuild } from "../src/lib/compiler.js";
import { auditBuild } from "../src/lib/reviewer-audit.js";
import type { BuildingType, BuildInput } from "../src/lib/types.js";

type BenchmarkCase = {
  id: string;
  category: "baseline" | "soft-requirements" | "unsupported-hard" | "lighting-threshold" | "cardinal-entrances";
  expectedContractStatus: "valid" | "invalid";
  brief: BuildInput;
};

const styles = ["nordic", "japanese", "modern", "medieval", "fantasy"];
const buildingTypes: BuildingType[] = ["house", "temple", "tower", "workshop", "hall", "courtyard", "megabase"];

function baseBrief(index: number, name: string): BuildInput {
  return {
    name,
    edition: "java",
    version: "26.2",
    style: styles[index % styles.length],
    buildingType: buildingTypes[index % buildingTypes.length],
    dimensions: {
      width: 15 + (index % 5) * 2,
      depth: 13 + (index % 4) * 2,
      height: 12 + (index % 4),
    },
    origin: { x: (index % 10) * 32, y: 64 + (index % 3), z: -Math.floor(index / 10) * 32 },
    blockBudget: 100_000,
    seed: `benchmark-v060-${String(index + 1).padStart(3, "0")}`,
  };
}

export function createBenchmarkCorpus(): BenchmarkCase[] {
  const cases: BenchmarkCase[] = [];
  const add = (
    category: BenchmarkCase["category"],
    expectedContractStatus: BenchmarkCase["expectedContractStatus"],
    features: string[],
  ) => {
    const index = cases.length;
    const id = `BW060-${String(index + 1).padStart(3, "0")}`;
    cases.push({
      id,
      category,
      expectedContractStatus,
      brief: { ...baseBrief(index, `Synthetic acceptance brief ${id}`), features },
    });
  };

  for (let index = 0; index < 50; index += 1) add("baseline", "valid", []);
  for (let index = 0; index < 15; index += 1) {
    add("soft-requirements", "valid", [
      "warning: terrain context not supplied",
      `aesthetic: deliberate silhouette study ${index + 1}`,
    ]);
  }
  for (let index = 0; index < 15; index += 1) add("unsupported-hard", "invalid", [`hard: dragon statue variant ${index + 1}`]);
  for (let index = 0; index < 10; index += 1) add("lighting-threshold", "invalid", [`${90 + index} lights`]);
  for (let index = 0; index < 10; index += 1) add("cardinal-entrances", "invalid", ["four cardinal 9-wide entrances"]);
  return cases;
}

const semanticCategories = [
  "integrity", "entrances", "clearance", "spawn", "rooms", "lighting", "interior",
  "support", "palette", "version", "origin", "budget",
] as const;

async function main() {
  const corpus = createBenchmarkCorpus();
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const results = corpus.map((entry) => {
    let build;
    try {
      build = compileBuild(entry.brief);
    } catch (error) {
      const rejectedBeforeGeneration = error instanceof Error && error.message.includes("UNSUPPORTED_HARD_REQUIREMENT");
      return {
        id: entry.id,
        category: entry.category,
        expectedContractStatus: entry.expectedContractStatus,
        observedContractStatus: rejectedBeforeGeneration ? "rejected_before_generation" : "error",
        passed: entry.category === "unsupported-hard" && rejectedBeforeGeneration,
        rejectedBeforeGeneration,
        error: error instanceof Error ? error.message : "Unknown benchmark error",
      };
    }
    const audit = auditBuild(build);
    const observedCategories = new Set(audit.semantic.checks.map(({ category }) => category));
    const missingCategories = semanticCategories.filter((category) => !observedCategories.has(category));
    const certificateBound = build.certificate.buildHash === build.hash
      && audit.certificate.buildHash === build.hash
      && audit.contract.buildHash === build.hash;
    const passed = build.contract.status === entry.expectedContractStatus
      && certificateBound
      && missingCategories.length === 0;
    return {
      id: entry.id,
      category: entry.category,
      expectedContractStatus: entry.expectedContractStatus,
      observedContractStatus: build.contract.status,
      passed,
      buildHash: build.hash,
      blockCount: build.placements.length,
      certificateBound,
      missingSemanticCategories: missingCategories,
      hardSummary: build.contract.summary,
      nonPassingClauses: build.contract.hardResults
        .filter(({ status }) => status !== "pass")
        .map(({ clauseId, status, requirement }) => ({ clauseId, status, requirement })),
    };
  });
  const failed = results.filter(({ passed }) => !passed);
  const output = {
    schemaVersion: 1,
    release: "0.6.0",
    classification: "synthetic internal acceptance corpus; not customer work",
    startedAt,
    durationMs: Math.round(performance.now() - started),
    corpusSize: corpus.length,
    passed: results.length - failed.length,
    failed: failed.length,
    categoryCounts: Object.fromEntries([...new Set(corpus.map(({ category }) => category))]
      .map((category) => [category, corpus.filter((entry) => entry.category === category).length])),
    results,
  };
  const directory = join(process.cwd(), "benchmarks");
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, "briefs-v060.json"), `${JSON.stringify({ schemaVersion: 1, classification: output.classification, cases: corpus }, null, 2)}\n`),
    writeFile(join(directory, "results-v060.json"), `${JSON.stringify(output, null, 2)}\n`),
  ]);
  console.log(JSON.stringify({ corpusSize: output.corpusSize, passed: output.passed, failed: output.failed, durationMs: output.durationMs }, null, 2));
  if (failed.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
