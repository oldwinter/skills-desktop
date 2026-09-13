#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const helpersDir = dirname(fileURLToPath(import.meta.url));
const node = process.execPath;

function run(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(node, [join(helpersDir, script), ...args], {
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${script} ${args.join(" ")} failed (${signal ?? `exit ${code}`}).`,
          ),
        );
    });
  });
}

async function cleanupIfNeeded() {
  try {
    await run("cleanup.mjs");
  } catch {
    // No live session, or cleanup already ran.
  }
}

let evidenceDir;
try {
  await cleanupIfNeeded();
  await run("launch.mjs");
  await run("doctor.mjs");
  await run("drive.mjs", ["screenshot", "01-inventory-loaded.png"]);
  await run("drive.mjs", ["state", "01-inventory-loaded"]);
  await run("drive.mjs", ["click-skill", "qa-project-skill"]);
  await run("drive.mjs", [
    "wait",
    `document.querySelector(".inspector h2")?.textContent?.trim() === "qa-project-skill" && document.body.textContent.includes("example/skills-desktop-qa")`,
    "project skill evidence",
  ]);
  await run("drive.mjs", ["screenshot", "02-inventory-selected.png"]);
  await run("drive.mjs", ["fill", "Search inventory", "qa-project"]);
  await run("drive.mjs", [
    "wait",
    `document.body.textContent.includes("1 matching skill") && document.body.textContent.includes("1 shown")`,
    "filtered inventory",
  ]);
  await run("drive.mjs", ["screenshot", "03-inventory-filtered.png"]);
  await run("drive.mjs", ["click", "Clear inventory search"]);
  await run("drive.mjs", [
    "wait",
    `document.body.textContent.includes("2 skills across project and global scopes")`,
    "cleared inventory filters",
  ]);
  await run("drive.mjs", ["screenshot", "04-inventory-cleared.png"]);
  await run("drive.mjs", ["invocations"]);
  await run("drive.mjs", ["inventory"]);
  await run("drive.mjs", ["state", "04-inventory-cleared"]);

  const { readSession } = await import("./lib.mjs");
  const session = await readSession();
  evidenceDir = session.evidenceDir;
  await run("cleanup.mjs");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  try {
    const { readSession } = await import("./lib.mjs");
    const session = await readSession();
    evidenceDir = session.evidenceDir;
  } catch {
    // Session may already be gone.
  }
  await cleanupIfNeeded();
  process.exitCode = 1;
}

if (evidenceDir) {
  try {
    await access(evidenceDir);
    const files = await readdir(evidenceDir);
    process.stdout.write(
      [
        "inventory proof complete",
        `evidence ${evidenceDir}`,
        `files ${files.join(", ")}`,
        "",
      ].join("\n"),
    );
    if (
      !files.includes("01-inventory-loaded.png") ||
      !files.includes("02-inventory-selected.png") ||
      !files.includes("cleanup.json")
    ) {
      process.stderr.write("Evidence is missing required proof files.\n");
      process.exitCode = 1;
    }
  } catch {
    process.stderr.write(`Evidence directory missing after cleanup: ${evidenceDir}\n`);
    process.exitCode = 1;
  }
}
