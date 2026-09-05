import { resolve } from "node:path";
import { repositoryRoot, writeChecksums } from "./release-lib.mjs";

const directoryIndex = process.argv.indexOf("--dir");
const directory = resolve(directoryIndex >= 0 ? process.argv[directoryIndex + 1] : resolve(repositoryRoot, "release", "windows"));
const result = writeChecksums(directory);
console.log(`Wrote ${result.entries} SHA-256 entries to ${result.output}.`);
