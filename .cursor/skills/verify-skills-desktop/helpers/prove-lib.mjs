import { spawn } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const helpersDir = dirname(fileURLToPath(import.meta.url));
const node = process.execPath;

export function runHelper(script, args = []) {
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

export async function cleanupIfNeeded() {
  try {
    await runHelper("cleanup.mjs");
  } catch {
    // No live session, or cleanup already ran.
  }
}

export async function runProof({
  assertEvidence,
  label,
  requiredFiles,
  steps,
}) {
  let evidenceDir;
  let exitCode = 0;
  try {
    await cleanupIfNeeded();
    await runHelper("launch.mjs");
    await runHelper("doctor.mjs");
    for (const [script, args] of steps) {
      await runHelper(script, args);
    }
    const { readSession } = await import("./lib.mjs");
    const session = await readSession();
    evidenceDir = session.evidenceDir;
    await runHelper("cleanup.mjs");
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
    exitCode = 1;
  }

  if (!evidenceDir) {
    process.exitCode = 1;
    return;
  }

  try {
    await access(evidenceDir);
    const files = await readdir(evidenceDir);
    process.stdout.write(
      [
        `${label} proof complete`,
        `evidence ${evidenceDir}`,
        `files ${files.join(", ")}`,
        "",
      ].join("\n"),
    );
    const missing = requiredFiles.filter((name) => !files.includes(name));
    if (missing.length > 0) {
      process.stderr.write(
        `Evidence is missing required proof files: ${missing.join(", ")}.\n`,
      );
      exitCode = 1;
    } else if (assertEvidence) {
      try {
        await assertEvidence(evidenceDir);
      } catch (error) {
        process.stderr.write(
          `${error instanceof Error ? error.message : error}\n`,
        );
        exitCode = 1;
      }
    }
  } catch {
    process.stderr.write(
      `Evidence directory missing after cleanup: ${evidenceDir}\n`,
    );
    exitCode = 1;
  }

  if (exitCode !== 0) process.exitCode = exitCode;
}
