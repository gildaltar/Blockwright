import { readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

export function assertNoRedistributionRestrictedResourceArchives(stageRoot) {
  const root = resolve(stageRoot);
  const pending = [root];
  const forbidden = [];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.name.toLowerCase().endsWith("-vanilla-resources.zip")) forbidden.push(relative(root, path));
      else if (entry.isDirectory()) pending.push(path);
    }
  }
  if (forbidden.length > 0) {
    throw new Error(`Windows distribution staging refused redistribution-restricted Minecraft resource archives: ${forbidden.sort().join(", ")}`);
  }
}
