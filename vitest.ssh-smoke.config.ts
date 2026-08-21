import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/localhost-ssh.smoke.test.ts"],
    pool: "forks",
    testTimeout: 120_000,
  },
});
