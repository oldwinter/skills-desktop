import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
      provider: "v8",
      reporter: ["text", "html"],
    },
    exclude: [
      "**/node_modules/**",
      "prototype/**",
      "out/**",
      "**/dist/**",
      "tests/real-cli.smoke.test.ts",
      "tests/localhost-ssh.smoke.test.ts",
    ],
    include: ["**/*.test.ts", "**/*.test.tsx"],
    pool: "forks",
  },
});
