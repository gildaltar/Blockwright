import { resolve } from "node:path";
/**
 * Resolve the mutable runtime-state root without assuming an installed layout.
 * The Windows controller supplies the first two variables for portable and
 * isolated launches; ordinary source/installed runs retain the prior fallback.
 */
export function resolveRuntimeStateRoot(environment = process.env, workingDirectory = process.cwd()) {
    const explicitRoot = environment.BLOCKWRIGHT_STATE_ROOT?.trim();
    if (explicitRoot)
        return resolve(explicitRoot);
    const explicitDirectory = environment.BLOCKWRIGHT_STATE_DIR?.trim();
    if (explicitDirectory)
        return resolve(explicitDirectory);
    const localAppData = environment.LOCALAPPDATA?.trim();
    if (localAppData)
        return resolve(localAppData, "Blockwright");
    return resolve(workingDirectory, ".blockwright");
}
//# sourceMappingURL=runtime-state.js.map