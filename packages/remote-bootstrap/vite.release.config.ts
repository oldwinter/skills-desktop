import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: resolve(root, "dist/release"),
    rolldownOptions: { output: { entryFileNames: "index.js" } },
    sourcemap: false,
    ssr: resolve(root, "src/index.ts"),
  },
  ssr: {
    noExternal: ["zod", "@skills-desktop/skills-runtime"],
    target: "node",
  },
});
