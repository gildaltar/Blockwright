import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

function runtimeImports(filePath: string) {
  const source = readFileSync(filePath, "utf8");
  const output = ts.transpileModule(source, {
    fileName: filePath,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const compiled = ts.createSourceFile(`${filePath}.js`, output, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);

  return compiled.statements.flatMap((statement) => {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      return [statement.moduleSpecifier.text];
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      return [statement.moduleSpecifier.text];
    }
    return [];
  });
}

function resolveSourceImport(importer: string, specifier: string) {
  const importedPath = resolve(dirname(importer), specifier);
  const sourceBase = importedPath.replace(/\.js$/, "");
  return [
    `${sourceBase}.ts`,
    `${sourceBase}.tsx`,
    importedPath,
    resolve(importedPath, "index.ts"),
    resolve(importedPath, "index.tsx"),
  ].find(existsSync);
}

describe("reviewer browser boundary", () => {
  it("keeps Node built-ins out of the review view's runtime import graph", () => {
    const entry = resolve(repositoryRoot, "src/views/review-build.tsx");
    const pending = [entry];
    const visited = new Set<string>();
    const nodeImports: string[] = [];

    while (pending.length) {
      const filePath = pending.pop()!;
      if (visited.has(filePath)) continue;
      visited.add(filePath);

      for (const specifier of runtimeImports(filePath)) {
        if (specifier.startsWith("node:")) {
          nodeImports.push(`${filePath}: ${specifier}`);
        } else if (specifier.startsWith(".")) {
          const importedSource = resolveSourceImport(filePath, specifier);
          if (importedSource) pending.push(importedSource);
        }
      }
    }

    expect([...visited].some((filePath) => filePath.endsWith("reviewer.ts"))).toBe(true);
    expect([...visited].some((filePath) => filePath.endsWith("reviewer-audit.ts"))).toBe(false);
    expect(nodeImports).toEqual([]);
  });
});
