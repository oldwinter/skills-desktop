import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_GATE_TIMEOUT_MS = 15 * 60 * 1000;

// The single in-flight gate and the signal that interrupted it, so the CLI
// can forward SIGINT/SIGTERM to the gate's process group instead of leaving
// a detached group orphaned.
let activeGate = null;
let interruptedBy = null;

export function interruptActiveGate(signal) {
  interruptedBy ??= signal;
  if (activeGate === null) return false;
  activeGate(signal);
  return true;
}

export function gateInterruptSignal() {
  return interruptedBy;
}

function gateExecutable(executable) {
  // npm is a .cmd shim on Windows; POSIX resolves its shebang directly.
  if (executable === "npm" && process.platform === "win32") return "npm.cmd";
  return executable;
}

// Runs one gate as an argument-array child process. Output is streamed to a
// per-gate log inside the attempt evidence directory; no shell is involved.
// On cancellation the gate does not resolve at the leader's close: the
// detached group is polled until empty (escalating to SIGKILL after
// `escalationMs`), so a descendant that ignores the first signal cannot
// outlive the factory process.
export function runGate(gate, { cwd, escalationMs = 5_000, logPath, timeoutMs }) {
  const startedAt = Date.now();
  const [executable, ...args] = gate.argv;
  return new Promise((resolve) => {
    const log = createWriteStream(logPath, { flags: "w" });
    let timedOut = false;
    let closed = null;
    let capReached = false;
    let drained = false;
    let terminating = null;
    const timers = new Set();
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
    // Probes only the group this gate created: ESRCH means the last member
    // exited or was reaped after reparenting.
    const groupAlive = () => {
      if (child.pid === undefined) return false;
      try {
        process.kill(process.platform === "win32" ? child.pid : -child.pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const finish = () => {
      if (closed === null) return;
      if (terminating !== null && !drained && !capReached) return;
      for (const timer of timers) {
        clearTimeout(timer);
        clearInterval(timer);
      }
      activeGate = null;
      log.end(() =>
        resolve({
          drained: terminating === null ? null : drained,
          durationMs: Date.now() - startedAt,
          exitCode: closed.code,
          interrupted: interruptedBy,
          logPath,
          name: gate.name,
          ok: closed.code === 0 && !timedOut && interruptedBy === null,
          signal: closed.signal,
          timedOut,
        }),
      );
    };
    const beginTermination = (signal) => {
      signalTree(signal);
      if (terminating !== null) return;
      terminating = signal;
      // Ref'd handles hold the event loop until the group is empty; the
      // leader's `close` alone proves nothing about descendants.
      timers.add(
        setTimeout(() => {
          if (!drained) {
            log.write(
              `gate group survived ${signal}; escalating to SIGKILL\n`,
            );
            signalTree("SIGKILL");
          }
        }, escalationMs),
      );
      // Bound the drain so a wedged probe cannot hang the factory forever;
      // the result records drained=false when the cap fires first.
      timers.add(
        setTimeout(() => {
          if (!drained) {
            log.write("gate group drain cap reached before the group emptied\n");
            capReached = true;
          }
          finish();
        }, escalationMs + 2_000),
      );
      timers.add(
        setInterval(() => {
          if (!groupAlive()) {
            drained = true;
            finish();
          }
        }, 50),
      );
      // Covers a signal that lands after the leader already closed and the
      // group drained on its own: resolve without waiting a poll tick.
      if (!groupAlive()) drained = true;
      finish();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      beginTermination("SIGTERM");
    }, timeoutMs);
    timers.add(timer);
    // Registered for the CLI's signal handlers: a forwarded signal reaches
    // the whole group, with the same SIGKILL escalation as the timeout path.
    activeGate = (forwarded) => beginTermination(forwarded);
    child.stdout.on("data", (chunk) => log.write(chunk));
    child.stderr.on("data", (chunk) => log.write(chunk));
    child.once("error", (error) => {
      activeGate = null;
      for (const timer of timers) {
        clearTimeout(timer);
        clearInterval(timer);
      }
      log.end(`spawn error: ${error.message}\n`, () =>
        resolve({
          drained: terminating === null ? null : drained,
          durationMs: Date.now() - startedAt,
          exitCode: null,
          interrupted: interruptedBy,
          logPath,
          name: gate.name,
          ok: false,
          spawnError: error.message,
          timedOut,
        }),
      );
    });
    child.once("close", (code, signal) => {
      closed = { code, signal };
      if (terminating !== null && groupAlive() === false) drained = true;
      finish();
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
