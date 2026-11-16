#!/usr/bin/env node
// Read-only: is this checkout worth driving? No app is launched here.

import { execFileSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePackagedExecutable } from "../../../../tests/packaged-ui-qa/fixture.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok" : "FAIL"} ${name}${detail === undefined ? "" : `: ${detail}`}`);
}

const [major, minor] = process.versions.node.split(".").map(Number);
check(
  "node>=22.20",
  major > 22 || (major === 22 && minor >= 20),
  process.versions.node,
);

const executable = resolvePackagedExecutable();
let executableStat;
try {
  executableStat = statSync(executable);
  accessSync(executable, constants.X_OK);
} catch {
  executableStat = undefined;
}
check(
  "packaged-executable",
  executableStat?.isFile() === true,
  executable,
);
if (executableStat?.isFile() === true && process.platform === "darwin") {
  let arch = "unknown";
  try {
    arch = execFileSync("file", ["-b", executable], { encoding: "utf8" }).trim();
  } catch {
    arch = "unreadable";
  }
  check(
    "executable-arch",
    arch.includes("arm64") === (process.arch === "arm64"),
    `${process.arch} <- ${arch}`,
  );
}

const require = createRequire(import.meta.url);
let axePath;
try {
  axePath = require.resolve("axe-core/axe.min.js");
  accessSync(axePath, constants.R_OK);
} catch {
  axePath = undefined;
}
check("axe-core", axePath !== undefined, axePath);

for (const artifact of [
  "apps/desktop/dist/main/index.js",
  "apps/desktop/dist/preload/workspace.cjs",
  "apps/desktop/dist/renderer/index.html",
  "apps/desktop/dist/review-renderer/index.html",
]) {
  const path = join(repositoryRoot, artifact);
  check(`build-artifact ${artifact}`, statSync(path, { throwIfNoEntry: false })?.isFile() === true);
}

const failures = checks.filter(({ ok }) => !ok);
console.log(
  JSON.stringify(
    {
      executable,
      ok: failures.length === 0,
      platform: process.platform,
      arch: process.arch,
      failures: failures.map(({ name }) => name),
    },
    null,
    2,
  ),
);
if (failures.length > 0) process.exit(1);
