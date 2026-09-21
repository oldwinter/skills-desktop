#!/usr/bin/env node
import { access } from "node:fs/promises";
import { join } from "node:path";

import {
  connectWorkspace,
  EXPECTED_URL,
  listCdpTargets,
  PINNED_CLI,
  processAlive,
  QA_PROJECT_SKILL,
  readSession,
  requirePackagedExecutable,
  WORKSPACE_TITLE,
  workspaceState,
  writeJson,
} from "./lib.mjs";

const session = await readSession();
const executable = await requirePackagedExecutable();
const checks = [];
const note = (name, ok, detail) => {
  checks.push({ detail, name, ok });
};

note("session-file", true, session.path);
note("process-alive", processAlive(session.pid), `pid ${session.pid}`);
note(
  "executable",
  executable === session.executable,
  session.executable,
);

let fixtureOk = true;
for (const [name, path] of [
  ["fixture-root", session.fixtureRoot],
  ["user-data", session.userData],
  ["workspace", session.workspace],
  ["inventory", session.inventoryPath],
]) {
  try {
    await access(path);
    note(name, true, path);
  } catch {
    fixtureOk = false;
    note(name, false, path);
  }
}

let targets = [];
try {
  targets = await listCdpTargets(session.port);
  note(
    "cdp-workspace",
    targets.some(
      (target) =>
        target.type === "page" &&
        target.url === EXPECTED_URL &&
        target.title === WORKSPACE_TITLE,
    ),
    `port ${session.port}`,
  );
} catch (error) {
  note(
    "cdp-workspace",
    false,
    error instanceof Error ? error.message : String(error),
  );
}

let state;
if (checks.every((check) => check.ok)) {
  const page = await connectWorkspace(session);
  try {
    state = await workspaceState(page);
    note("title", state.title === WORKSPACE_TITLE, state.title);
    note("url", state.url === EXPECTED_URL, state.url);
    note(
      "cli-rail",
      state.cliVersion === `skills ${PINNED_CLI}`,
      state.cliVersion,
    );
    note(
      "owned-instance",
      state.skillNames.includes(QA_PROJECT_SKILL) ||
        state.banners.some((banner) => banner.includes("No skills found")) ||
        state.banners.some((banner) =>
          banner.includes("Inventory unavailable"),
        ),
      state.skillNames.join(", ") || state.banners.join(" | "),
    );
  } finally {
    await page.disconnect();
  }
}

const ok = checks.every((check) => check.ok);
const report = {
  checks,
  ok,
  session: {
    evidenceDir: session.evidenceDir,
    pid: session.pid,
    port: session.port,
    runId: session.runId,
  },
  workspaceState: state,
};
await writeJson(join(session.evidenceDir, "doctor.json"), report);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!ok || !fixtureOk) process.exit(1);
