import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { finished } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";

import { CdpPage } from "./cdp.mjs";
import { resolvePackagedExecutable } from "./fixture.mjs";

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 3_000;
const DEFAULT_WINDOWS_TREE_TIMEOUT_MS = DEFAULT_STOP_TIMEOUT_MS;
export const EXPECTED_URL = "skills-desktop://workspace/index.html";

function isPosixProcessGroupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForPosixProcessGroupExit(pid, timeoutMs, isAlive) {
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await delay(Math.min(25, remaining));
  }
  return true;
}

async function closeOutputStreams(child, stdout, stderr) {
  child.stdout?.unpipe(stdout);
  child.stderr?.unpipe(stderr);
  child.stdout?.destroy();
  child.stderr?.destroy();
  stdout.end();
  stderr.end();
  const results = await Promise.allSettled([finished(stdout), finished(stderr)]);
  return results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
}

export async function findAvailablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : undefined;
  await new Promise((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("Could not allocate a loopback CDP port.");
  }
  return port;
}

function observeExit(child) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.once("error", (error) => finish({ error, kind: "error" }));
    child.once("exit", (code, signal) =>
      finish({ code, kind: "exit", signal }),
    );
  });
}

async function waitForTarget(port, expectedUrl, childExit, timeoutMs, signal) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted)
      throw new Error("Packaged Electron launch was interrupted.");
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error("Packaged Electron did not publish a CDP page in time.");
    }
    const exit = await Promise.race([
      childExit.then((value) => value),
      fetch(`http://127.0.0.1:${port}/json/list`, {
        signal:
          signal === undefined
            ? AbortSignal.timeout(Math.min(remaining, 1_000))
            : AbortSignal.any([
                signal,
                AbortSignal.timeout(Math.min(remaining, 1_000)),
              ]),
      })
        .then((response) => response.json())
        .then((targets) => ({ kind: "targets", targets }))
        .catch(() => {
          if (signal?.aborted) {
            throw new Error("Packaged Electron launch was interrupted.");
          }
          return { kind: "targets", targets: [] };
        }),
    ]);
    if (exit.kind === "exit" || exit.kind === "error") {
      throw new Error(
        "Packaged Electron exited before its CDP page was ready.",
      );
    }
    const target = exit.targets.find(
      ({ type, url }) =>
        type === "page" && (expectedUrl === undefined || url === expectedUrl),
    );
    if (target !== undefined) return target;
    await delay(Math.min(50, remaining));
  }
}

export function terminateWindowsProcessTree(
  pid,
  { execFileImpl = execFile, timeoutMs = DEFAULT_WINDOWS_TREE_TIMEOUT_MS } = {},
) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return Promise.reject(new Error("A valid process id is required."));
  }
  const termination = new Promise((resolve, reject) => {
    try {
      execFileImpl(
        "taskkill.exe",
        ["/pid", String(pid), "/t", "/f"],
        {
          shell: false,
          timeout: timeoutMs,
          windowsHide: true,
        },
        (error) => {
          if (error === null || error === undefined) resolve();
          else reject(error);
        },
      );
    } catch (error) {
      reject(error);
    }
  });
  return Promise.race([
    termination,
    delay(timeoutMs).then(() => {
      throw new Error(
        `Windows process-tree termination timed out for PID ${pid}.`,
      );
    }),
  ]);
}

export async function stopChild(
  child,
  childExit,
  {
    killWindowsTree = terminateWindowsProcessTree,
    platform = process.platform,
    posixProcessGroupAlive = isPosixProcessGroupAlive,
    signalPosixProcessGroup = (pid, signal) => process.kill(-pid, signal),
    stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
    treeTerminationTimeoutMs = DEFAULT_WINDOWS_TREE_TIMEOUT_MS,
  } = {},
) {
  if (platform === "win32") {
    const childPid =
      Number.isSafeInteger(child.pid) && child.pid > 0
        ? child.pid
        : undefined;
    if (childPid !== undefined) {
      await Promise.race([
        Promise.resolve().then(() => killWindowsTree(childPid)),
        delay(treeTerminationTimeoutMs).then(() => {
          throw new Error(
            `Windows process-tree termination timed out for PID ${childPid}.`,
          );
        }),
      ]);
    } else if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    } else return;

    if (child.exitCode !== null || child.signalCode !== null) return;
    const stopped = await Promise.race([
      childExit.then(() => true),
      delay(stopTimeoutMs).then(() => false),
    ]);
    if (stopped || child.exitCode !== null || child.signalCode !== null) return;
    throw new Error(
      `Windows process tree did not exit after forced termination for PID ${childPid}.`,
    );
  }

  if (child.pid !== undefined) {
    try {
      signalPosixProcessGroup(child.pid, "SIGTERM");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
    if (
      await waitForPosixProcessGroupExit(
        child.pid,
        stopTimeoutMs,
        posixProcessGroupAlive,
      )
    ) {
      return;
    }
    try {
      signalPosixProcessGroup(child.pid, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
    if (
      !(await waitForPosixProcessGroupExit(
        child.pid,
        stopTimeoutMs,
        posixProcessGroupAlive,
      ))
    ) {
      throw new Error(
        "Packaged Electron process group did not exit after forced termination.",
      );
    }
    return;
  }

  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill("SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  const stopped = await Promise.race([
    childExit.then(() => true),
    delay(stopTimeoutMs).then(() => false),
  ]);
  if (stopped || child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill("SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  const killed = await Promise.race([
    childExit.then(() => true),
    delay(stopTimeoutMs).then(() => false),
  ]);
  if (!killed && child.exitCode === null && child.signalCode === null) {
    throw new Error("Packaged Electron did not exit after forced termination.");
  }
}

export async function launchPackagedElectron({
  executable = resolvePackagedExecutable(),
  expectedUrl = EXPECTED_URL,
  fixture,
  port: requestedPort,
  sessionName = `skills-desktop-qa-${process.pid}`,
  signal,
} = {}) {
  if (
    fixture === undefined ||
    typeof fixture.root !== "string" ||
    typeof fixture.userData !== "string" ||
    fixture.environment === undefined
  ) {
    throw new Error(
      "A fixture-owned root is required to launch packaged Electron.",
    );
  }
  if (typeof executable !== "string" || executable.length === 0) {
    throw new Error("A packaged Electron executable is required.");
  }
  if (signal?.aborted)
    throw new Error("Packaged Electron launch was interrupted.");
  await access(executable).catch(() => {
    throw new Error(
      `Packaged Electron executable is unavailable: ${executable}`,
    );
  });

  const port = requestedPort ?? (await findAvailablePort());
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("Packaged Electron CDP port must be a valid TCP port.");
  }
  await mkdir(fixture.userData, { recursive: true });
  await mkdir(fixture.artifacts, { recursive: true });
  const stdout = createWriteStream(`${fixture.artifacts}/electron.stdout.log`, {
    flags: "a",
    mode: 0o600,
  });
  const stderr = createWriteStream(`${fixture.artifacts}/electron.stderr.log`, {
    flags: "a",
    mode: 0o600,
  });
  const environment = { ...process.env, ...fixture.environment };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    executable,
    [`--remote-debugging-port=${port}`, `--user-data-dir=${fixture.userData}`],
    {
      cwd: fixture.workspace,
      detached: process.platform !== "win32",
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  child.stdout?.pipe(stdout);
  child.stderr?.pipe(stderr);
  const childExit = observeExit(child);
  try {
    await waitForTarget(
      port,
      expectedUrl,
      childExit,
      DEFAULT_CONNECT_TIMEOUT_MS,
      signal,
    );
    const page = await CdpPage.connect(port, expectedUrl, {
      connectTimeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
      signal,
    });
    return {
      child,
      errors: page.errors,
      expectedUrl,
      page,
      port,
      sessionName,
      async close() {
        const failures = [];
        try {
          await page.disconnect();
        } catch (error) {
          failures.push(error);
        }
        try {
          await stopChild(child, childExit);
        } catch (error) {
          failures.push(error);
        }
        failures.push(...(await closeOutputStreams(child, stdout, stderr)));
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) {
          throw new AggregateError(
            failures,
            "Packaged Electron session cleanup failed.",
          );
        }
      },
    };
  } catch (error) {
    const cleanupFailures = [];
    try {
      await stopChild(child, childExit);
    } catch (failure) {
      cleanupFailures.push(failure);
    }
    cleanupFailures.push(...(await closeOutputStreams(child, stdout, stderr)));
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [error, ...cleanupFailures],
        "Packaged Electron launch and cleanup both failed.",
      );
    }
    throw error;
  }
}
