import {
  persistFailureArtifacts,
  safeFailureSummary,
} from "./artifacts.mjs";
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

let fixture;
let completedResult;
let runFailure;
try {
  assertRuntimeArchitecture();
  fixture = await createPackagedQaFixture();
  completedResult = await runPackagedUiQa({
    executable: resolvePackagedExecutable(),
    fixture,
    signal: controller.signal,
  });
} catch (error) {
  runFailure = error;
  process.exitCode = interruptExitCode ?? 1;
} finally {
  process.removeListener("SIGINT", handleSigint);
  process.removeListener("SIGTERM", handleSigterm);
  if (fixture !== undefined) {
    try {
      await fixture.cleanup();
    } catch (error) {
      runFailure ??= Object.assign(
        new Error("Packaged UI QA finalization failed.", { cause: error }),
        { qaCheck: "fixture-cleanup", qaStage: "finalization" },
      );
      process.exitCode = 1;
    }
  }
}

if (runFailure !== undefined) {
  process.stderr.write(`${safeFailureSummary(runFailure)}\n`);
  try {
    await persistFailureArtifacts(
      runFailure,
      process.env.SKILLS_DESKTOP_QA_ARTIFACTS,
    );
  } catch {
    process.stderr.write(
      "Packaged UI QA could not write its structured failure receipt.\n",
    );
    process.exitCode = 1;
  }
} else if (completedResult !== undefined && process.exitCode === undefined) {
  process.stdout.write(
    `packaged UI QA passed: ${completedResult.scenarios.join(", ")}\n`,
  );
}
