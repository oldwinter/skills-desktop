#!/usr/bin/env node
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  createPackagedQaFixture,
  evidenceRoot,
  EXPECTED_URL,
  fixtureParent,
  PINNED_CLI,
  processAlive,
  QA_PROJECT_SKILL,
  readSession,
  requireDisplay,
  requirePackagedExecutable,
  sessionPath,
  workspaceState,
  writeJson,
  writeSession,
} from "./lib.mjs";
import { launchPackagedElectron } from "../../../../tests/packaged-ui-qa/launch.mjs";

async function existingLiveSession() {
  try {
    const session = await readSession();
    if (processAlive(session.pid)) return session;
  } catch {
    return undefined;
  }
  return undefined;
}

const existing = await existingLiveSession();
if (existing !== undefined) {
  process.stderr.write(
    [
      "A verification session is already running.",
      `PID ${existing.pid} on CDP port ${existing.port}.`,
      "Drive that session, or run helpers/cleanup.mjs first.",
      "Do not attach to a developer Skills Desktop instance.",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

requireDisplay();
const executable = await requirePackagedExecutable();
const runId = new Date().toISOString().replaceAll(":", "").replaceAll(".", "-");
const evidenceDir = join(evidenceRoot(), runId);
await mkdir(evidenceDir, { recursive: true, mode: 0o700 });

const fixture = await createPackagedQaFixture({ root: fixtureParent() });
let launched;
try {
  launched = await launchPackagedElectron({ executable, fixture });
  await launched.page.waitFor(
    `document.body?.textContent?.includes(${JSON.stringify(QA_PROJECT_SKILL)}) === true &&
      document.querySelector("h1")?.textContent === "Inventory"`,
    "fixture inventory on Inventory",
  );
  const state = await workspaceState(launched.page);
  const session = {
    cliVersion: PINNED_CLI,
    evidenceDir,
    executable,
    expectedUrl: EXPECTED_URL,
    fixtureArtifacts: fixture.artifacts,
    fixtureRoot: fixture.root,
    home: fixture.home,
    invocationLog: fixture.invocationLog,
    inventoryPath: fixture.inventoryPath,
    pid: launched.child.pid,
    port: launched.port,
    runId,
    sessionName: launched.sessionName,
    startedAt: new Date().toISOString(),
    userData: fixture.userData,
    workspace: fixture.workspace,
  };
  const path = await writeSession(session);
  await writeJson(join(evidenceDir, "launch.json"), {
    ...session,
    sessionFile: path,
    workspaceState: state,
  });
  await launched.page.disconnect();
  launched.child.unref?.();
  process.stdout.write(
    [
      "verification session ready",
      `session ${path}`,
      `pid ${session.pid}`,
      `cdp http://127.0.0.1:${session.port}/json/list`,
      `evidence ${evidenceDir}`,
      `fixture ${fixture.root}`,
      `ready Inventory with ${state.skillNames.join(", ")}`,
      "",
    ].join("\n"),
  );
  process.exit(0);
} catch (error) {
  try {
    await launched?.close();
  } catch {
    // Launch failed; still drop the fixture so ports and temp dirs do not leak.
  }
  try {
    await fixture.cleanup();
  } catch {
    // Best-effort fixture cleanup after a failed launch.
  }
  await rm(sessionPath(), { force: true });
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
}
