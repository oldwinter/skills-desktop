import { persistFailureArtifacts, redactFailureText } from "./artifacts.mjs";
import {
  assertRuntimeArchitecture,
  createPackagedQaFixture,
  resolvePackagedExecutable,
} from "./fixture.mjs";
import { packagedUiQaHelp, runPackagedUiQa } from "./scenarios.mjs";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(`${packagedUiQaHelp()}\n`);
  process.exit(0);
}

assertRuntimeArchitecture();
const fixture = await createPackagedQaFixture();
const controller = new AbortController();
let interruptExitCode;
const interrupt = (exitCode, signalName) => {
  if (interruptExitCode !== undefined) return;
  interruptExitCode = exitCode;
  controller.abort(new Error(`Packaged UI QA interrupted by ${signalName}.`));
};
const handleSigint = () => interrupt(130, "SIGINT");
const handleSigterm = () => interrupt(143, "SIGTERM");
process.once("SIGINT", handleSigint);
process.once("SIGTERM", handleSigterm);

let completedResult;
try {
  completedResult = await runPackagedUiQa({
    executable: resolvePackagedExecutable(),
    fixture,
    signal: controller.signal,
  });
} catch (error) {
  process.stderr.write(
    `${redactFailureText(error instanceof Error ? error.stack : error)}\n`,
  );
  process.exitCode = interruptExitCode ?? 1;
  await persistFailureArtifacts(
    fixture,
    error,
    process.env.SKILLS_DESKTOP_QA_ARTIFACTS,
  );
} finally {
  process.removeListener("SIGINT", handleSigint);
  process.removeListener("SIGTERM", handleSigterm);
  try {
    await fixture.cleanup();
  } catch (error) {
    process.stderr.write(
      `${redactFailureText(error instanceof Error ? error.stack : error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (completedResult !== undefined && process.exitCode === undefined) {
  process.stdout.write(
    `packaged UI QA passed: ${completedResult.scenarios.join(", ")}\n`,
  );
}
