import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = resolve(root, "app");
const dist = resolve(root, "dist");
const registry = resolve(root, "data", "java", "26.2.registry.json");

if (!existsSync(resolve(dist, "server.js"))) throw new Error("Run npm run build before packaging the plugin.");
if (!existsSync(registry)) throw new Error("The exact Java 26.2 registry is required for the local plugin package.");

rmSync(app, { recursive: true, force: true });
mkdirSync(resolve(app, "data", "java"), { recursive: true });
cpSync(dist, resolve(app, "dist"), { recursive: true });
cpSync(registry, resolve(app, "data", "java", "26.2.registry.json"));
cpSync(resolve(root, "alpic.json"), resolve(app, "alpic.json"));

const sourcePackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const runtimePackage = {
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
writeFileSync(resolve(app, "package.json"), `${JSON.stringify(runtimePackage, null, 2)}\n`);
console.log(`Packaged Blockwright ${sourcePackage.version} runtime at ${app}`);
