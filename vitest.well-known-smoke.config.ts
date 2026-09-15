import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/well-known-http.smoke.test.ts"],
    pool: "forks",
    testTimeout: 120_000,
  },
});
