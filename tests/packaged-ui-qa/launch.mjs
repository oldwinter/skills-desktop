import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

import { CdpPage } from "./cdp.mjs";
import { resolvePackagedExecutable } from "./fixture.mjs";

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 3_000;
const DEFAULT_WINDOWS_TREE_TIMEOUT_MS = DEFAULT_STOP_TIMEOUT_MS;
export const EXPECTED_URL = "skills-desktop://workspace/index.html";

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
    child.once("exit", (code, signal) => finish({ code, kind: "exit", signal }));
  });
}

async function waitForTarget(port, expectedUrl, childExit, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error("Packaged Electron did not publish a CDP page in time.");
    }
    const exit = await Promise.race([
      childExit.then((value) => value),
      fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(Math.min(remaining, 1_000)),
      })
        .then((response) => response.json())
        .then((targets) => ({ kind: "targets", targets }))
        .catch(() => ({ kind: "targets", targets: [] })),
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
  {
    execFileImpl = execFile,
    timeoutMs = DEFAULT_WINDOWS_TREE_TIMEOUT_MS,
  } = {},
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
    platform = process.platform,
    killWindowsTree = terminateWindowsProcessTree,
    stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
    treeTerminationTimeoutMs = DEFAULT_WINDOWS_TREE_TIMEOUT_MS,
  } = {},
) {
  if (child.exitCode === null && child.signalCode === null) {
    try {
      if (platform === "win32" && child.pid !== undefined) {
        await Promise.race([
          Promise.resolve().then(() => killWindowsTree(child.pid)),
          delay(treeTerminationTimeoutMs).then(() => {
            throw new Error(
              `Windows process-tree termination timed out for PID ${child.pid}.`,
            );
          }),
        ]);
      } else if (child.pid === undefined) {
        child.kill("SIGTERM");
      } else process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  const stopped = await Promise.race([
    childExit.then(() => true),
    delay(stopTimeoutMs).then(() => false),
  ]);
  if (stopped || child.exitCode !== null || child.signalCode !== null) return;

  try {
    if (platform === "win32" && child.pid !== undefined) {
      await Promise.race([
        Promise.resolve().then(() => killWindowsTree(child.pid)),
        delay(treeTerminationTimeoutMs).then(() => {
          throw new Error(
            `Windows process-tree termination timed out for PID ${child.pid}.`,
          );
        }),
      ]);
    } else if (child.pid === undefined) {
      child.kill("SIGKILL");
    } else process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  await Promise.race([childExit, delay(stopTimeoutMs)]);
}

export async function launchPackagedElectron({
  executable = resolvePackagedExecutable(),
  expectedUrl = EXPECTED_URL,
  fixture,
  port: requestedPort,
  sessionName = `skills-desktop-qa-${process.pid}`,
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
    );
    const page = await CdpPage.connect(port, expectedUrl, {
      connectTimeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
    });
    return {
      child,
      errors: page.errors,
      expectedUrl,
      page,
      port,
      sessionName,
      async close() {
        await page.disconnect().catch(() => undefined);
        await stopChild(child, childExit);
        stdout.end();
        stderr.end();
      },
    };
  } catch (error) {
    await stopChild(child, childExit).catch(() => undefined);
    stdout.destroy();
    stderr.destroy();
    throw error;
  }
}
