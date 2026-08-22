import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  watch,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  CLI_PACKAGE,
  CLI_VERSION,
  type Inventory,
} from "@skills-desktop/skills-runtime";

import {
  createLocalSkillsProcess,
  createSpawnProcessRunner,
  ProcessBoundaryError,
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

describe("Local SkillsProcess inventory contract", () => {
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
      const executable = join(directory, "npx");
      await writeFile(
        executable,
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
        { mode: 0o700 },
      );
      await chmod(executable, 0o700);

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
      const executable = join(directory, "npx");
      await writeFile(
        executable,
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
        { mode: 0o700 },
      );
      await chmod(executable, 0o700);
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
        await rm(directory, { force: true, recursive: true });
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
        await rm(directory, { force: true, recursive: true });
      }
    },
  );
});

describe("Local SkillsProcess mutation contract", () => {
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
