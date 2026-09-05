import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultApp = resolve(root, "app");
const dist = resolve(root, "dist");
const registryRoot = resolve(root, "data", "java");
const cacheRoot = resolve(root, "cache");

function assertInside(parent, target, label) {
  const value = relative(parent, target);
  if (!value || value.startsWith("..") || isAbsolute(value)) throw new Error(`${label} must be a child of ${parent}; received ${target}.`);
}

function assertSafeOutput(output) {
  assertInside(root, output, "Plugin package output");
  if (output !== defaultApp) assertInside(cacheRoot, output, "Non-default test output");
}

function requirePath(path, message) {
  if (!existsSync(path)) throw new Error(message);
}

export function createRuntimePackage(sourcePackage) {
  return {
    name: sourcePackage.name,
    version: sourcePackage.version,
    private: true,
    description: sourcePackage.description,
    type: sourcePackage.type,
    scripts: { start: sourcePackage.scripts.start },
    dependencies: sourcePackage.dependencies,
    engines: sourcePackage.engines,
    allowScripts: sourcePackage.allowScripts,
  };
}

export function createRuntimeLock(sourceLock, runtimePackage) {
  const runtimeLock = JSON.parse(JSON.stringify(sourceLock));
  runtimeLock.name = runtimePackage.name;
  runtimeLock.version = runtimePackage.version;
  const sourceRoot = runtimeLock.packages?.[""] ?? {};
  runtimeLock.packages ??= {};
  runtimeLock.packages[""] = {
    name: runtimePackage.name,
    version: runtimePackage.version,
    dependencies: runtimePackage.dependencies,
    engines: runtimePackage.engines,
    ...("license" in sourceRoot ? { license: sourceRoot.license } : {}),
  };
  return runtimeLock;
}

function operatorFiles() {
  return [
    resolve(root, "scripts", "diagnose.mjs"),
    resolve(root, "scripts", "windows", "Blockwright-ControlCenter.ps1"),
    resolve(root, "scripts", "windows", "Install-BlockwrightShortcut.ps1"),
    resolve(root, "scripts", "windows", "Invoke-BlockwrightRuntimeRepair.ps1"),
    resolve(root, "scripts", "windows", "Launch-Blockwright-ControlCenter.cmd"),
    resolve(root, "scripts", "windows", "Launch-Blockwright-ControlCenter.vbs"),
    resolve(root, "scripts", "windows", "Test-ControlCenter.ps1"),
    resolve(root, "scripts", "windows", "README.md"),
  ];
}

const defaultTransactionFs = { existsSync, renameSync, rmSync };

export function commitStagedPackage({ destination, staging, backup }, transactionFs = defaultTransactionFs) {
  let movedExisting = false;
  let committed = false;
  let failed = false;
  try {
    if (transactionFs.existsSync(destination)) {
      transactionFs.renameSync(destination, backup);
      movedExisting = true;
    }
    try {
      transactionFs.renameSync(staging, destination);
      committed = true;
    } catch (commitError) {
      if (movedExisting && !transactionFs.existsSync(destination) && transactionFs.existsSync(backup)) {
        try {
          transactionFs.renameSync(backup, destination);
        } catch (rollbackError) {
          throw new AggregateError(
            [commitError, rollbackError],
            `Plugin package commit failed and rollback could not restore the previous app. The recoverable backup remains at ${backup}.`,
          );
        }
      }
      throw commitError;
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (committed && !failed && movedExisting && transactionFs.existsSync(backup)) {
      transactionFs.rmSync(backup, { recursive: true, force: true });
    }
  }
  return { committed, replacedExisting: movedExisting };
}

export function packagePlugin(output = defaultApp) {
  const destination = resolve(output);
  assertSafeOutput(destination);
  requirePath(resolve(dist, "server.js"), "Run npm run build before packaging the plugin.");
  requirePath(resolve(dist, "assets", ".vite", "manifest.json"), "The production view manifest is missing; run npm run build successfully before packaging.");
  requirePath(resolve(registryRoot, "26.2.registry.json"), "The exact Java 26.2 registry is required for the local plugin package.");
  requirePath(resolve(root, "package-lock.json"), "The root package lock is required to create a reproducible plugin runtime.");
  for (const path of operatorFiles()) requirePath(path, `Required local operator file is missing: ${relative(root, path)}`);

  const sourcePackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const sourceLock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  const runtimePackage = createRuntimePackage(sourcePackage);
  const runtimeLock = createRuntimeLock(sourceLock, runtimePackage);
  const stamp = `${process.pid}-${Date.now()}`;
  const staging = resolve(dirname(destination), `.${relative(dirname(destination), destination)}-staging-${stamp}`);
  const backup = resolve(dirname(destination), `.${relative(dirname(destination), destination)}-backup-${stamp}`);
  assertInside(root, staging, "Staging directory");
  assertInside(root, backup, "Backup directory");

  rmSync(staging, { recursive: true, force: true });
  mkdirSync(resolve(staging, "data", "java"), { recursive: true });
  try {
    cpSync(dist, resolve(staging, "dist"), { recursive: true });
    cpSync(resolve(registryRoot, "26.2.registry.json"), resolve(staging, "data", "java", "26.2.registry.json"));
    const resources = resolve(registryRoot, "26.2-vanilla-resources.zip");
    if (existsSync(resources)) cpSync(resources, resolve(staging, "data", "java", "26.2-vanilla-resources.zip"));
    cpSync(resolve(root, "alpic.json"), resolve(staging, "alpic.json"));
    writeFileSync(resolve(staging, "package.json"), `${JSON.stringify(runtimePackage, null, 2)}\n`);
    writeFileSync(resolve(staging, "package-lock.json"), `${JSON.stringify(runtimeLock, null, 2)}\n`);

    commitStagedPackage({ destination, staging, backup });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return { destination, version: runtimePackage.version, lockfileVersion: runtimeLock.lockfileVersion };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const modulePath = fileURLToPath(import.meta.url);
const isMain = process.platform === "win32" ? invokedPath.toLowerCase() === modulePath.toLowerCase() : invokedPath === modulePath;
if (isMain) {
  const result = packagePlugin(argumentValue("--output") ?? defaultApp);
  console.log(`Packaged Blockwright ${result.version} runtime at ${result.destination} with lockfile v${result.lockfileVersion}.`);
}
