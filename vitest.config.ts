import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "apps/*/src/**/*.{ts,tsx}",
        "apps/desktop/forge.config.ts",
        "apps/desktop/vite.*.config.ts",
        "packages/*/src/**/*.{ts,tsx}",
        "packages/remote-bootstrap/vite.release.config.ts",
        "scripts/release/*.mjs",
      ],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.d.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
    exclude: [
      "**/node_modules/**",
      "prototype/**",
      "out/**",
      "**/dist/**",
      "tests/real-cli.smoke.test.ts",
      "tests/localhost-ssh.smoke.test.ts",
    ],
    include: ["**/*.test.ts", "**/*.test.tsx", "tests/packaged-ui-qa/**/*.test.mjs"],
    pool: "forks",
  },
});
