import { checkJavaUpdates, syncJavaVersion } from "../src/lib/java-version-sync.js";

const args = process.argv.slice(2);
if (args.includes("--check")) {
  console.log(JSON.stringify(await checkJavaUpdates(args.includes("--snapshot") ? "snapshot" : "release"), null, 2));
} else {
  const version = args.find((arg) => !arg.startsWith("--")) ?? "latest";
  const result = await syncJavaVersion(version, !args.includes("--registry-only"));
  console.log(JSON.stringify({
    version: result.snapshot.version,
    blocks: result.snapshot.blockCount,
    protocolVersion: result.snapshot.protocolVersion,
    worldVersion: result.snapshot.worldVersion,
    resourcePackVersion: result.snapshot.resourcePackVersion,
    clientSha1: result.snapshot.client.sha1,
    registryPath: result.registryPath,
    resourcePackPath: result.resourcePackPath ?? null,
  }, null, 2));
}
