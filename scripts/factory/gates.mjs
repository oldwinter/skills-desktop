import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_GATE_TIMEOUT_MS = 15 * 60 * 1000;

function gateExecutable(executable) {
  // npm is a .cmd shim on Windows; POSIX resolves its shebang directly.
  if (executable === "npm" && process.platform === "win32") return "npm.cmd";
  return executable;
}

// Runs one gate as an argument-array child process. Output is streamed to a
// per-gate log inside the attempt evidence directory; no shell is involved.
export function runGate(gate, { cwd, logPath, timeoutMs }) {
  const startedAt = Date.now();
  const [executable, ...args] = gate.argv;
  return new Promise((resolve) => {
    const log = createWriteStream(logPath, { flags: "w" });
    let timedOut = false;
    const child = spawn(gateExecutable(executable), args, {
      cwd,
      // A POSIX gate runs as its own process-group leader so timeout
      // termination reaches descendants, not just the gate PID.
      detached: process.platform !== "win32",
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const signalTree = (signal) => {
      if (child.pid === undefined) return;
      try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (error) {
        // ESRCH means the group is already gone; anything else is recorded
        // so a failed signal cannot crash the factory mid-run.
        if (error.code !== "ESRCH") {
          log.write(`gate termination signal failed: ${error.message}\n`);
        }
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      signalTree("SIGTERM");
      setTimeout(() => signalTree("SIGKILL"), 5_000).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => log.write(chunk));
    child.stderr.on("data", (chunk) => log.write(chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      log.end(`spawn error: ${error.message}\n`, () =>
        resolve({
          durationMs: Date.now() - startedAt,
          exitCode: null,
          logPath,
          name: gate.name,
          ok: false,
          spawnError: error.message,
          timedOut,
        }),
      );
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      log.end(() =>
        resolve({
          durationMs: Date.now() - startedAt,
          exitCode: code,
          logPath,
          name: gate.name,
          ok: code === 0 && !timedOut,
          signal,
          timedOut,
        }),
      );
    });
  });
}

// Runs the ordered gate plan fail-fast, mirroring `npm run verify`'s `&&`
// chaining: the first failed gate stops the plan and fails the attempt.
export async function runGatePlan(gates, { attemptDir, cwd }) {
  const results = [];
  for (const gate of gates) {
    const logPath = join(attemptDir, `${gate.name}.log`);
    const result = await runGate(gate, {
      cwd,
      logPath,
      timeoutMs: gate.timeoutMs ?? DEFAULT_GATE_TIMEOUT_MS,
    });
    results.push(result);
    if (!result.ok) break;
  }
  await writeFile(
    join(attemptDir, "gates.json"),
    `${JSON.stringify({ at: new Date().toISOString(), results }, null, 2)}\n`,
    "utf8",
  );
  return { ok: results.every((result) => result.ok), results };
}
