import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export function normalizeBasePath(value: string | undefined): string {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === "" || trimmed === "/") return "/";
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

export default defineConfig({
  base: normalizeBasePath(process.env.WEBSITE_BASE_PATH),
  build: {
    emptyOutDir: true,
    outDir: resolve(root, "dist"),
  },
  plugins: [react()],
  root,
});
