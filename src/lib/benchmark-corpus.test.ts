import { describe, expect, it } from "vitest";
import { createBenchmarkCorpus } from "../../scripts/benchmark-v060.js";

describe("v0.6 acceptance corpus", () => {
  it("contains exactly 100 uniquely seeded, Java 26.2 briefs", () => {
    const corpus = createBenchmarkCorpus();
    expect(corpus).toHaveLength(100);
    expect(new Set(corpus.map(({ id }) => id)).size).toBe(100);
    expect(new Set(corpus.map(({ brief }) => brief.seed)).size).toBe(100);
    expect(corpus.every(({ brief }) => brief.edition === "java" && brief.version === "26.2")).toBe(true);
  });

  it("covers passing briefs, soft requirements, unsupported clauses, and geometric failures", () => {
    const corpus = createBenchmarkCorpus();
    const categories = new Set(corpus.map(({ category }) => category));
    expect(categories).toEqual(new Set([
      "baseline",
      "soft-requirements",
      "unsupported-hard",
      "lighting-threshold",
      "cardinal-entrances",
    ]));
    expect(corpus.filter(({ expectedContractStatus }) => expectedContractStatus === "valid")).toHaveLength(65);
    expect(corpus.filter(({ expectedContractStatus }) => expectedContractStatus === "invalid")).toHaveLength(35);
  });
});
