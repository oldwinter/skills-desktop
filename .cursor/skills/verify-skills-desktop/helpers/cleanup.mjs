#!/usr/bin/env node
import { access, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  clearSessionFile,
  processAlive,
  readSession,
  sessionPath,
  stopOwnedElectron,
  writeJson,
} from "./lib.mjs";

try {
  await access(sessionPath());
} catch {
  process.stdout.write("no verification session to clean\n");
  process.exit(0);
}

const session = await readSession();
const evidenceDir = session.evidenceDir;
const leftoverPid = processAlive(session.pid) ? session.pid : null;

try {
  await stopOwnedElectron(session.pid);
} catch (error) {
  process.stderr.write(
    `Failed to stop owned Electron PID ${session.pid}: ${
      error instanceof Error ? error.message : error
    }\n`,
  );
  process.exitCode = 1;
}

if (processAlive(session.pid)) {
  process.stderr.write(
    `Owned Electron PID ${session.pid} is still alive after cleanup.\n`,
  );
  process.exitCode = 1;
}

try {
  await rm(session.fixtureRoot, { force: true, recursive: true });
} catch (error) {
  process.stderr.write(
    `Failed to remove fixture ${session.fixtureRoot}: ${
      error instanceof Error ? error.message : error
    }\n`,
  );
  process.exitCode = 1;
}

await clearSessionFile();

let evidenceSurvived = true;
try {
  await access(evidenceDir);
} catch {
  evidenceSurvived = false;
  process.stderr.write(`Evidence directory vanished: ${evidenceDir}\n`);
  process.exitCode = 1;
}

const receipt = {
  evidenceDir,
  evidenceSurvived,
  fixtureRemoved: true,
  stoppedPid: leftoverPid,
};
await writeJson(join(evidenceDir, "cleanup.json"), receipt).catch(() => undefined);
process.stdout.write(
  [
    "verification session cleaned",
    leftoverPid === null
      ? "electron already exited"
      : `stopped pid ${leftoverPid}`,
    `removed fixture ${session.fixtureRoot}`,
    evidenceSurvived
      ? `evidence kept at ${evidenceDir}`
      : `evidence missing at ${evidenceDir}`,
    "",
  ].join("\n"),
);
