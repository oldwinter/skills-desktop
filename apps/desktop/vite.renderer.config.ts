import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  build: {
    emptyOutDir: true,
    outDir: resolve(root, "dist/renderer"),
  },
  plugins: [react()],
  root: resolve(root, "src/renderer"),
});
