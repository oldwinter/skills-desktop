import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(root, "src/preload/review.ts"),
      fileName: () => "review.cjs",
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
