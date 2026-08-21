import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(root, "src/preload/workspace.ts"),
      fileName: () => "workspace.cjs",
      formats: ["cjs"],
    },
    minify: false,
    outDir: resolve(root, "dist/preload"),
    rolldownOptions: {
      external: ["electron"],
      output: { codeSplitting: false },
    },
    sourcemap: true,
  },
});
