import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/git-publish.smoke.test.ts"],
    pool: "forks",
    testTimeout: 120_000,
  },
});
