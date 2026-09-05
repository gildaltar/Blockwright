import { resolve } from "node:path";
import { defineConfig } from "vite";

const repositoryRoot = import.meta.dirname;

export default defineConfig({
  root: resolve(repositoryRoot, "standalone"),
  base: "/assets/blockwright/",
  publicDir: false,
  build: {
    outDir: resolve(repositoryRoot, "dist", "assets", "blockwright"),
    emptyOutDir: true,
    sourcemap: true,
  },
});
