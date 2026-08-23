import { persistFailureArtifacts } from "./artifacts.mjs";
import { createPackagedQaFixture, resolvePackagedExecutable } from "./fixture.mjs";
import { packagedUiQaHelp, runPackagedUiQa } from "./scenarios.mjs";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(`${packagedUiQaHelp()}\n`);
  process.exit(0);
}

const fixture = await createPackagedQaFixture();
const cleanup = async () => {
  await fixture.cleanup().catch(() => undefined);
};
process.once("SIGINT", () => {
  void cleanup().finally(() => process.exit(130));
});
process.once("SIGTERM", () => {
  void cleanup().finally(() => process.exit(143));
});

try {
  const result = await runPackagedUiQa({
    executable: resolvePackagedExecutable(),
    fixture,
  });
  process.stdout.write(
    `packaged UI QA passed: ${result.scenarios.join(", ")}\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exitCode = 1;
  await persistFailureArtifacts(
    fixture,
    error,
    process.env.SKILLS_DESKTOP_QA_ARTIFACTS,
  );
} finally {
  await cleanup();
}
