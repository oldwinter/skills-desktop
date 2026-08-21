import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: resolve(root, "dist/main"),
    rolldownOptions: { output: { entryFileNames: "index.js" } },
    sourcemap: true,
    ssr: resolve(root, "src/main/index.ts"),
  },
  ssr: {
    external: ["electron"],
    noExternal: [
      "zod",
      "@skills-desktop/remote-bootstrap",
      "@skills-desktop/skills-runtime",
    ],
    target: "node",
  },
});
