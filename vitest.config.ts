import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: { enabled: false },
    exclude: [
      "**/node_modules/**",
      "prototype/**",
      "out/**",
      "**/dist/**",
      "tests/real-cli.smoke.test.ts",
    ],
    include: ["**/*.test.ts", "**/*.test.tsx"],
    pool: "forks",
  },
});
