import { __setBuildManifest, __setSkillsManifest } from "skybridge/server";
import manifest from "./vite-manifest.js";
import skills from "./skills.js";

__setBuildManifest(manifest);
__setSkillsManifest(skills);

const userMod = await import("./server.js");
export default userMod.default;
