import { readFileSync } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  watch,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import {
  CLI_PACKAGE,
  CLI_VERSION,
  describeSource,
  type Inventory,
  type MutationIntent,
} from "@skills-desktop/skills-runtime";

import {
  createLocalSkillsProcess,
  createSpawnProcessRunner,
  ProcessBoundaryError,
  resolvePosixNpxCommand,
  resolveWindowsNpxCommand,
  type ProcessInvocation,
  type ProcessRunner,
} from "./local-skills-process.js";
import {
  observedMutationEffects,
  prepareMutationPlan,
} from "./skills-process.js";

const projectOutput = JSON.stringify([
  {
    name: "project-skill",
    path: "/workspace/.agents/skills/project-skill",
    scope: "project",
    agents: ["Codex"],
    source: null,
    sourceUrl: null,
    sourceType: null,
  },
]);

const globalOutput = JSON.stringify([
  {
    name: "global-skill",
    path: "/users/example/.agents/skills/global-skill",
    scope: "global",
    agents: ["Codex"],
    source: "example/skills",
    sourceUrl: "https://github.com/example/skills.git",
    sourceType: "github",
  },
]);

const scriptedPosixNpxCommand = {
  executable: "npx",
  path: "/usr/bin:/bin",
} as const;

function scriptedRunner(): ProcessRunner & {
  invocations: ProcessInvocation[];
} {
  const invocations: ProcessInvocation[] = [];
  return {
    invocations,
    async run(invocation) {
      invocations.push(invocation);
      const packageIndex = invocation.args.indexOf(CLI_PACKAGE);
      const operation = invocation.args.slice(packageIndex + 1).join(" ");
      if (operation === "--version") {
        return { exitCode: 0, stderr: "", stdout: "1.5.23\n" };
      }
      if (operation === "list --json") {
        return {
          exitCode: 0,
          stderr: "informational notice",
          stdout: projectOutput,
        };
      }
      if (operation === "list --global --json") {
        return { exitCode: 0, stderr: "", stdout: globalOutput };
      }
      throw new Error("Unexpected scripted invocation");
    },
  };
}

// Extensionless executables inherit the module type of the nearest ancestor
// package.json, so every fixture directory gets its own CommonJS scope to
// keep require() working when TMPDIR sits inside an ES-module package.
async function writeCommonJsExecutable(
  directory: string,
  name: string,
  source: string,
) {
  await writeFile(
    join(directory, "package.json"),
    '{"type":"commonjs"}\n',
    "utf8",
  );
  const executable = join(directory, name);
  await writeFile(executable, source, "utf8");
  await chmod(executable, 0o700);
  return executable;
}

describe("Local SkillsProcess inventory contract", () => {
  it("scopes generated executables as CommonJS inside an ES-module package", async () => {
    const parent = await mkdtemp(join(tmpdir(), "skills-esm-parent-"));
    try {
      await writeFile(
        join(parent, "package.json"),
        '{"type":"module"}\n',
        "utf8",
      );
      const bin = join(parent, "bin");
      await mkdir(bin);
      const marker = join(parent, "marker");
      const executable = await writeCommonJsExecutable(
        bin,
        "npx",
        `#!/usr/bin/env node
require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");
`,
      );

      const exitCode = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(process.execPath, [executable], {
          stdio: "ignore",
        });
        child.once("error", reject);
        child.once("close", resolve);
      });

      expect(exitCode).toBe(0);
      await expect(readFile(marker, "utf8")).resolves.toBe("ran");
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "resolves a user-installed npx outside the macOS GUI launch PATH",
    async () => {
      const home = await mkdtemp(
        join(tmpdir(), "skills-desktop-macos-path-"),
      );
      const bin = join(home, ".local", "bin");
      await mkdir(bin, { recursive: true });
      // A symlink, not a copy: dynamically linked Node builds (for example a
      // Homebrew Cellar install) resolve their shared libraries relative to
      // the real executable, so a copied binary cannot start.
      await symlink(process.execPath, join(bin, "node"));
      await writeCommonJsExecutable(
        bin,
        "npx",
        `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.at(-1) === "--version") process.stdout.write("1.5.23\\n");
else if (args.join(" ").endsWith("list --json")) process.stdout.write(${JSON.stringify(projectOutput)});
else if (args.join(" ").endsWith("list --global --json")) process.stdout.write(${JSON.stringify(globalOutput)});
else process.exitCode = 2;
`,
      );

      try {
        const localProcess = createLocalSkillsProcess({
          clock: () => new Date("2026-08-21T10:00:00.000Z"),
          environment: {
            HOME: home,
            PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
          },
          platform: "darwin",
          runner: createSpawnProcessRunner({ platform: "darwin" }),
          workspace: home,
        });

        const result = await localProcess.observeInventory({
          signal: new AbortController().signal,
        });
        expect(result).toMatchObject({
          ok: true,
          value: {
            entries: [
              { name: "project-skill", scope: "project" },
              { name: "global-skill", scope: "global" },
            ],
          },
        });
      } finally {
        await rm(home, { force: true, recursive: true });
      }
    },
  );

  it("reports pinned archive installs with absent CLI provenance as content-unverified", () => {
    expect(
      observedMutationEffects(
        {
          names: ["find-skills"],
          scope: "project",
          source: {
            revision: "435076e78988e1e6ec40d00b0b1d76bdbbc5419a",
            source: "vercel-labs/skills",
            sourceType: "github",
          },
          type: "add",
        },
        {
          cliVersion: CLI_VERSION,
          entries: [
            {
              agents: [],
              contentFingerprint: { status: "unknown" },
              declaredSource: { source: null, sourceType: null },
              extensions: {},
              name: "find-skills",
              path: "/workspace/.agents/skills/find-skills",
              revision: { status: "unknown" },
              scope: "project",
              sourceUrl: null,
            },
          ],
          observedAt: "2026-08-22T06:00:00.000Z",
          schemaVersion: 1,
        },
        "Codex",
      ),
    ).toEqual({ status: "content-unverified" });
  });

  it.each(["linux", "darwin"] as const)(
    "verifies the dialect once and publishes one complete project-and-global Inventory on %s",
    async (platform) => {
      const runner = scriptedRunner();
      const process = createLocalSkillsProcess({
        clock: () => new Date("2026-08-21T10:00:00.000Z"),
        platform,
        posixNpxCommand: scriptedPosixNpxCommand,
        runner,
        workspace: "/workspace",
      });

      const first = await process.observeInventory({
        signal: new AbortController().signal,
      });
      const second = await process.observeInventory({
        signal: new AbortController().signal,
      });

      expect(first).toMatchObject({
        ok: true,
        value: {
          cliVersion: "1.5.23",
          entries: [
            { name: "project-skill", scope: "project" },
            { name: "global-skill", scope: "global" },
          ],
          observedAt: "2026-08-21T10:00:00.000Z",
          schemaVersion: 1,
        },
      });
      expect(second.ok).toBe(true);
      expect(
        runner.invocations.map(({ args, executable, shell }) => ({
          args,
          executable,
          shell,
        })),
      ).toEqual([
        {
          args: ["--yes", CLI_PACKAGE, "--version"],
          executable: "npx",
          shell: false,
        },
        {
          args: ["--yes", CLI_PACKAGE, "list", "--json"],
          executable: "npx",
          shell: false,
        },
        {
          args: ["--yes", CLI_PACKAGE, "list", "--global", "--json"],
          executable: "npx",
          shell: false,
        },
        {
          args: ["--yes", CLI_PACKAGE, "list", "--json"],
          executable: "npx",
          shell: false,
        },
        {
          args: ["--yes", CLI_PACKAGE, "list", "--global", "--json"],
          executable: "npx",
          shell: false,
        },
      ]);
    },
  );

  it("retries dialect verification after its owning observation is cancelled", async () => {
    const firstController = new AbortController();
    let versionChecks = 0;
    const runner = scriptedRunner();
    const originalRun = runner.run.bind(runner);
    runner.run = async (invocation) => {
      if (invocation.args.at(-1) === "--version") {
        versionChecks += 1;
        if (versionChecks === 1) firstController.abort();
      }
      return originalRun(invocation);
    };
    const skillsProcess = createLocalSkillsProcess({
      clock: () => new Date("2026-08-21T10:00:00.000Z"),
      platform: "linux",
      posixNpxCommand: scriptedPosixNpxCommand,
      runner,
      workspace: "/workspace",
    });

    expect(
      await skillsProcess.observeInventory({ signal: firstController.signal }),
    ).toMatchObject({
      error: { code: "cancelled" },
      ok: false,
    });
    expect(
      await skillsProcess.observeInventory({
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ ok: true });
    expect(versionChecks).toBe(2);
  });

  it("uses node.exe and npx-cli.js argument arrays with only the allowlisted Windows environment", async () => {
    const runner = scriptedRunner();
    const skillsProcess = createLocalSkillsProcess({
      clock: () => new Date("2026-08-21T10:00:00.000Z"),
      environment: {
        APPDATA: "C:\\Users\\example\\AppData\\Roaming",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
        Path: "C:\\tools",
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
        SECRET_TOKEN: "must-not-cross-boundary",
        SystemRoot: "C:\\Windows",
        USERPROFILE: "C:\\Users\\example",
      },
      platform: "win32",
      runner,
      windowsNpxCommand: {
        executable: "C:\\tools\\node.exe",
        npxCliPath: "C:\\tools\\node_modules\\npm\\bin\\npx-cli.js",
      },
      workspace: "C:\\workspace",
    });

    expect(
      await skillsProcess.observeInventory({
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ ok: true });
    expect(runner.invocations[0]).toMatchObject({
      cwd: "C:\\workspace",
      env: {
        APPDATA: "C:\\Users\\example\\AppData\\Roaming",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
        PATH: "C:\\tools",
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
        SystemRoot: "C:\\Windows",
        USERPROFILE: "C:\\Users\\example",
      },
      args: [
        "C:\\tools\\node_modules\\npm\\bin\\npx-cli.js",
        "--yes",
        CLI_PACKAGE,
        "--version",
      ],
      executable: "C:\\tools\\node.exe",
      shell: false,
    });
    expect(runner.invocations[0]?.env).not.toHaveProperty("SECRET_TOKEN");
  });

  it("resolves the Windows npx JavaScript entry point without parsing a command shim", async () => {
    const existing = new Set([
      "C:\\node\\node.exe",
      "C:\\node\\node_modules\\npm\\bin\\npx-cli.js",
    ]);

    await expect(
      resolveWindowsNpxCommand(
        { PATH: "C:\\unrelated;C:\\node" },
        async (path) => existing.has(path),
      ),
    ).resolves.toEqual({
      executable: "C:\\node\\node.exe",
      npxCliPath: "C:\\node\\node_modules\\npm\\bin\\npx-cli.js",
    });
  });

  it("starts Windows process-tree termination before the wrapper can close", async () => {
    const controller = new AbortController();
    const killed: number[] = [];
    const runner = createSpawnProcessRunner({
      async killWindowsTree(pid) {
        killed.push(pid);
        process.kill(pid, "SIGKILL");
      },
      platform: "win32",
    });
    const pending = runner.run({
      args: ["-e", "setInterval(() => undefined, 1000)"],
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "" },
      executable: process.execPath,
      maxOutputBytes: 1_024,
      shell: false,
      signal: controller.signal,
      timeoutMs: 10_000,
      windowsHide: true,
    });

    controller.abort();

    await expect(pending).resolves.toMatchObject({ exitCode: 1 });
    expect(killed).toHaveLength(1);
  });

  it("surfaces a bounded error when Windows tree termination cannot be confirmed", async () => {
    const controller = new AbortController();
    const runner = createSpawnProcessRunner({
      async killWindowsTree() {
        throw new Error("taskkill failed");
      },
      platform: "win32",
      windowsTreeTerminationTimeoutMs: 20,
    });
    const pending = runner.run({
      args: ["-e", "setInterval(() => undefined, 1000)"],
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "" },
      executable: process.execPath,
      maxOutputBytes: 1_024,
      shell: false,
      signal: controller.signal,
      timeoutMs: 10_000,
      windowsHide: true,
    });

    controller.abort();

    const failure = await pending.catch((error: unknown) => error);
    expect(failure).toMatchObject({
      disposition: "failed",
      message: "Process tree termination could not be confirmed.",
      started: true,
      termination: "unknown",
    });
  });

  it("captures large stdout completely when a child exits without draining its pipe", async () => {
    const output = JSON.stringify({ payload: "x".repeat(128 * 1_024) });
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "skills-desktop-capture-test-"),
    );
    const runner = createSpawnProcessRunner({
      platform: process.platform,
      temporaryDirectory,
    });

    try {
      const result = await runner.run({
        args: [
          "-e",
          'const { fstatSync } = require("node:fs"); console.error((fstatSync(1).mode & 0o777).toString(8)); console.log(JSON.stringify({ payload: "x".repeat(128 * 1024) })); process.exit(0);',
        ],
        cwd: process.cwd(),
        env: { PATH: process.env.PATH ?? "" },
        executable: process.execPath,
        maxOutputBytes: 1024 * 1024,
        shell: false,
        signal: new AbortController().signal,
        timeoutMs: 10_000,
        windowsHide: true,
      });

      expect(result.exitCode).toBe(0);
      if (process.platform !== "win32") expect(result.stderr).toBe("600\n");
      expect(Buffer.byteLength(result.stdout, "utf8")).toBe(
        Buffer.byteLength(output, "utf8") + 1,
      );
      expect(JSON.parse(result.stdout)).toEqual(JSON.parse(output));
      expect(await readdir(temporaryDirectory)).toEqual([]);
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  it("terminates a child that exceeds its time limit", async () => {
    const runner = createSpawnProcessRunner({ platform: process.platform });

    const failure = await runner
      .run({
        args: ["-e", "setInterval(() => undefined, 1000)"],
        cwd: process.cwd(),
        env: { PATH: process.env.PATH ?? "" },
        executable: process.execPath,
        maxOutputBytes: 1_024,
        shell: false,
        signal: new AbortController().signal,
        timeoutMs: 100,
        windowsHide: true,
      })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      disposition: "timed-out",
      message: "Process invocation exceeded its time limit.",
      started: true,
    });
  });

  it("rejects a child whose stderr exceeds the byte limit", async () => {
    const runner = createSpawnProcessRunner({ platform: process.platform });

    const failure = await runner
      .run({
        args: [
          "-e",
          'process.stderr.write("x".repeat(8 * 1024)); setInterval(() => undefined, 1000);',
        ],
        cwd: process.cwd(),
        env: { PATH: process.env.PATH ?? "" },
        executable: process.execPath,
        maxOutputBytes: 1_024,
        shell: false,
        signal: new AbortController().signal,
        timeoutMs: 10_000,
        windowsHide: true,
      })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      disposition: "failed",
      message: "Process output exceeded its byte limit.",
      started: true,
      termination: "known",
    });
  });

  it("rejects an invocation that is cancelled before spawn", async () => {
    const controller = new AbortController();
    controller.abort();
    const runner = createSpawnProcessRunner({ platform: process.platform });

    const failure = await runner
      .run({
        args: ["-e", "process.exit(0)"],
        cwd: process.cwd(),
        env: { PATH: process.env.PATH ?? "" },
        executable: process.execPath,
        maxOutputBytes: 1_024,
        shell: false,
        signal: controller.signal,
        timeoutMs: 10_000,
        windowsHide: true,
      })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      disposition: "cancelled",
      message: "Process invocation was cancelled before spawn.",
      started: false,
    });
  });

  it("resolves a running child that closes after abort-driven termination", async () => {
    const controller = new AbortController();
    const runner = createSpawnProcessRunner({ platform: process.platform });

    const pending = runner.run({
      args: ["-e", "setInterval(() => undefined, 1000)"],
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "" },
      executable: process.execPath,
      maxOutputBytes: 1_024,
      shell: false,
      signal: controller.signal,
      timeoutMs: 10_000,
      windowsHide: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      stderr: "",
      stdout: "",
    });
    const result = await pending;
    expect(result.exitCode === null || result.exitCode !== 0).toBe(true);
  });

  it("rejects file-backed stdout above the configured byte limit", async () => {
    const runner = createSpawnProcessRunner({ platform: process.platform });

    const failure = await runner
      .run({
        args: [
          "-e",
          'process.stdout.write("x".repeat(128 * 1024)); setInterval(() => undefined, 1000);',
        ],
        cwd: process.cwd(),
        env: { PATH: process.env.PATH ?? "" },
        executable: process.execPath,
        maxOutputBytes: 1_024,
        shell: false,
        signal: new AbortController().signal,
        timeoutMs: 10_000,
        windowsHide: true,
      })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      disposition: "failed",
      message: "Process output exceeded its byte limit.",
      started: true,
      termination: "known",
    });
  });

  it("returns cancellation without publishing either partial list", async () => {
    const controller = new AbortController();
    const runner: ProcessRunner = {
      run: vi.fn(async (invocation) => {
        if (invocation.args.at(-1) === "--version") {
          return { exitCode: 0, stderr: "", stdout: "1.5.23" };
        }
        controller.abort();
        return { exitCode: 0, stderr: "", stdout: projectOutput };
      }),
    };
    const process = createLocalSkillsProcess({
      clock: () => new Date("2026-08-21T10:00:00.000Z"),
      platform: "win32",
      runner,
      windowsNpxCommand: {
        executable: "C:\\tools\\node.exe",
        npxCliPath: "C:\\tools\\node_modules\\npm\\bin\\npx-cli.js",
      },
      workspace: "C:\\workspace",
    });

    const result = await process.observeInventory({
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      error: { code: "cancelled", effects: "none", phase: "observe" },
      ok: false,
    });
  });

  it.skipIf(process.platform === "win32")(
    "observes through the production process boundary without developer state",
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "skills-desktop-process-"),
      );
      await writeCommonJsExecutable(
        directory,
        "npx",
        `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.at(-1) === "--version") {
  process.stdout.write("1.5.23\\n");
} else if (args.join(" ").endsWith("list --json")) {
  process.stdout.write(${JSON.stringify(projectOutput)});
} else if (args.join(" ").endsWith("list --global --json")) {
  process.stdout.write(${JSON.stringify(globalOutput)});
} else {
  process.exitCode = 2;
}
`,
      );

      try {
        const localProcess = createLocalSkillsProcess({
          clock: () => new Date("2026-08-21T10:00:00.000Z"),
          environment: {
            HOME: directory,
            PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
          },
          platform: process.platform,
          runner: createSpawnProcessRunner({ platform: process.platform }),
          workspace: directory,
        });

        const result = await localProcess.observeInventory({
          signal: new AbortController().signal,
        });

        expect(result).toMatchObject({
          ok: true,
          value: {
            entries: [
              { name: "project-skill", scope: "project" },
              { name: "global-skill", scope: "global" },
            ],
          },
        });
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "terminates a cancelled production process tree without publishing partial output",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "skills-desktop-cancel-"));
      await writeCommonJsExecutable(
        directory,
        "npx",
        `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const args = process.argv.slice(2);
if (args.at(-1) === "--version") {
  process.stdout.write("1.5.23\\n");
} else {
  writeFileSync(join(process.env.HOME, "list-started-" + process.pid), "started");
  process.on("SIGTERM", () => undefined);
  setInterval(() => undefined, 1000);
}
`,
      );
      const changes = watch(directory);
      const iterator = changes[Symbol.asyncIterator]();

      try {
        const localProcess = createLocalSkillsProcess({
          clock: () => new Date("2026-08-21T10:00:00.000Z"),
          environment: {
            HOME: directory,
            PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
          },
          platform: process.platform,
          runner: createSpawnProcessRunner({
            cancellationGraceMs: 20,
            platform: process.platform,
          }),
          workspace: directory,
        });
        const controller = new AbortController();
        const pending = localProcess.observeInventory({
          signal: controller.signal,
        });

        await iterator.next();
        controller.abort();

        expect(await pending).toMatchObject({
          error: { code: "cancelled", effects: "none" },
          ok: false,
        });
      } finally {
        await iterator.return?.();
        await rm(directory, { force: true, recursive: true });
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "resolves and observes through the production Windows process boundary",
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "skills-desktop-windows-process-"),
      );
      const npmBin = join(directory, "node_modules", "npm", "bin");
      await mkdir(npmBin, { recursive: true });
      await copyFile(process.execPath, join(directory, "node.exe"));
      await writeFile(
        join(npmBin, "npx-cli.js"),
        `const args = process.argv.slice(2);
if (args.at(-1) === "--version") {
  process.stdout.write("1.5.23\\n");
} else if (args.join(" ").endsWith("list --json")) {
  process.stdout.write(${JSON.stringify(projectOutput)});
} else if (args.join(" ").endsWith("list --global --json")) {
  process.stdout.write(${JSON.stringify(globalOutput)});
} else {
  process.exitCode = 2;
}
`,
      );

      try {
        const localProcess = createLocalSkillsProcess({
          clock: () => new Date("2026-08-21T10:00:00.000Z"),
          environment: {
            PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
            SystemRoot: process.env.SystemRoot,
            TEMP: process.env.TEMP,
            TMP: process.env.TMP,
            USERPROFILE: directory,
          },
          platform: "win32",
          runner: createSpawnProcessRunner({ platform: "win32" }),
          workspace: directory,
        });

        expect(
          await localProcess.observeInventory({
            signal: new AbortController().signal,
          }),
        ).toMatchObject({
          ok: true,
          value: {
            entries: [
              { name: "project-skill", scope: "project" },
              { name: "global-skill", scope: "global" },
            ],
          },
        });
      } finally {
        await rm(directory, {
          force: true,
          maxRetries: 10,
          recursive: true,
          retryDelay: 100,
        });
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "terminates a real Windows descendant tree with taskkill",
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "skills-desktop-windows-cancel-"),
      );
      const pidPath = join(directory, "descendant.pid");
      const script = join(directory, "parent.cjs");
      await writeFile(
        script,
        `const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const child = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], {
  stdio: "ignore",
});
writeFileSync(process.argv[2], String(child.pid));
setInterval(() => undefined, 1000);
`,
      );
      const controller = new AbortController();
      let descendantPid: number | undefined;

      try {
        const runner = createSpawnProcessRunner({ platform: "win32" });
        const pending = runner.run({
          args: [script, pidPath],
          cwd: directory,
          env: {
            PATH: process.env.PATH ?? "",
            SystemRoot: process.env.SystemRoot ?? "",
            TEMP: process.env.TEMP ?? "",
            TMP: process.env.TMP ?? "",
          },
          executable: process.execPath,
          maxOutputBytes: 1_024,
          shell: false,
          signal: controller.signal,
          timeoutMs: 10_000,
          windowsHide: true,
        });
        descendantPid = await vi.waitFor(
          async () => {
            const pid = Number(await readFile(pidPath, "utf8"));
            if (!Number.isSafeInteger(pid) || pid <= 0) {
              throw new Error("The descendant PID file is not complete.");
            }
            return pid;
          },
          { interval: 25, timeout: 2_000 },
        );

        controller.abort();

        await expect(pending).resolves.toMatchObject({ exitCode: 1 });
        expect(() => process.kill(descendantPid!, 0)).toThrow();
      } finally {
        if (descendantPid !== undefined) {
          try {
            process.kill(descendantPid, "SIGKILL");
          } catch {
            // The production tree kill already removed the process.
          }
        }
        await rm(directory, {
          force: true,
          maxRetries: 10,
          recursive: true,
          retryDelay: 100,
        });
      }
    },
  );
});

describe("Local SkillsProcess mutation contract", () => {
  it("rejects case-folded display input instead of deriving CLI authority", () => {
    expect(
      prepareMutationPlan({
        binding: {
          generation: 1,
          harness: "CODEX",
          targetId: "00000000-0000-4000-8000-000000000001",
        },
        clock: () => new Date("2026-08-22T06:00:00.000Z"),
        input: {
          freshness: "fresh",
          intent: {
            names: ["new-skill"],
            scope: "project",
            source: {
              source: "example/skills",
              sourceType: "github",
            },
            type: "add",
          },
          inventory: {
            cliVersion: CLI_VERSION,
            entries: [],
            observedAt: "2026-08-22T06:00:00.000Z",
            schemaVersion: 1,
          },
          inventoryId: "canonical-inventory",
        },
      }),
    ).toMatchObject({
      error: { code: "mutation_ineligible", effects: "none" },
      ok: false,
    });
  });

  it("rejects a globally unsupported harness before constructing arguments", () => {
    expect(
      prepareMutationPlan({
        binding: {
          generation: 1,
          harness: "Eve",
          targetId: "00000000-0000-4000-8000-000000000001",
        },
        clock: () => new Date("2026-08-22T06:00:00.000Z"),
        input: {
          freshness: "fresh",
          intent: {
            names: ["new-skill"],
            scope: "global",
            source: {
              source: "example/skills",
              sourceType: "github",
            },
            type: "add",
          },
          inventory: {
            cliVersion: CLI_VERSION,
            entries: [],
            observedAt: "2026-08-22T06:00:00.000Z",
            schemaVersion: 1,
          },
          inventoryId: "canonical-inventory",
        },
      }),
    ).toMatchObject({
      error: { code: "mutation_ineligible", effects: "none" },
      ok: false,
    });
  });

  it("keeps every canonical Target harness in one CLI mutation plan", () => {
    expect(
      prepareMutationPlan({
        binding: {
          generation: 1,
          harnessIds: ["amp", "codex"],
          targetId: "00000000-0000-4000-8000-000000000001",
        },
        clock: () => new Date("2026-08-22T06:00:00.000Z"),
        id: () => "multi-harness-plan",
        input: {
          freshness: "fresh",
          intent: {
            names: ["new-skill"],
            scope: "project",
            source: {
              source: "example/skills",
              sourceType: "github",
            },
            type: "add",
          },
          inventory: {
            cliVersion: CLI_VERSION,
            entries: [],
            observedAt: "2026-08-22T06:00:00.000Z",
            schemaVersion: 1,
          },
          inventoryId: "canonical-inventory",
        },
      }),
    ).toMatchObject({
      ok: true,
      value: {
        args: [
          "add",
          "example/skills",
          "--skill",
          "new-skill",
          "--agent",
          "amp",
          "codex",
          "--yes",
        ],
        prepared: {
          commandPlan: {
            harness: "amp codex",
            harnessEffect: { harnessIds: ["amp", "codex"], kind: "bound" },
            harnessIds: ["amp", "codex"],
          },
        },
      },
    });
  });

  it("binds add and remove to an explicit subset of the Target harness set", () => {
    const binding = {
      generation: 1,
      harnessIds: ["amp", "codex", "cursor"],
      targetId: "00000000-0000-4000-8000-000000000001",
    };
    const inventory: Inventory = {
      cliVersion: CLI_VERSION,
      entries: [
        {
          agents: ["amp", "codex", "cursor"],
          contentFingerprint: { status: "unknown" },
          declaredSource: { source: null, sourceType: null },
          extensions: {},
          name: "shared-skill",
          path: "/workspace/.agents/skills/shared-skill",
          revision: { status: "unknown" },
          scope: "project",
          sourceUrl: null,
        },
      ],
      observedAt: "2026-08-22T06:00:00.000Z",
      schemaVersion: 1,
    };
    const plan = (intent: MutationIntent) =>
      prepareMutationPlan({
        binding,
        clock: () => new Date("2026-08-22T06:00:00.000Z"),
        id: () => "subset-plan",
        input: {
          freshness: "fresh",
          intent,
          inventory,
          inventoryId: "canonical-inventory",
        },
      });

    // Subset order is normalized to registry order and `--agent` narrows to it.
    expect(
      plan({
        harnessIds: ["cursor", "amp"],
        names: ["shared-skill"],
        scope: "project",
        type: "remove",
      }),
    ).toMatchObject({
      ok: true,
      value: {
        args: ["remove", "shared-skill", "--agent", "amp", "cursor", "--yes"],
        boundHarnessIds: ["amp", "cursor"],
        prepared: {
          commandPlan: {
            harness: "amp cursor",
            harnessEffect: { harnessIds: ["amp", "cursor"], kind: "bound" },
            harnessIds: ["amp", "cursor"],
          },
        },
      },
    });

    // A single-harness subset keeps the legacy single `harness` shape.
    expect(
      plan({
        harnessIds: ["codex"],
        names: ["new-skill"],
        scope: "project",
        source: { source: "example/skills", sourceType: "github" },
        type: "add",
      }),
    ).toMatchObject({
      ok: true,
      value: {
        args: [
          "add",
          "example/skills",
          "--skill",
          "new-skill",
          "--agent",
          "codex",
          "--yes",
        ],
        boundHarnessIds: ["codex"],
        prepared: {
          commandPlan: {
            harness: "codex",
            harnessEffect: { harnessIds: ["codex"], kind: "bound" },
          },
        },
      },
    });
    expect(plan({
      harnessIds: ["codex"],
      names: ["new-skill"],
      scope: "project",
      source: { source: "example/skills", sourceType: "github" },
      type: "add",
    })).not.toHaveProperty("value.prepared.commandPlan.harnessIds");

    // Harnesses outside the Target set, or unknown to the dialect, are refused.
    for (const harnessIds of [["claude-code"], ["codex", "not-a-harness"]]) {
      expect(
        plan({
          harnessIds,
          names: ["shared-skill"],
          scope: "project",
          type: "remove",
        }),
      ).toMatchObject({
        error: { code: "mutation_ineligible", effects: "none" },
        ok: false,
      });
    }

    // Update is CLI-unscoped: no `--agent`, and the plan says so.
    expect(
      plan({ names: ["shared-skill"], scope: "project", type: "update" }),
    ).toMatchObject({
      ok: true,
      value: {
        args: ["update", "shared-skill", "--project", "--yes"],
        prepared: {
          commandPlan: {
            harnessEffect: {
              kind: "cli-unscoped",
              targetHarnessIds: ["amp", "codex", "cursor"],
            },
          },
        },
      },
    });
  });

  it("uses canonical Codex availability for remove, update, and update-all", () => {
    const inventory: Inventory = {
      cliVersion: CLI_VERSION,
      entries: [
        {
          agents: [],
          contentFingerprint: { status: "unknown" },
          declaredSource: { source: null, sourceType: null },
          extensions: {},
          name: "canonical-skill",
          path: "/workspace/.agents/skills/canonical-skill",
          revision: { status: "unknown" },
          scope: "project",
          sourceUrl: null,
        },
      ],
      observedAt: "2026-08-22T06:00:00.000Z",
      schemaVersion: 1,
    };
    const intents = [
      {
        names: ["canonical-skill"],
        scope: "project" as const,
        type: "remove" as const,
      },
      {
        names: ["canonical-skill"],
        scope: "project" as const,
        type: "update" as const,
      },
      { scope: "project" as const, type: "update-all" as const },
    ];

    for (const intent of intents) {
      expect(
        prepareMutationPlan({
          binding: {
            generation: 1,
            harness: "Codex",
            targetId: "00000000-0000-4000-8000-000000000001",
          },
          clock: () => new Date("2026-08-22T06:00:00.000Z"),
          id: () => `prepared-${intent.type}`,
          input: {
            freshness: "fresh",
            intent,
            inventory,
            inventoryId: "canonical-inventory",
          },
        }),
      ).toMatchObject({
        ok: true,
        value: { mutation: { names: ["canonical-skill"] } },
      });
    }
    expect(
      observedMutationEffects(
        {
          names: ["canonical-skill"],
          scope: "project",
          type: "remove",
        },
        inventory,
        "Codex",
      ),
    ).toEqual({ status: "not-observed" });
    expect(
      observedMutationEffects(
        {
          names: ["canonical-skill"],
          scope: "project",
          type: "update",
        },
        inventory,
        "Codex",
      ),
    ).toEqual({ status: "content-unverified" });
  });

  it("expands update-all from Fresh Inventory into a bound review-only Command Plan", async () => {
    const runner = scriptedRunner();
    const skillsProcess = createLocalSkillsProcess({
      binding: {
        generation: 3,
        harness: "Codex",
        targetId: "00000000-0000-4000-8000-000000000001",
      },
      clock: () => new Date("2026-08-21T10:00:00.000Z"),
      id: () => "prepared-1",
      platform: "linux",
      posixNpxCommand: scriptedPosixNpxCommand,
      runner,
      workspace: "/workspace",
    });
    const observed = await skillsProcess.observeInventory({
      signal: new AbortController().signal,
    });
    if (!observed.ok) throw new Error("fixture observation failed");

    const prepared = await skillsProcess.prepareMutation({
      freshness: "fresh",
      intent: { scope: "global", type: "update-all" },
      inventory: observed.value,
      inventoryId: "inventory-7",
    });

    expect(prepared).toMatchObject({
      ok: true,
      value: {
        commandPlan: {
          harness: "Codex",
          names: ["global-skill"],
          operation: "update",
          preview: "npx skills@1.5.23 update global-skill --global --yes",
          schemaVersion: 1,
          scope: "global",
          targetId: "00000000-0000-4000-8000-000000000001",
          timeoutMs: 600_000,
        },
        expiresAt: "2026-08-21T10:10:00.000Z",
        id: "prepared-1",
        inventoryId: "inventory-7",
        targetGeneration: 3,
        targetId: "00000000-0000-4000-8000-000000000001",
      },
    });
    expect(prepared.ok && prepared.value.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(runner.invocations).toHaveLength(3);
  });

  it("executes a confirmed private plan once and verifies removal through atomic postflight", async () => {
    const invocations: ProcessInvocation[] = [];
    let removed = false;
    const runner: ProcessRunner = {
      async run(invocation) {
        invocations.push(invocation);
        const packageIndex = invocation.args.indexOf(CLI_PACKAGE);
        const operation = invocation.args.slice(packageIndex + 1).join(" ");
        if (operation === "--version") {
          return { exitCode: 0, stderr: "", stdout: "1.5.23\n" };
        }
        if (operation === "remove project-skill --agent codex --yes") {
          removed = true;
          return { exitCode: 0, stderr: "", stdout: "removed" };
        }
        if (operation === "list --json") {
          return {
            exitCode: 0,
            stderr: "",
            stdout: removed ? "[]" : projectOutput,
          };
        }
        if (operation === "list --global --json") {
          return { exitCode: 0, stderr: "", stdout: globalOutput };
        }
        throw new Error(`Unexpected scripted invocation: ${operation}`);
      },
    };
    const skillsProcess = createLocalSkillsProcess({
      binding: {
        generation: 3,
        harness: "Codex",
        targetId: "00000000-0000-4000-8000-000000000001",
      },
      clock: () => new Date("2026-08-21T10:00:00.000Z"),
      id: () => "prepared-remove",
      platform: "linux",
      posixNpxCommand: scriptedPosixNpxCommand,
      runner,
      workspace: "/workspace",
    });
    const observed = await skillsProcess.observeInventory({
      signal: new AbortController().signal,
    });
    if (!observed.ok) throw new Error("fixture observation failed");
    const prepared = await skillsProcess.prepareMutation({
      freshness: "fresh",
      intent: {
        names: ["project-skill"],
        scope: "project",
        type: "remove",
      },
      inventory: observed.value,
      inventoryId: "inventory-7",
    });
    if (!prepared.ok) throw new Error("fixture preparation failed");

    const executed = await skillsProcess.executeConfirmed({
      confirmation: {
        digest: prepared.value.digest,
        preparedMutationId: prepared.value.id,
      },
      signal: new AbortController().signal,
    });

    expect(executed).toMatchObject({
      ok: true,
      value: {
        effects: { status: "verified" },
        inventory: {
          entries: [{ name: "global-skill", scope: "global" }],
        },
        preparedMutationId: "prepared-remove",
        process: {
          disposition: "completed",
          exitCode: 0,
          termination: "known",
        },
      },
    });
    expect(
      invocations.map(({ args, shell, timeoutMs }) => ({
        args,
        shell,
        timeoutMs,
      })),
    ).toEqual([
      {
        args: ["--yes", CLI_PACKAGE, "--version"],
        shell: false,
        timeoutMs: 60_000,
      },
      {
        args: ["--yes", CLI_PACKAGE, "list", "--json"],
        shell: false,
        timeoutMs: 60_000,
      },
      {
        args: ["--yes", CLI_PACKAGE, "list", "--global", "--json"],
        shell: false,
        timeoutMs: 60_000,
      },
      {
        args: [
          "--yes",
          CLI_PACKAGE,
          "remove",
          "project-skill",
          "--agent",
          "codex",
          "--yes",
        ],
        shell: false,
        timeoutMs: 120_000,
      },
      {
        args: ["--yes", CLI_PACKAGE, "list", "--json"],
        shell: false,
        timeoutMs: 60_000,
      },
      {
        args: ["--yes", CLI_PACKAGE, "list", "--global", "--json"],
        shell: false,
        timeoutMs: 60_000,
      },
    ]);
    await expect(
      skillsProcess.executeConfirmed({
        confirmation: {
          digest: prepared.value.digest,
          preparedMutationId: prepared.value.id,
        },
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      error: { code: "confirmation_invalid" },
      ok: false,
    });
    expect(invocations).toHaveLength(6);
  });

  it("proves no mutation spawn and still establishes postflight evidence when already cancelled", async () => {
    const runner = scriptedRunner();
    const skillsProcess = createLocalSkillsProcess({
      binding: {
        generation: 3,
        harness: "Codex",
        targetId: "00000000-0000-4000-8000-000000000001",
      },
      clock: () => new Date("2026-08-21T10:00:00.000Z"),
      id: () => "prepared-cancelled",
      platform: "linux",
      posixNpxCommand: scriptedPosixNpxCommand,
      runner,
      workspace: "/workspace",
    });
    const observed = await skillsProcess.observeInventory({
      signal: new AbortController().signal,
    });
    if (!observed.ok) throw new Error("fixture observation failed");
    const prepared = await skillsProcess.prepareMutation({
      freshness: "fresh",
      intent: {
        names: ["project-skill"],
        scope: "project",
        type: "remove",
      },
      inventory: observed.value,
      inventoryId: "inventory-7",
    });
    if (!prepared.ok) throw new Error("fixture preparation failed");
    const controller = new AbortController();
    controller.abort();

    const executed = await skillsProcess.executeConfirmed({
      confirmation: {
        digest: prepared.value.digest,
        preparedMutationId: prepared.value.id,
      },
      signal: controller.signal,
    });

    expect(executed).toMatchObject({
      ok: true,
      value: {
        effects: { status: "not-observed" },
        inventory: { entries: expect.any(Array) },
        process: {
          disposition: "cancelled",
          exitCode: null,
          termination: "known",
        },
      },
    });
    expect(runner.invocations.some(({ args }) => args.includes("remove"))).toBe(
      false,
    );
  });

  it("runs postflight after known timeout but not after uncertain termination", async () => {
    for (const termination of ["known", "unknown"] as const) {
      let listInvocations = 0;
      const runner: ProcessRunner = {
        async run(invocation) {
          const packageIndex = invocation.args.indexOf(CLI_PACKAGE);
          const operation = invocation.args.slice(packageIndex + 1).join(" ");
          if (operation === "remove project-skill --agent codex --yes") {
            throw new ProcessBoundaryError(
              "bounded failure",
              "timed-out",
              true,
              termination,
            );
          }
          if (operation === "--version") {
            return { exitCode: 0, stderr: "", stdout: "1.5.23\n" };
          }
          listInvocations += 1;
          return {
            exitCode: 0,
            stderr: "",
            stdout:
              operation === "list --global --json"
                ? globalOutput
                : projectOutput,
          };
        },
      };
      const skillsProcess = createLocalSkillsProcess({
        binding: {
          generation: 3,
          harness: "Codex",
          targetId: "00000000-0000-4000-8000-000000000001",
        },
        clock: () => new Date("2026-08-21T10:00:00.000Z"),
        id: () => `prepared-${termination}`,
        platform: "linux",
        posixNpxCommand: scriptedPosixNpxCommand,
        runner,
        workspace: "/workspace",
      });
      const observed = await skillsProcess.observeInventory({
        signal: new AbortController().signal,
      });
      if (!observed.ok) throw new Error("fixture observation failed");
      const prepared = await skillsProcess.prepareMutation({
        freshness: "fresh",
        intent: {
          names: ["project-skill"],
          scope: "project",
          type: "remove",
        },
        inventory: observed.value,
        inventoryId: "inventory-7",
      });
      if (!prepared.ok) throw new Error("fixture preparation failed");

      const executed = await skillsProcess.executeConfirmed({
        confirmation: {
          digest: prepared.value.digest,
          preparedMutationId: prepared.value.id,
        },
        signal: new AbortController().signal,
      });

      expect(executed).toMatchObject({
        ok: true,
        value: {
          inventory:
            termination === "known" ? { entries: expect.any(Array) } : null,
          process: { disposition: "timed-out", termination },
        },
      });
      expect(listInvocations).toBe(termination === "known" ? 4 : 2);
    }
  });

  it("fails a concurrent operation instead of queueing or spawning it", async () => {
    let releaseMutation!: () => void;
    let markStarted!: () => void;
    const mutationStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const mutationReleased = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    let mutationInvocations = 0;
    const runner: ProcessRunner = {
      async run(invocation) {
        const packageIndex = invocation.args.indexOf(CLI_PACKAGE);
        const operation = invocation.args.slice(packageIndex + 1).join(" ");
        if (operation.startsWith("remove ")) {
          mutationInvocations += 1;
          markStarted();
          await mutationReleased;
          return { exitCode: 0, stderr: "", stdout: "removed" };
        }
        if (operation === "--version") {
          return { exitCode: 0, stderr: "", stdout: "1.5.23\n" };
        }
        return {
          exitCode: 0,
          stderr: "",
          stdout: operation === "list --global --json" ? globalOutput : "[]",
        };
      },
    };
    let nextId = 0;
    const skillsProcess = createLocalSkillsProcess({
      binding: {
        generation: 3,
        harness: "Codex",
        targetId: "00000000-0000-4000-8000-000000000001",
      },
      clock: () => new Date("2026-08-21T10:00:00.000Z"),
      id: () => `prepared-${++nextId}`,
      platform: "linux",
      posixNpxCommand: scriptedPosixNpxCommand,
      runner,
      workspace: "/workspace",
    });
    const inventory = {
      cliVersion: CLI_VERSION,
      entries: JSON.parse(projectOutput),
      observedAt: "2026-08-21T10:00:00.000Z",
      schemaVersion: 1 as const,
    };
    const first = await skillsProcess.prepareMutation({
      freshness: "fresh",
      intent: { names: ["project-skill"], scope: "project", type: "remove" },
      inventory,
      inventoryId: "inventory-7",
    });
    if (!first.ok) throw new Error("fixture preparation failed");
    const pending = skillsProcess.executeConfirmed({
      confirmation: {
        digest: first.value.digest,
        preparedMutationId: first.value.id,
      },
      signal: new AbortController().signal,
    });
    await mutationStarted;
    const second = await skillsProcess.prepareMutation({
      freshness: "fresh",
      intent: { names: ["project-skill"], scope: "project", type: "remove" },
      inventory,
      inventoryId: "inventory-7",
    });
    if (!second.ok) throw new Error("fixture preparation failed");

    expect(
      await skillsProcess.executeConfirmed({
        confirmation: {
          digest: second.value.digest,
          preparedMutationId: second.value.id,
        },
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ error: { code: "mutation_conflict" }, ok: false });
    expect(
      await skillsProcess.observeInventory({
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ error: { code: "mutation_conflict" }, ok: false });
    expect(mutationInvocations).toBe(1);

    releaseMutation();
    await pending;
  });

  it("invalidates a superseded private plan before either can spawn", async () => {
    const runner = scriptedRunner();
    let nextId = 0;
    const skillsProcess = createLocalSkillsProcess({
      binding: {
        generation: 3,
        harness: "Codex",
        targetId: "00000000-0000-4000-8000-000000000001",
      },
      clock: () => new Date("2026-08-21T10:00:00.000Z"),
      id: () => `prepared-${++nextId}`,
      platform: "linux",
      posixNpxCommand: scriptedPosixNpxCommand,
      runner,
      workspace: "/workspace",
    });
    const observed = await skillsProcess.observeInventory({
      signal: new AbortController().signal,
    });
    if (!observed.ok) throw new Error("fixture observation failed");
    const prepare = () =>
      skillsProcess.prepareMutation({
        freshness: "fresh",
        intent: {
          names: ["project-skill"],
          scope: "project",
          type: "remove",
        },
        inventory: observed.value,
        inventoryId: "inventory-7",
      });
    const first = await prepare();
    const second = await prepare();
    if (!first.ok || !second.ok) throw new Error("fixture preparation failed");

    expect(
      await skillsProcess.executeConfirmed({
        confirmation: {
          digest: first.value.digest,
          preparedMutationId: first.value.id,
        },
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ error: { code: "confirmation_invalid" }, ok: false });
    expect(runner.invocations.some(({ args }) => args.includes("remove"))).toBe(
      false,
    );
  });

  it.each([
    {
      expectedArgs: [
        "add",
        "https://github.com/example/skills/archive/0123456789abcdef0123456789abcdef01234567.tar.gz",
        "--skill",
        "new-skill",
        "--agent",
        "codex",
        "--global",
        "--yes",
      ],
      intent: {
        names: ["new-skill"],
        scope: "global" as const,
        source: {
          revision: "0123456789abcdef0123456789abcdef01234567",
          source: "example/skills",
          sourceType: "github" as const,
        },
        type: "add" as const,
      },
    },
    {
      expectedArgs: ["update", "project-skill", "--project", "--yes"],
      intent: {
        names: ["project-skill"],
        scope: "project" as const,
        type: "update" as const,
      },
    },
  ])(
    "derives the private $intent.type argv from the same normalized intent as its public plan",
    async ({ expectedArgs, intent }) => {
      const runner = scriptedRunner();
      const originalRun = runner.run.bind(runner);
      runner.run = async (invocation) => {
        const packageIndex = invocation.args.indexOf(CLI_PACKAGE);
        const operationArgs = invocation.args.slice(packageIndex + 1);
        if (operationArgs[0] === intent.type) {
          runner.invocations.push(invocation);
          return { exitCode: 0, stderr: "", stdout: "changed" };
        }
        return originalRun(invocation);
      };
      const skillsProcess = createLocalSkillsProcess({
        binding: {
          generation: 3,
          harness: "Codex",
          targetId: "00000000-0000-4000-8000-000000000001",
        },
        clock: () => new Date("2026-08-21T10:00:00.000Z"),
        id: () => `prepared-${intent.type}`,
        platform: "linux",
        posixNpxCommand: scriptedPosixNpxCommand,
        runner,
        workspace: "/workspace",
      });
      const observed = await skillsProcess.observeInventory({
        signal: new AbortController().signal,
      });
      if (!observed.ok) throw new Error("fixture observation failed");
      const prepared = await skillsProcess.prepareMutation({
        freshness: "fresh",
        intent,
        inventory: observed.value,
        inventoryId: "inventory-7",
      });
      if (!prepared.ok) throw new Error("fixture preparation failed");

      await skillsProcess.executeConfirmed({
        confirmation: {
          digest: prepared.value.digest,
          preparedMutationId: prepared.value.id,
        },
        signal: new AbortController().signal,
      });

      const mutationInvocation = runner.invocations.find(({ args }) =>
        args.includes(intent.type),
      );
      expect(mutationInvocation).toMatchObject({
        args: ["--yes", CLI_PACKAGE, ...expectedArgs],
        shell: false,
        timeoutMs: 600_000,
      });
      expect(prepared.value.commandPlan.preview).toBe(
        [`npx skills@${CLI_VERSION}`, ...expectedArgs].join(" "),
      );
    },
  );
});

describe("Local SkillsProcess source inspection contract", () => {
  const fixture = (name: string) =>
    readFileSync(
      fileURLToPath(
        new URL(
          `../../../../../packages/skills-runtime/fixtures/${name}`,
          import.meta.url,
        ),
      ),
      "utf8",
    );
  const binding = {
    generation: 3,
    harness: "Codex",
    targetId: "00000000-0000-4000-8000-000000000001",
  };

  function inspectionRunner(
    listing: (source: string) => { exitCode: number; stdout: string },
  ): ProcessRunner & { invocations: ProcessInvocation[] } {
    const invocations: ProcessInvocation[] = [];
    return {
      invocations,
      async run(invocation) {
        invocations.push(invocation);
        const packageIndex = invocation.args.indexOf(CLI_PACKAGE);
        const operation = invocation.args.slice(packageIndex + 1);
        if (operation.join(" ") === "--version") {
          return { exitCode: 0, stderr: "", stdout: "1.5.23\n" };
        }
        if (operation[0] === "add" && operation.at(-1) === "--list") {
          return { stderr: "", ...listing(operation[1]!) };
        }
        throw new Error("Unexpected scripted invocation");
      },
    };
  }

  it("lists a source read-only through an exact argument array and binds a stable digest", async () => {
    const runner = inspectionRunner(() => ({
      exitCode: 0,
      stdout: fixture("skills-1.5.23-add-list-single.v1.txt"),
    }));
    const skillsProcess = createLocalSkillsProcess({
      binding,
      clock: () => new Date("2026-08-21T10:00:00.000Z"),
      id: () => "inspection-1",
      platform: "linux",
      posixNpxCommand: scriptedPosixNpxCommand,
      runner,
      workspace: "/workspace",
    });
    const descriptor = describeSource("vercel-labs/skills");
    if (!descriptor.ok) throw new Error("fixture descriptor failed");

    const inspected = await skillsProcess.inspectSource({
      descriptor: descriptor.value,
      signal: new AbortController().signal,
    });

    expect(inspected).toMatchObject({
      ok: true,
      value: {
        candidates: [{ name: "find-skills" }],
        cliVersion: CLI_VERSION,
        descriptor: { family: "github", source: "vercel-labs/skills" },
        id: "inspection-1",
        inspectedAt: "2026-08-21T10:00:00.000Z",
        targetGeneration: 3,
        targetId: binding.targetId,
      },
    });
    if (!inspected.ok) throw new Error("fixture inspection failed");
    expect(inspected.value.digest).toMatch(/^[a-f0-9]{64}$/);
    const listInvocation = runner.invocations.find(({ args }) =>
      args.includes("--list"),
    );
    expect(listInvocation).toMatchObject({
      args: ["--yes", CLI_PACKAGE, "add", "vercel-labs/skills", "--list"],
      shell: false,
      timeoutMs: 60_000,
    });
    expect(
      runner.invocations.some(({ args }) =>
        args.some((arg) => arg === "--skill" || arg === "--agent"),
      ),
    ).toBe(false);

    const again = await skillsProcess.inspectSource({
      descriptor: descriptor.value,
      signal: new AbortController().signal,
    });
    expect(again.ok && again.value.digest).toBe(inspected.value.digest);
  });

  it("reports an unavailable source instead of parsing a failed clone transcript", async () => {
    const runner = inspectionRunner(() => ({
      exitCode: 1,
      stdout: fixture("skills-1.5.23-add-list-clone-failed.v1.txt"),
    }));
    const skillsProcess = createLocalSkillsProcess({
      binding,
      clock: () => new Date("2026-08-21T10:00:00.000Z"),
      platform: "linux",
      posixNpxCommand: scriptedPosixNpxCommand,
      runner,
      workspace: "/workspace",
    });
    const descriptor = describeSource("vercel-labs/does-not-exist");
    if (!descriptor.ok) throw new Error("fixture descriptor failed");

    expect(
      await skillsProcess.inspectSource({
        descriptor: descriptor.value,
        signal: new AbortController().signal,
      }),
    ).toMatchObject({
      error: { code: "source_unavailable", effects: "none", retryable: true },
      ok: false,
    });
  });

  it("rejects a malformed descriptor and an unbound process before spawning", async () => {
    const runner = inspectionRunner(() => {
      throw new Error("must not spawn");
    });
    const bound = createLocalSkillsProcess({
      binding,
      clock: () => new Date("2026-08-21T10:00:00.000Z"),
      platform: "linux",
      posixNpxCommand: scriptedPosixNpxCommand,
      runner,
      workspace: "/workspace",
    });
    const unbound = createLocalSkillsProcess({
      clock: () => new Date("2026-08-21T10:00:00.000Z"),
      platform: "linux",
      posixNpxCommand: scriptedPosixNpxCommand,
      runner,
      workspace: "/workspace",
    });
    const descriptor = describeSource("vercel-labs/skills");
    if (!descriptor.ok) throw new Error("fixture descriptor failed");

    expect(
      await bound.inspectSource({
        descriptor: {
          ...descriptor.value,
          source: "vercel-labs/skills --skill x",
        },
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ error: { code: "source_unsupported" }, ok: false });
    expect(
      await unbound.inspectSource({
        descriptor: descriptor.value,
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ error: { code: "mutation_ineligible" }, ok: false });
    expect(runner.invocations).toHaveLength(0);
  });

  it("fails a concurrent inspection instead of queueing it and returns cancellation without a listing", async () => {
    let releaseListing!: () => void;
    let markStarted!: () => void;
    const listingStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const listingReleased = new Promise<void>((resolve) => {
      releaseListing = resolve;
    });
    const runner = inspectionRunner(() => ({
      exitCode: 0,
      stdout: fixture("skills-1.5.23-add-list-single.v1.txt"),
    }));
    const gated: ProcessRunner = {
      async run(invocation) {
        if (invocation.args.at(-1) === "--list") {
          markStarted();
          await listingReleased;
        }
        return runner.run(invocation);
      },
    };
    const skillsProcess = createLocalSkillsProcess({
      binding,
      clock: () => new Date("2026-08-21T10:00:00.000Z"),
      platform: "linux",
      posixNpxCommand: scriptedPosixNpxCommand,
      runner: gated,
      workspace: "/workspace",
    });
    const descriptor = describeSource("vercel-labs/skills");
    if (!descriptor.ok) throw new Error("fixture descriptor failed");

    const controller = new AbortController();
    const pending = skillsProcess.inspectSource({
      descriptor: descriptor.value,
      signal: controller.signal,
    });
    await listingStarted;
    expect(
      await skillsProcess.inspectSource({
        descriptor: descriptor.value,
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ error: { code: "mutation_conflict" }, ok: false });
    expect(
      await skillsProcess.observeInventory({
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ error: { code: "mutation_conflict" }, ok: false });

    controller.abort();
    releaseListing();
    expect(await pending).toMatchObject({
      error: { code: "cancelled", effects: "none" },
      ok: false,
    });
    expect(
      runner.invocations.filter(({ args }) => args.at(-1) === "--list"),
    ).toHaveLength(1);
  });
});

describe("Local SkillsProcess npx resolution fallbacks", () => {
  it("finds node.exe and npx-cli.js under quoted Windows PATH entries", async () => {
    const expected = new Set([
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js',
    ]);
    const command = await resolveWindowsNpxCommand(
      { PATH: '"C:\\Program Files\\nodejs";C:\\tools;' },
      async (path) => expected.has(path),
    );
    expect(command).toEqual({
      executable: 'C:\\Program Files\\nodejs\\node.exe',
      npxCliPath:
        'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js',
    });
  });

  it("fails when Windows PATH has node.exe but no npx entry point", async () => {
    await expect(
      resolveWindowsNpxCommand({ PATH: "C:\\tools" }, async (path) =>
        path.endsWith("node.exe"),
      ),
    ).rejects.toMatchObject({
      message: "The Windows Node.js and npx entry points are unavailable.",
      name: "ProcessBoundaryError",
    });
  });

  it("prefers the newest managed nvm version under HOME", async () => {
    const home = await mkdtemp(join(tmpdir(), "skills-desktop-nvm-"));
    const versions = join(home, ".nvm", "versions", "node");
    for (const version of ["v20.9.0", "v22.1.0"]) {
      await mkdir(join(versions, version, "bin"), { recursive: true });
    }
    const executables = new Set([
      join(versions, "v20.9.0", "bin", "npx"),
      join(versions, "v20.9.0", "bin", "node"),
      join(versions, "v22.1.0", "bin", "npx"),
      join(versions, "v22.1.0", "bin", "node"),
    ]);
    const command = await resolvePosixNpxCommand(
      { HOME: home, PATH: "" },
      "linux",
      async (path) => executables.has(path),
    );
    const newestBin = join(versions, "v22.1.0", "bin");
    expect(command.executable).toBe(join(newestBin, "npx"));
    // The managed directory leads the PATH prefix the resolved env carries;
    // it cannot be split on ":" because Windows drive letters contain one.
    expect(command.path.startsWith(newestBin)).toBe(true);
  });

  it("resolves npx through a fallback directory that is not on PATH", async () => {
    const executables = new Set([
      join("/home/u", ".volta", "bin", "npx"),
      join("/home/u", ".volta", "bin", "node"),
      "/usr/bin/node",
    ]);
    const command = await resolvePosixNpxCommand(
      { HOME: "/home/u", PATH: "/usr/bin" },
      "linux",
      async (path) => executables.has(path),
    );
    expect(command.executable).toBe(join("/home/u", ".volta", "bin", "npx"));
    expect(command.path.split(":")[0]).toBe(join("/home/u", ".volta", "bin"));
  });

  it("fails when npx exists but no node executable can be found", async () => {
    await expect(
      resolvePosixNpxCommand(
        { HOME: "/home/u", PATH: "/usr/bin" },
        "linux",
        async (path) => path === "/usr/bin/npx",
      ),
    ).rejects.toMatchObject({
      message:
        "Node.js and npx are unavailable. Install Node.js, then refresh this Target.",
      name: "ProcessBoundaryError",
    });
  });
});

describe("Local SkillsProcess observation and confirmation edges", () => {
  const binding = {
    generation: 3,
    harness: "Codex",
    targetId: "00000000-0000-4000-8000-000000000001",
  };

  const processWith = (runner: ProcessRunner, clock = () => new Date("2026-08-21T10:00:00.000Z")) =>
    createLocalSkillsProcess({
      binding,
      clock,
      platform: "linux",
      posixNpxCommand: scriptedPosixNpxCommand,
      runner,
      workspace: "/workspace",
    });

  const versionRunner = (versionOutcome: {
    exitCode: number;
    stdout: string;
  }): ProcessRunner => ({
    async run(invocation) {
      const packageIndex = invocation.args.indexOf(CLI_PACKAGE);
      const operation = invocation.args.slice(packageIndex + 1).join(" ");
      if (operation === "--version") {
        return { stderr: "", ...versionOutcome };
      }
      return { exitCode: 0, stderr: "", stdout: "[]" };
    },
  });

  it("maps a failed version probe to a retryable process_failed", async () => {
    const skillsProcess = processWith(
      versionRunner({ exitCode: 1, stdout: "" }),
    );
    expect(
      await skillsProcess.observeInventory({
        signal: new AbortController().signal,
      }),
    ).toMatchObject({
      error: { code: "process_failed", retryable: true },
      ok: false,
    });
  });

  it("maps a dialect mismatch to a non-retryable cli_incompatible", async () => {
    const skillsProcess = processWith(
      versionRunner({ exitCode: 0, stdout: "9.9.9\n" }),
    );
    expect(
      await skillsProcess.observeInventory({
        signal: new AbortController().signal,
      }),
    ).toMatchObject({
      error: { code: "cli_incompatible", retryable: false },
      ok: false,
    });
  });

  it("cancels observation before spawning when the signal is already aborted", async () => {
    const runner: ProcessRunner = {
      async run() {
        throw new Error("must not spawn");
      },
    };
    const skillsProcess = processWith(runner);
    const controller = new AbortController();
    controller.abort();
    expect(
      await skillsProcess.observeInventory({ signal: controller.signal }),
    ).toMatchObject({ error: { code: "cancelled" }, ok: false });
  });

  it("maps a failed inventory list to process_failed and a post-list abort to cancelled", async () => {
    const failing = processWith({
      async run(invocation) {
        const packageIndex = invocation.args.indexOf(CLI_PACKAGE);
        const operation = invocation.args.slice(packageIndex + 1).join(" ");
        if (operation === "--version")
          return { exitCode: 0, stderr: "", stdout: "1.5.23\n" };
        if (operation === "list --json")
          return { exitCode: 1, stderr: "cannot list", stdout: "" };
        return { exitCode: 0, stderr: "", stdout: globalOutput };
      },
    });
    expect(
      await failing.observeInventory({
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ error: { code: "process_failed" }, ok: false });

    const controller = new AbortController();
    const aborting = processWith({
      async run(invocation) {
        const packageIndex = invocation.args.indexOf(CLI_PACKAGE);
        const operation = invocation.args.slice(packageIndex + 1).join(" ");
        if (operation === "--version")
          return { exitCode: 0, stderr: "", stdout: "1.5.23\n" };
        controller.abort();
        return {
          exitCode: 0,
          stderr: "",
          stdout: operation === "list --json" ? projectOutput : globalOutput,
        };
      },
    });
    expect(
      await aborting.observeInventory({ signal: controller.signal }),
    ).toMatchObject({ error: { code: "cancelled" }, ok: false });
  });

  it("maps a thrown runner error to process_failed when not cancelled", async () => {
    const skillsProcess = processWith({
      async run(invocation) {
        const packageIndex = invocation.args.indexOf(CLI_PACKAGE);
        const operation = invocation.args.slice(packageIndex + 1).join(" ");
        if (operation === "--version")
          return { exitCode: 0, stderr: "", stdout: "1.5.23\n" };
        throw new Error("spawn exploded");
      },
    });
    expect(
      await skillsProcess.observeInventory({
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ error: { code: "process_failed" }, ok: false });
  });

  it("propagates dialect failure into source inspection and classifies timeouts", async () => {
    const incompatible = processWith(
      versionRunner({ exitCode: 0, stdout: "9.9.9\n" }),
    );
    const descriptor = describeSource("vercel-labs/skills");
    if (!descriptor.ok) throw new Error("fixture descriptor failed");
    expect(
      await incompatible.inspectSource({
        descriptor: descriptor.value,
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ error: { code: "cli_incompatible" }, ok: false });

    const timedOut = processWith({
      async run(invocation) {
        const packageIndex = invocation.args.indexOf(CLI_PACKAGE);
        const operation = invocation.args.slice(packageIndex + 1).join(" ");
        if (operation === "--version")
          return { exitCode: 0, stderr: "", stdout: "1.5.23\n" };
        throw new ProcessBoundaryError(
          "Source inspection exceeded its time limit.",
          "timed-out",
          true,
          "known",
        );
      },
    });
    expect(
      await timedOut.inspectSource({
        descriptor: descriptor.value,
        signal: new AbortController().signal,
      }),
    ).toMatchObject({
      error: {
        code: "process_failed",
        message: "Source inspection exceeded its time limit.",
      },
      ok: false,
    });
  });

  it("rejects a mismatched digest and consumes the plan", async () => {
    const skillsProcess = processWith(scriptedRunner());
    const observed = await skillsProcess.observeInventory({
      signal: new AbortController().signal,
    });
    if (!observed.ok) throw new Error("fixture observation failed");
    const prepared = await skillsProcess.prepareMutation({
      freshness: "fresh",
      intent: { names: ["project-skill"], scope: "project", type: "remove" },
      inventory: observed.value,
      inventoryId: "inventory-7",
    });
    if (!prepared.ok) throw new Error("fixture preparation failed");

    expect(
      await skillsProcess.executeConfirmed({
        confirmation: {
          digest: "0".repeat(64),
          preparedMutationId: prepared.value.id,
        },
        signal: new AbortController().signal,
      }),
    ).toMatchObject({
      error: { code: "confirmation_invalid", message: expect.stringContaining("does not match") },
      ok: false,
    });
    expect(
      await skillsProcess.executeConfirmed({
        confirmation: {
          digest: prepared.value.digest,
          preparedMutationId: prepared.value.id,
        },
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ error: { code: "confirmation_invalid" }, ok: false });
  });

  it("rejects an expired prepared mutation", async () => {
    let now = new Date("2026-08-21T10:00:00.000Z");
    const skillsProcess = processWith(scriptedRunner(), () => now);
    const observed = await skillsProcess.observeInventory({
      signal: new AbortController().signal,
    });
    if (!observed.ok) throw new Error("fixture observation failed");
    const prepared = await skillsProcess.prepareMutation({
      freshness: "fresh",
      intent: { names: ["project-skill"], scope: "project", type: "remove" },
      inventory: observed.value,
      inventoryId: "inventory-7",
    });
    if (!prepared.ok) throw new Error("fixture preparation failed");

    now = new Date(Date.parse(prepared.value.expiresAt) + 1);
    expect(
      await skillsProcess.executeConfirmed({
        confirmation: {
          digest: prepared.value.digest,
          preparedMutationId: prepared.value.id,
        },
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ error: { code: "confirmation_expired" }, ok: false });
  });

  it("conflicts with an in-flight observation and consumes the plan", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let listCalls = 0;
    const runner: ProcessRunner = {
      async run(invocation) {
        const packageIndex = invocation.args.indexOf(CLI_PACKAGE);
        const operation = invocation.args.slice(packageIndex + 1).join(" ");
        if (operation === "--version")
          return { exitCode: 0, stderr: "", stdout: "1.5.23\n" };
        if (operation === "list --json") {
          if (++listCalls === 2) await gate;
          return { exitCode: 0, stderr: "", stdout: projectOutput };
        }
        return { exitCode: 0, stderr: "", stdout: globalOutput };
      },
    };
    const skillsProcess = processWith(runner);
    const observed = await skillsProcess.observeInventory({
      signal: new AbortController().signal,
    });
    if (!observed.ok) throw new Error("fixture observation failed");
    const prepared = await skillsProcess.prepareMutation({
      freshness: "fresh",
      intent: { names: ["project-skill"], scope: "project", type: "remove" },
      inventory: observed.value,
      inventoryId: "inventory-7",
    });
    if (!prepared.ok) throw new Error("fixture preparation failed");

    const inFlight = skillsProcess.observeInventory({
      signal: new AbortController().signal,
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(
      await skillsProcess.executeConfirmed({
        confirmation: {
          digest: prepared.value.digest,
          preparedMutationId: prepared.value.id,
        },
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ error: { code: "mutation_conflict" }, ok: false });
    release?.();
    await inFlight;
  });

  it("reports not-observed versus possible effects when termination is unknown", async () => {
    for (const [started, status] of [
      [false, "not-observed"],
      [true, "possible"],
    ] as const) {
      const runner: ProcessRunner = {
        async run(invocation) {
          const packageIndex = invocation.args.indexOf(CLI_PACKAGE);
          const operation = invocation.args.slice(packageIndex + 1).join(" ");
          if (operation === "--version")
            return { exitCode: 0, stderr: "", stdout: "1.5.23\n" };
          if (operation === "list --json")
            return { exitCode: 0, stderr: "", stdout: projectOutput };
          if (operation === "list --global --json")
            return { exitCode: 0, stderr: "", stdout: globalOutput };
          if (operation.startsWith("remove "))
            throw new ProcessBoundaryError(
              "kill uncertainty",
              "failed",
              started,
              "unknown",
            );
          return { exitCode: 0, stderr: "", stdout: "[]" };
        },
      };
      const skillsProcess = processWith(runner);
      const observed = await skillsProcess.observeInventory({
        signal: new AbortController().signal,
      });
      if (!observed.ok) throw new Error("fixture observation failed");
      const prepared = await skillsProcess.prepareMutation({
        freshness: "fresh",
        intent: {
          names: ["project-skill"],
          scope: "project",
          type: "remove",
        },
        inventory: observed.value,
        inventoryId: "inventory-7",
      });
      if (!prepared.ok) throw new Error("fixture preparation failed");
      expect(
        await skillsProcess.executeConfirmed({
          confirmation: {
            digest: prepared.value.digest,
            preparedMutationId: prepared.value.id,
          },
          signal: new AbortController().signal,
        }),
      ).toMatchObject({
        ok: true,
        value: {
          effects: { status },
          inventory: null,
          process: { disposition: "failed", termination: "unknown" },
        },
      });
    }
  });

  it("reports possible effects when the mutation ran but postflight failed", async () => {
    let mutated = false;
    const runner: ProcessRunner = {
      async run(invocation) {
        const packageIndex = invocation.args.indexOf(CLI_PACKAGE);
        const operation = invocation.args.slice(packageIndex + 1).join(" ");
        if (operation === "--version")
          return { exitCode: 0, stderr: "", stdout: "1.5.23\n" };
        if (operation.startsWith("remove ")) {
          mutated = true;
          return { exitCode: 0, stderr: "", stdout: "removed" };
        }
        if (operation === "list --json" && mutated)
          return { exitCode: 1, stderr: "postflight failed", stdout: "" };
        if (operation === "list --json")
          return { exitCode: 0, stderr: "", stdout: projectOutput };
        return { exitCode: 0, stderr: "", stdout: globalOutput };
      },
    };
    const skillsProcess = processWith(runner);
    const observed = await skillsProcess.observeInventory({
      signal: new AbortController().signal,
    });
    if (!observed.ok) throw new Error("fixture observation failed");
    const prepared = await skillsProcess.prepareMutation({
      freshness: "fresh",
      intent: { names: ["project-skill"], scope: "project", type: "remove" },
      inventory: observed.value,
      inventoryId: "inventory-7",
    });
    if (!prepared.ok) throw new Error("fixture preparation failed");
    expect(
      await skillsProcess.executeConfirmed({
        confirmation: {
          digest: prepared.value.digest,
          preparedMutationId: prepared.value.id,
        },
        signal: new AbortController().signal,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        effects: { status: "possible" },
        inventory: null,
        process: { disposition: "completed" },
      },
    });
  });
});

describe("Local SkillsProcess mutation failure edges", () => {
  const clock = () => new Date("2026-08-22T06:00:00.000Z");
  const entry = {
    agents: ["codex"],
    contentFingerprint: { status: "unknown" },
    declaredSource: { source: "acme/skills", sourceType: "github" },
    extensions: {},
    name: "shared-skill",
    path: "/workspace/.agents/skills/shared-skill",
    revision: { status: "unknown" },
    scope: "project",
    sourceUrl: null,
  } as const;
  const inventory: Inventory = {
    cliVersion: CLI_VERSION,
    entries: [entry],
    observedAt: "2026-08-22T06:00:00.000Z",
    schemaVersion: 1,
  };
  const binding = {
    generation: 1,
    harnessIds: ["codex"],
    targetId: "00000000-0000-4000-8000-000000000001",
  };
  const addIntent: MutationIntent = {
    names: ["shared-skill"],
    scope: "project",
    source: { source: "acme/skills", sourceType: "github" },
    type: "add",
  };

  it("rejects preparation without a bound Target", () => {
    expect(
      prepareMutationPlan({
        clock,
        input: {
          freshness: "fresh",
          intent: addIntent,
          inventory,
          inventoryId: "inv-1",
        },
      }),
    ).toMatchObject({ error: { code: "mutation_ineligible" }, ok: false });
  });

  it("rejects an empty Inventory id as stale", () => {
    expect(
      prepareMutationPlan({
        binding,
        clock,
        input: {
          freshness: "fresh",
          intent: addIntent,
          inventory,
          inventoryId: "",
        },
      }),
    ).toMatchObject({ error: { code: "stale_inventory" }, ok: false });
  });

  it("rejects a schema-invalid intent", () => {
    expect(
      prepareMutationPlan({
        binding,
        clock,
        input: {
          freshness: "fresh",
          intent: {
            names: [],
            scope: "project",
            source: { source: "acme/skills", sourceType: "github" },
            type: "add",
          },
          inventory,
          inventoryId: "inv-1",
        },
      }),
    ).toMatchObject({ error: { code: "invalid_intent" }, ok: false });
  });

  it("rejects a Target with an empty harness set", () => {
    expect(
      prepareMutationPlan({
        binding: { ...binding, harnessIds: [] },
        clock,
        input: {
          freshness: "fresh",
          intent: addIntent,
          inventory,
          inventoryId: "inv-1",
        },
      }),
    ).toMatchObject({ error: { code: "mutation_ineligible" }, ok: false });
  });

  it("rejects update-all when nothing matches the scope", () => {
    expect(
      prepareMutationPlan({
        binding,
        clock,
        input: {
          freshness: "fresh",
          intent: { scope: "global", type: "update-all" },
          inventory: { ...inventory, entries: [] },
          inventoryId: "inv-1",
        },
      }),
    ).toMatchObject({ error: { code: "mutation_ineligible" }, ok: false });
  });

  it("rejects removal of Skills absent from the Fresh Inventory", () => {
    expect(
      prepareMutationPlan({
        binding,
        clock,
        input: {
          freshness: "fresh",
          intent: {
            names: ["ghost-skill"],
            scope: "project",
            type: "remove",
          },
          inventory,
          inventoryId: "inv-1",
        },
      }),
    ).toMatchObject({ error: { code: "mutation_ineligible" }, ok: false });
  });

  it("reports an add as not-observed when the declared source mismatches", () => {
    expect(
      observedMutationEffects(
        {
          names: ["shared-skill"],
          scope: "project",
          source: { source: "other/repo", sourceType: "github" },
          type: "add",
        },
        inventory,
        ["codex"],
      ),
    ).toMatchObject({ status: "not-observed" });
  });

  it("reports an add as verified when the declared source matches", () => {
    expect(
      observedMutationEffects(addIntent, inventory, ["codex"]),
    ).toMatchObject({ status: "verified" });
  });

  it("reports updates on matching entries as content-unverified", () => {
    expect(
      observedMutationEffects(
        { names: ["shared-skill"], scope: "project", type: "update" },
        inventory,
        ["codex"],
      ),
    ).toMatchObject({ status: "content-unverified" });
  });
});

describe("Local SkillsProcess boundary failure arms", () => {
  const boundaryFixture = (name: string) =>
    readFileSync(
      fileURLToPath(
        new URL(
          `../../../../../packages/skills-runtime/fixtures/${name}`,
          import.meta.url,
        ),
      ),
      "utf8",
    );

  const boundaryBinding = {
    generation: 3,
    harness: "Codex",
    targetId: "00000000-0000-4000-8000-000000000001",
  };

  const boundaryProcess = (
    runner: ProcessRunner,
    overrides: Partial<Parameters<typeof createLocalSkillsProcess>[0]> = {},
  ) =>
    createLocalSkillsProcess({
      binding: boundaryBinding,
      clock: () => new Date("2026-08-21T10:00:00.000Z"),
      id: () => "boundary-1",
      platform: "linux",
      posixNpxCommand: scriptedPosixNpxCommand,
      runner,
      workspace: "/workspace",
      ...overrides,
    });

  type Outcome = { exitCode: number; stderr: string; stdout: string };
  const operationsRunner = (
    resolve: (operation: string) => Outcome,
  ): ProcessRunner & { invocations: ProcessInvocation[] } => {
    const invocations: ProcessInvocation[] = [];
    return {
      invocations,
      async run(invocation) {
        invocations.push(invocation);
        const packageIndex = invocation.args.indexOf(CLI_PACKAGE);
        return resolve(invocation.args.slice(packageIndex + 1).join(" "));
      },
    };
  };

  const versionedRunner = (
    version: Outcome | (() => Outcome),
    rest: Record<string, Outcome | (() => Outcome)> = {},
  ) =>
    operationsRunner((operation) => {
      if (operation === "--version") {
        return typeof version === "function" ? version() : version;
      }
      const entry = rest[operation];
      if (entry === undefined) {
        throw new Error(`Unexpected scripted invocation: ${operation}`);
      }
      return typeof entry === "function" ? entry() : entry;
    });

  const goodVersion = { exitCode: 0, stderr: "", stdout: "1.5.23\n" };
  const mutationRunner = (mutation: (operation: string) => Outcome) =>
    versionedRunner(goodVersion, {
      "list --json": { exitCode: 0, stderr: "", stdout: projectOutput },
      "list --global --json": { exitCode: 0, stderr: "", stdout: globalOutput },
      "remove project-skill --agent codex --yes": () =>
        mutation("remove project-skill --agent codex --yes"),
    });

  const removeIntent: MutationIntent = {
    names: ["project-skill"],
    scope: "project",
    type: "remove",
  };

  async function prepareRemoval(skillsProcess: ReturnType<typeof boundaryProcess>) {
    const observed = await skillsProcess.observeInventory({
      signal: new AbortController().signal,
    });
    if (!observed.ok) throw new Error("fixture observation failed");
    const prepared = await skillsProcess.prepareMutation({
      freshness: "fresh",
      intent: removeIntent,
      inventory: observed.value,
      inventoryId: "inventory-7",
    });
    if (!prepared.ok) throw new Error("fixture preparation failed");
    return prepared.value;
  }

  it("rejects Windows npx resolution when PATH is absent", async () => {
    await expect(
      resolveWindowsNpxCommand({}, async () => true),
    ).rejects.toThrow(
      "The Windows Node.js and npx entry points are unavailable.",
    );
  });

  it("resolves Windows endpoints from quoted and blank PATH entries across directories", async () => {
    const existing = new Set([
      "C:\\first\\node.exe",
      "C:\\second\\node_modules\\npm\\bin\\npx-cli.js",
    ]);

    await expect(
      resolveWindowsNpxCommand(
        { PATH: '  "C:\\first"  ;;C:\\second' },
        async (path) => existing.has(path),
      ),
    ).resolves.toEqual({
      executable: "C:\\first\\node.exe",
      npxCliPath: "C:\\second\\node_modules\\npm\\bin\\npx-cli.js",
    });
  });

  it("rejects Posix npx resolution when neither PATH nor HOME provides the tools", async () => {
    await expect(
      resolvePosixNpxCommand({}, "linux", async () => false),
    ).rejects.toThrow(
      "Node.js and npx are unavailable. Install Node.js, then refresh this Target.",
    );
  });

  it("resolves Posix npx from the newest managed version directory when other roots fail", async () => {
    const home = await mkdtemp(join(tmpdir(), "lsd-posix-home-"));
    try {
      const versionsRoot = join(home, ".nvm", "versions", "node");
      const newest = join(versionsRoot, "v20.0.0", "bin");
      await mkdir(newest, { recursive: true });
      await mkdir(join(versionsRoot, "v19.0.0", "bin"), { recursive: true });
      await writeFile(join(versionsRoot, "not-a-version"), "marker", "utf8");
      const newestBin = (name: string) => join(newest, name);

      const resolved = await resolvePosixNpxCommand(
        { HOME: home, PATH: "" },
        "linux",
        async (path) => path === newestBin("npx") || path === newestBin("node"),
      );

      expect(resolved.executable).toBe(newestBin("npx"));
      expect(resolved.path.split(":")[0]).toBe(newest);
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("resolves Posix npx as the bare command when a PATH directory provides both tools", async () => {
    const resolved = await resolvePosixNpxCommand(
      { PATH: `/injected${delimiter}/other` },
      "linux",
      async (path) => path === "/injected/npx" || path === "/injected/node",
    );

    expect(resolved.executable).toBe("npx");
    expect(resolved.path.split(":")).toEqual(["/injected", "/other"]);
  });

  it("rejects a run whose output capture directory cannot be prepared", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lsd-capture-"));
    try {
      const blocker = join(directory, "not-a-directory");
      await writeFile(blocker, "marker", "utf8");
      const runner = createSpawnProcessRunner({
        platform: "linux",
        temporaryDirectory: join(blocker, "nested"),
      });

      await expect(
        runner.run({
          args: ["-e", "process.stdout.write('hi')"],
          cwd: directory,
          env: { PATH: process.env.PATH ?? "" },
          executable: process.execPath,
          maxOutputBytes: 1_024,
          shell: false,
          signal: new AbortController().signal,
          timeoutMs: 5_000,
          windowsHide: true,
        }),
      ).rejects.toThrow("Process output capture could not be prepared.");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("reports process_failed when the CLI version check exits nonzero", async () => {
    const skillsProcess = boundaryProcess(
      versionedRunner({ exitCode: 1, stderr: "nope", stdout: "" }),
    );

    await expect(
      skillsProcess.observeInventory({ signal: new AbortController().signal }),
    ).resolves.toMatchObject({
      error: { code: "process_failed" },
      ok: false,
    });
  });

  it("reports cli_incompatible when the installed CLI dialect mismatches", async () => {
    const skillsProcess = boundaryProcess(
      versionedRunner({ exitCode: 0, stderr: "", stdout: "9.9.9\n" }),
    );

    await expect(
      skillsProcess.observeInventory({ signal: new AbortController().signal }),
    ).resolves.toMatchObject({
      error: { code: "cli_incompatible", retryable: false },
      ok: false,
    });
  });

  it("reports process_failed when the CLI version invocation throws", async () => {
    const skillsProcess = boundaryProcess(
      versionedRunner(() => {
        throw new Error("spawn failed");
      }),
    );

    await expect(
      skillsProcess.observeInventory({ signal: new AbortController().signal }),
    ).resolves.toMatchObject({
      error: { code: "process_failed" },
      ok: false,
    });
  });

  it("reports process_failed when an inventory listing exits nonzero", async () => {
    const skillsProcess = boundaryProcess(
      versionedRunner(goodVersion, {
        "list --json": { exitCode: 2, stderr: "boom", stdout: "" },
        "list --global --json": { exitCode: 0, stderr: "", stdout: globalOutput },
      }),
    );

    await expect(
      skillsProcess.observeInventory({ signal: new AbortController().signal }),
    ).resolves.toMatchObject({
      error: {
        code: "process_failed",
        message: "Inventory observation failed.",
      },
      ok: false,
    });
  });

  it("propagates a malformed project listing", async () => {
    const skillsProcess = boundaryProcess(
      versionedRunner(goodVersion, {
        "list --json": { exitCode: 0, stderr: "", stdout: "not json" },
        "list --global --json": { exitCode: 0, stderr: "", stdout: globalOutput },
      }),
    );

    await expect(
      skillsProcess.observeInventory({ signal: new AbortController().signal }),
    ).resolves.toMatchObject({
      error: { code: "invalid_inventory" },
      ok: false,
    });
  });

  it("propagates a malformed global listing", async () => {
    const skillsProcess = boundaryProcess(
      versionedRunner(goodVersion, {
        "list --json": { exitCode: 0, stderr: "", stdout: projectOutput },
        "list --global --json": { exitCode: 0, stderr: "", stdout: "not json" },
      }),
    );

    await expect(
      skillsProcess.observeInventory({ signal: new AbortController().signal }),
    ).resolves.toMatchObject({
      error: { code: "invalid_inventory" },
      ok: false,
    });
  });

  it("cancels source inspection on a pre-aborted signal", async () => {
    const runner = versionedRunner(goodVersion);
    const skillsProcess = boundaryProcess(runner);
    const controller = new AbortController();
    controller.abort();
    const descriptor = describeSource("vercel-labs/skills");
    if (!descriptor.ok) throw new Error("fixture descriptor failed");

    await expect(
      skillsProcess.inspectSource({
        descriptor: descriptor.value,
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({
      error: { code: "cancelled" },
      ok: false,
    });
    expect(runner.invocations).toHaveLength(0);
  });

  it("maps a dialect mismatch into source inspection without retry", async () => {
    const skillsProcess = boundaryProcess(
      versionedRunner({ exitCode: 0, stderr: "", stdout: "9.9.9\n" }),
    );
    const descriptor = describeSource("vercel-labs/skills");
    if (!descriptor.ok) throw new Error("fixture descriptor failed");

    await expect(
      skillsProcess.inspectSource({
        descriptor: descriptor.value,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      error: { code: "cli_incompatible", retryable: false },
      ok: false,
    });
  });

  it("maps a timed-out source listing boundary into a bounded message", async () => {
    const skillsProcess = boundaryProcess(
      versionedRunner(goodVersion, {
        "add vercel-labs/skills --list": () => {
          throw new ProcessBoundaryError("timed out", "timed-out", true, "known");
        },
      }),
    );
    const descriptor = describeSource("vercel-labs/skills");
    if (!descriptor.ok) throw new Error("fixture descriptor failed");

    await expect(
      skillsProcess.inspectSource({
        descriptor: descriptor.value,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      error: {
        code: "process_failed",
        message: "Source inspection exceeded its time limit.",
      },
      ok: false,
    });
  });

  it("maps a plain source listing throw into a generic process failure", async () => {
    const skillsProcess = boundaryProcess(
      versionedRunner(goodVersion, {
        "add vercel-labs/skills --list": () => {
          throw new Error("boom");
        },
      }),
    );
    const descriptor = describeSource("vercel-labs/skills");
    if (!descriptor.ok) throw new Error("fixture descriptor failed");

    await expect(
      skillsProcess.inspectSource({
        descriptor: descriptor.value,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      error: {
        code: "process_failed",
        message: "Source inspection failed.",
      },
      ok: false,
    });
  });

  it("reports source_unavailable when the source listing exits nonzero", async () => {
    const skillsProcess = boundaryProcess(
      versionedRunner(goodVersion, {
        "add vercel-labs/skills --list": {
          exitCode: 1,
          stderr: "not found",
          stdout: "",
        },
      }),
    );
    const descriptor = describeSource("vercel-labs/skills");
    if (!descriptor.ok) throw new Error("fixture descriptor failed");

    await expect(
      skillsProcess.inspectSource({
        descriptor: descriptor.value,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      error: { code: "source_unavailable" },
      ok: false,
    });
  });

  it("propagates a malformed source listing", async () => {
    const skillsProcess = boundaryProcess(
      versionedRunner(goodVersion, {
        "add vercel-labs/skills --list": {
          exitCode: 0,
          stderr: "",
          stdout: "no header here",
        },
      }),
    );
    const descriptor = describeSource("vercel-labs/skills");
    if (!descriptor.ok) throw new Error("fixture descriptor failed");

    await expect(
      skillsProcess.inspectSource({
        descriptor: descriptor.value,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      error: { code: "source_inspection_incompatible" },
      ok: false,
    });
  });

  it("derives the inspection id from the content digest when no id source is provided", async () => {
    // No `id` option: the inspection id derives from the content digest.
    const skillsProcess = createLocalSkillsProcess({
      binding: boundaryBinding,
      clock: () => new Date("2026-08-21T10:00:00.000Z"),
      platform: "linux",
      posixNpxCommand: scriptedPosixNpxCommand,
      runner: versionedRunner(goodVersion, {
        "add vercel-labs/skills --list": {
          exitCode: 0,
          stderr: "",
          stdout: boundaryFixture("skills-1.5.23-add-list-single.v1.txt"),
        },
      }),
      workspace: "/workspace",
    });
    const descriptor = describeSource("vercel-labs/skills");
    if (!descriptor.ok) throw new Error("fixture descriptor failed");

    const inspected = await skillsProcess.inspectSource({
      descriptor: descriptor.value,
      signal: new AbortController().signal,
    });

    expect(inspected).toMatchObject({ ok: true });
    if (!inspected.ok) throw new Error("fixture inspection failed");
    expect(inspected.value.id).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects an unknown prepared mutation confirmation", async () => {
    const skillsProcess = boundaryProcess(scriptedRunner());

    await expect(
      skillsProcess.executeConfirmed({
        confirmation: {
          digest: "0".repeat(64),
          preparedMutationId: "missing",
        },
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      error: { code: "confirmation_invalid" },
      ok: false,
    });
  });

  it("rejects a digest-mismatched confirmation", async () => {
    const skillsProcess = boundaryProcess(mutationRunner(() => ({
      exitCode: 0,
      stderr: "",
      stdout: "removed",
    })));
    const prepared = await prepareRemoval(skillsProcess);

    await expect(
      skillsProcess.executeConfirmed({
        confirmation: {
          digest: "0".repeat(64),
          preparedMutationId: prepared.id,
        },
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      error: { code: "confirmation_invalid" },
      ok: false,
    });
  });

  it("rejects an expired prepared mutation", async () => {
    let now = new Date("2026-08-21T10:00:00.000Z");
    const skillsProcess = boundaryProcess(
      mutationRunner(() => ({ exitCode: 0, stderr: "", stdout: "removed" })),
      { clock: () => now },
    );
    const prepared = await prepareRemoval(skillsProcess);
    now = new Date("2026-08-21T10:11:00.000Z");

    await expect(
      skillsProcess.executeConfirmed({
        confirmation: {
          digest: prepared.digest,
          preparedMutationId: prepared.id,
        },
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      error: { code: "confirmation_expired" },
      ok: false,
    });
  });

  it("evicts an earlier prepared plan when a new preparation arrives", async () => {
    let sequence = 0;
    const skillsProcess = boundaryProcess(
      mutationRunner(() => ({ exitCode: 0, stderr: "", stdout: "removed" })),
      { id: () => `prepared-${(sequence += 1)}` },
    );
    const first = await prepareRemoval(skillsProcess);
    await prepareRemoval(skillsProcess);

    await expect(
      skillsProcess.executeConfirmed({
        confirmation: {
          digest: first.digest,
          preparedMutationId: first.id,
        },
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      error: { code: "confirmation_invalid" },
      ok: false,
    });
  });

  it("maps a timed-out mutation boundary into the process outcome and still postflights", async () => {
    const skillsProcess = boundaryProcess(
      mutationRunner(() => {
        throw new ProcessBoundaryError("timed out", "timed-out", true, "known");
      }),
    );
    const prepared = await prepareRemoval(skillsProcess);

    const executed = await skillsProcess.executeConfirmed({
      confirmation: {
        digest: prepared.digest,
        preparedMutationId: prepared.id,
      },
      signal: new AbortController().signal,
    });

    expect(executed).toMatchObject({
      ok: true,
      value: {
        inventory: { entries: expect.any(Array) },
        process: {
          disposition: "timed-out",
          exitCode: null,
          termination: "known",
        },
      },
    });
  });

  it("returns early without postflight when the boundary reports unknown termination", async () => {
    const skillsProcess = boundaryProcess(
      mutationRunner(() => {
        throw new ProcessBoundaryError("lost", "failed", false, "unknown");
      }),
    );
    const prepared = await prepareRemoval(skillsProcess);

    const executed = await skillsProcess.executeConfirmed({
      confirmation: {
        digest: prepared.digest,
        preparedMutationId: prepared.id,
      },
      signal: new AbortController().signal,
    });

    expect(executed).toMatchObject({
      ok: true,
      value: {
        effects: { status: "not-observed" },
        inventory: null,
        process: {
          disposition: "failed",
          exitCode: null,
          termination: "unknown",
        },
      },
    });
  });

  it("cancels a confirmed mutation on a pre-aborted signal", async () => {
    const skillsProcess = boundaryProcess(
      mutationRunner(() => ({ exitCode: 0, stderr: "", stdout: "removed" })),
    );
    const prepared = await prepareRemoval(skillsProcess);
    const controller = new AbortController();
    controller.abort();

    const executed = await skillsProcess.executeConfirmed({
      confirmation: {
        digest: prepared.digest,
        preparedMutationId: prepared.id,
      },
      signal: controller.signal,
    });

    expect(executed).toMatchObject({
      ok: true,
      value: { process: { disposition: "cancelled", exitCode: null } },
    });
  });
});
