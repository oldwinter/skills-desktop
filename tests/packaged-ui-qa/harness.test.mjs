import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CdpDisconnectedError,
  CdpPage,
  CdpRequestTimeoutError,
  cdpTargetMatches,
} from "./cdp.mjs";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, relative, sep } from "node:path";
import { runInNewContext } from "node:vm";

import {
  failureReceipt,
  persistFailureArtifacts,
  safeFailureSummary,
} from "./artifacts.mjs";
import {
  assertRuntimeArchitecture,
  createPackagedQaFixture,
  resolvePackagedExecutable,
} from "./fixture.mjs";
import {
  findAvailablePort,
  launchPackagedElectron,
  packagedLaunchEnvironment,
  stopChild,
  terminateWindowsProcessTree,
} from "./launch.mjs";
import {
  PACKAGED_UI_QA_SCENARIOS,
  createPackagedUiQaScenarioError,
  mutationOutcomeFocusDiagnostic,
  requireAxeSource,
  packagedUiQaHelp,
  reviewActionFocusDiagnostic,
  runPackagedUiQa,
} from "./scenarios.mjs";

class FakeSocket {
  static OPEN = 1;
  static CLOSED = 3;

  constructor() {
    this.readyState = FakeSocket.OPEN;
    this.listeners = new Map();
    this.sent = [];
  }

  addEventListener(type, listener, options = {}) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    if (options.once) listener.once = true;
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(payload) {
    if (this.readyState !== FakeSocket.OPEN) {
      throw new Error("socket is not open");
    }
    this.sent.push(JSON.parse(payload));
  }

  close() {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.emit("close", {});
  }

  emit(type, event) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
      if (listener.once) this.removeEventListener(type, listener);
    }
  }

  respond(id, result) {
    this.emit("message", { data: JSON.stringify({ id, result }) });
  }
}

const fixtures = [];

function expectDescendant(root, candidate) {
  const descendant = relative(root, candidate);
  expect(descendant).not.toBe("");
  expect(descendant).not.toBe("..");
  expect(descendant.startsWith(`..${sep}`)).toBe(false);
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

describe("packaged UI QA CDP seam", () => {
  it("ignores only Electron's internal sandbox startup diagnostic", () => {
    const socket = new FakeSocket();
    const page = new CdpPage(socket);
    const sandboxStartupDiagnostic = [
      "Electron sandboxed_renderer.bundle.js script failed to run",
      "TypeError: Cannot destructure property 'preloadScripts' of 'binding.startupData' as it is null.",
      "    at node:electron/js2c/sandbox_bundle:2:132134",
      "    at ___electron_webpack_init__ (node:electron/js2c/sandbox_bundle:2:133242)",
    ].join("\n");

    socket.emit("message", {
      data: JSON.stringify({
        method: "Runtime.consoleAPICalled",
        params: {
          args: [{ value: sandboxStartupDiagnostic }],
          type: "error",
        },
      }),
    });
    expect(page.errors).toEqual([]);

    socket.emit("message", {
      data: JSON.stringify({
        method: "Runtime.exceptionThrown",
        params: {
          exceptionDetails: {
            text: "Electron sandboxed_renderer.bundle.js script failed to run",
          },
        },
      }),
    });
    expect(page.errors).toEqual([]);

    socket.emit("message", {
      data: JSON.stringify({
        method: "Runtime.exceptionThrown",
        params: {
          exceptionDetails: {
            text: sandboxStartupDiagnostic.split("\n").slice(1).join("\n"),
          },
        },
      }),
    });
    expect(page.errors).toEqual([]);

    socket.emit("message", {
      data: JSON.stringify({
        method: "Runtime.consoleAPICalled",
        params: {
          args: [
            {
              value:
                "Electron sandboxed_renderer.bundle.js script failed to run\nError: application failure",
            },
          ],
          type: "error",
        },
      }),
    });
    expect(page.errors).toEqual([
      "Electron sandboxed_renderer.bundle.js script failed to run\nError: application failure",
    ]);

    socket.emit("message", {
      data: JSON.stringify({
        method: "Runtime.consoleAPICalled",
        params: {
          args: [
            {
              value: [
                "Electron sandboxed_renderer.bundle.js script failed to run",
                "TypeError: Cannot destructure property 'preloadScripts' of 'binding.startupData' as it is null.",
                "    at https://renderer.example.test/app.js:1:2",
              ].join("\n"),
            },
          ],
          type: "error",
        },
      }),
    });
    expect(page.errors).toHaveLength(2);

    socket.emit("message", {
      data: JSON.stringify({
        method: "Runtime.exceptionThrown",
        params: {
          exceptionDetails: {
            text: [
              "TypeError: Cannot destructure property 'preloadScripts' of 'binding.startupData' as it is null.",
              "    at https://renderer.example.test/app.js:1:2",
            ].join("\n"),
          },
        },
      }),
    });
    expect(page.errors).toHaveLength(3);
  });

  it("waits for the expected document title before attaching to a page", () => {
    const expectedUrl = "skills-desktop://review/index.html";
    const expectedTitle = "Skills Desktop Trusted Review";
    expect(
      cdpTargetMatches(
        { title: "", type: "page", url: expectedUrl },
        expectedUrl,
        expectedTitle,
      ),
    ).toBe(false);
    expect(
      cdpTargetMatches(
        { title: expectedTitle, type: "page", url: expectedUrl },
        expectedUrl,
        expectedTitle,
      ),
    ).toBe(true);
  });

  it("rejects a request at its configured deadline", async () => {
    const socket = new FakeSocket();
    const page = new CdpPage(socket, { requestTimeoutMs: 20 });

    await expect(page.send("Runtime.evaluate")).rejects.toBeInstanceOf(
      CdpRequestTimeoutError,
    );
    expect(socket.sent).toHaveLength(1);
  });

  it("lets semantic waits outlive the default CDP request timeout", async () => {
    const socket = new FakeSocket();
    const page = new CdpPage(socket, { requestTimeoutMs: 20 });
    const waiting = page.waitFor("true", "delayed condition", 50);

    await new Promise((resolve) => setTimeout(resolve, 30));
    socket.respond(1, { result: { value: true } });

    await expect(waiting).resolves.toBeUndefined();
  });

  it("rechecks semantic waits when focus changes without a DOM mutation", async () => {
    const socket = new FakeSocket();
    const page = new CdpPage(socket, { requestTimeoutMs: 500 });
    const waiting = page.waitFor(
      "document.hasFocus() === true",
      "native focus",
      200,
    );
    const state = { focused: false };
    const evaluated = runInNewContext(socket.sent[0].params.expression, {
      clearInterval,
      clearTimeout,
      document: { hasFocus: () => state.focused },
      MutationObserver: class {
        disconnect() {}
        observe() {}
      },
      setInterval,
      setTimeout,
    });

    setTimeout(() => {
      state.focused = true;
    }, 30);
    socket.respond(1, { result: { value: await evaluated } });

    await expect(waiting).resolves.toBeUndefined();
  });

  it("requires a semantic condition to remain true for its stability window", async () => {
    const socket = new FakeSocket();
    const page = new CdpPage(socket, { requestTimeoutMs: 500 });
    const waiting = page.waitFor("state.read()", "stable focus", 500, {
      stableMs: 80,
    });
    const readings = [];
    const state = {
      focused: true,
      read() {
        readings.push(this.focused);
        return this.focused;
      },
    };
    const evaluated = runInNewContext(socket.sent[0].params.expression, {
      clearInterval,
      clearTimeout,
      document: {},
      MutationObserver: class {
        disconnect() {}
        observe() {}
      },
      setInterval,
      setTimeout,
      state,
    });

    setTimeout(() => {
      state.focused = false;
    }, 40);
    setTimeout(() => {
      state.focused = true;
    }, 120);
    socket.respond(1, { result: { value: await evaluated } });

    await expect(waiting).resolves.toBeUndefined();
    expect(readings).toContain(false);
    expect(
      readings.slice(readings.lastIndexOf(false) + 1).filter(Boolean).length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("rejects pending and future requests when the browser disconnects", async () => {
    const socket = new FakeSocket();
    const page = new CdpPage(socket, { requestTimeoutMs: 1_000 });
    const pending = page.send("Runtime.enable");

    socket.close();

    await expect(pending).rejects.toBeInstanceOf(CdpDisconnectedError);
    await expect(page.send("Page.enable")).rejects.toBeInstanceOf(
      CdpDisconnectedError,
    );
  });

  it("disconnects pending and future requests when the run is interrupted", async () => {
    const socket = new FakeSocket();
    const controller = new AbortController();
    const page = new CdpPage(socket, {
      requestTimeoutMs: 1_000,
      signal: controller.signal,
    });
    const pending = page.send("Runtime.enable");

    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(CdpDisconnectedError);
    await expect(page.send("Page.enable")).rejects.toBeInstanceOf(
      CdpDisconnectedError,
    );
    expect(socket.readyState).toBe(FakeSocket.CLOSED);
  });

  it("rejects requests while the browser is closing", async () => {
    const socket = new FakeSocket();
    const page = new CdpPage(socket, { requestTimeoutMs: 1_000 });
    socket.readyState = 2;

    await expect(page.send("Runtime.enable")).rejects.toBeInstanceOf(
      CdpDisconnectedError,
    );
    expect(socket.sent).toHaveLength(0);
  });

  it("fails closed and rejects pending work when CDP will not disconnect", async () => {
    const socket = new FakeSocket();
    socket.close = () => {
      socket.readyState = 2;
    };
    const page = new CdpPage(socket, { requestTimeoutMs: 1_000 });
    const pending = page.send("Runtime.enable");
    const pendingRejection = expect(pending).rejects.toBeInstanceOf(
      CdpDisconnectedError,
    );

    await expect(page.disconnect(20)).rejects.toThrow(/did not close/i);
    await pendingRejection;
    await expect(page.send("Page.enable")).rejects.toBeInstanceOf(
      CdpDisconnectedError,
    );
  });

  it("resolves a response and keeps request ids monotonic", async () => {
    const socket = new FakeSocket();
    const page = new CdpPage(socket, { requestTimeoutMs: 100 });
    const response = page.send("Runtime.enable");
    socket.respond(1, { enabled: true });

    await expect(response).resolves.toEqual({ enabled: true });
    expect(socket.sent[0].id).toBe(1);
  });

  it("sends activation text and keyboard modifiers through CDP", async () => {
    const socket = new FakeSocket();
    const page = new CdpPage(socket, { requestTimeoutMs: 100 });
    const enter = page.dispatchKey("Enter");

    expect(socket.sent[0].params).toMatchObject({
      key: "Enter",
      modifiers: 0,
      text: "\r",
      type: "keyDown",
      unmodifiedText: "\r",
    });
    socket.respond(1, {});
    await new Promise((resolve) => queueMicrotask(resolve));
    expect(socket.sent[1].params).toMatchObject({
      key: "Enter",
      modifiers: 0,
      type: "keyUp",
    });
    socket.respond(2, {});
    await enter;

    const reverseTab = page.dispatchKey("Tab", "Tab", { modifiers: 8 });
    expect(socket.sent[2].params).toMatchObject({
      key: "Tab",
      modifiers: 8,
      type: "keyDown",
    });
    socket.respond(3, {});
    await new Promise((resolve) => queueMicrotask(resolve));
    socket.respond(4, {});
    await reverseTab;
  });
});

describe("packaged UI QA fixture seam", () => {
  it("owns all mutable launch state under one disposable root", async () => {
    const fixture = await createPackagedQaFixture();
    fixtures.push(fixture);

    expect(fixture.root).toContain("skills-desktop-ui-qa-");
    for (const path of [
      fixture.home,
      fixture.workspace,
      fixture.recovery,
      fixture.config,
      fixture.cache,
      fixture.bin,
      fixture.artifacts,
    ]) {
      expectDescendant(fixture.root, path);
    }
    expect(fixture.environment.HOME).toBe(fixture.home);
    expect(fixture.environment.SKILLS_DESKTOP_WORKSPACE).toBe(
      fixture.workspace,
    );
    expect(fixture.environment.XDG_CONFIG_HOME).toBe(fixture.config);
    expect(fixture.environment.XDG_CACHE_HOME).toBe(fixture.cache);
    expect(fixture.environment.TMPDIR).toBe(fixture.temporary);
  });

  it("treats an explicit root as a parent and preserves caller-owned siblings", async () => {
    const parent = await mkdtemp(
      join(tmpdir(), "skills-desktop-ui-qa-parent-"),
    );
    const callerFile = join(parent, "caller-sentinel.txt");
    const siblingFile = join(parent, "sibling.txt");
    await writeFile(callerFile, "keep caller file");
    await writeFile(siblingFile, "keep sibling file");

    const fixture = await createPackagedQaFixture({ root: parent });
    fixtures.push(fixture);
    fixtures.push({
      cleanup: () => rm(parent, { force: true, recursive: true }),
    });

    expect(fixture.root).not.toBe(parent);
    expectDescendant(parent, fixture.root);
    await fixture.cleanup();

    await expect(access(fixture.root)).rejects.toThrow();
    await expect(readFile(callerFile, "utf8")).resolves.toBe(
      "keep caller file",
    );
    await expect(readFile(siblingFile, "utf8")).resolves.toBe(
      "keep sibling file",
    );
  });

  it("provides deterministic inventory and controllable process failures", async () => {
    const fixture = await createPackagedQaFixture();
    fixtures.push(fixture);

    expect(await fixture.readInventory()).toEqual({
      global: [
        expect.objectContaining({ name: "qa-global-skill", scope: "global" }),
      ],
      project: [
        expect.objectContaining({ name: "qa-project-skill", scope: "project" }),
      ],
    });
    await fixture.setProcessMode("failure");
    expect(await fixture.readProcessMode()).toBe("failure");
    await fixture.setProcessMode("empty");
    expect(await fixture.readProcessMode()).toBe("empty");
  });

  it("keeps the npm cache and Electron user data inside the fixture root", async () => {
    const fixture = await createPackagedQaFixture();
    fixtures.push(fixture);

    expect(fixture.environment.NPM_CONFIG_CACHE).toBe(fixture.cache);
    expect(fixture.userData).toBe(join(fixture.config, "Skills Desktop"));
    expectDescendant(fixture.root, fixture.userData);
  });

  it("resolves a packaged executable from an explicit override or platform candidates", () => {
    expect(
      resolvePackagedExecutable({
        root: "/repo",
        platform: "linux",
        arch: "x64",
        override: "/owned/package/skills-desktop",
      }),
    ).toBe("/owned/package/skills-desktop");
    expect(
      resolvePackagedExecutable({
        root: "/repo",
        platform: "darwin",
        arch: "arm64",
      }),
    ).toBe(
      join(
        "/repo",
        "apps",
        "desktop",
        "out",
        "Skills Desktop-darwin-arm64",
        "Skills Desktop.app",
        "Contents",
        "MacOS",
        "skills-desktop",
      ),
    );
    expect(
      resolvePackagedExecutable({
        root: "C:\\repo",
        platform: "win32",
        arch: "x64",
      }),
    ).toBe(
      join(
        "C:\\repo",
        "apps",
        "desktop",
        "out",
        "Skills Desktop-win32-x64",
        "skills-desktop.exe",
      ),
    );
  });

  it("creates the Windows node/npm/npx layout used by the production resolver", async () => {
    const fixture = await createPackagedQaFixture({ platform: "win32" });
    fixtures.push(fixture);

    await expect(
      access(join(fixture.bin, "node.exe")),
    ).resolves.toBeUndefined();
    await expect(
      access(join(fixture.bin, "node_modules", "npm", "bin", "npx-cli.js")),
    ).resolves.toBeUndefined();
    await expect(
      access(join(fixture.bin, "npm.cmd")),
    ).resolves.toBeUndefined();
    await expect(
      access(join(fixture.bin, "npx.cmd")),
    ).resolves.toBeUndefined();
    expect(fixture.environment.PATH?.split(";")[0]).toBe(fixture.bin);
    expect(fixture.environment.APPDATA).toBe(
      join(fixture.config, "Roaming"),
    );
    expect(fixture.environment.LOCALAPPDATA).toBe(
      join(fixture.config, "Local"),
    );
    expect(fixture.environment.USERPROFILE).toBe(fixture.home);
    expect(fixture.environment.TEMP).toBe(fixture.temporary);
    expect(fixture.environment.TMP).toBe(fixture.temporary);
  });

  it("fails when the packaged QA runtime architecture does not match", () => {
    expect(assertRuntimeArchitecture(process.arch)).toBe(process.arch);
    expect(() =>
      assertRuntimeArchitecture(process.arch === "x64" ? "arm64" : "x64"),
    ).toThrow(/architecture mismatch/i);
  });
});

describe("packaged Electron launcher seam", () => {
  it("launches with only fixture-approved environment variables", () => {
    const environment = packagedLaunchEnvironment({
      ELECTRON_RUN_AS_NODE: "1",
      HOME: "/fixture/home",
      PATH: "/fixture/bin",
    });

    expect(environment).toEqual({
      HOME: "/fixture/home",
      PATH: "/fixture/bin",
    });
    expect(environment).not.toHaveProperty("GITHUB_TOKEN");
  });

  it("allocates loopback-only ports", async () => {
    const port = await findAvailablePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65_535);
  });

  it("does not launch without an explicitly owned fixture", async () => {
    await expect(
      launchPackagedElectron({
        executable: "/missing/skills-desktop",
      }),
    ).rejects.toThrow(/fixture/i);
  });

  it("rejects fixture paths outside the owned root before writing logs", async () => {
    const fixture = await createPackagedQaFixture();
    fixtures.push(fixture);
    const outside = await mkdtemp(join(tmpdir(), "skills-desktop-qa-outside-"));
    fixtures.push({
      cleanup: () => rm(outside, { force: true, recursive: true }),
    });

    for (const field of ["artifacts", "userData", "workspace"]) {
      await expect(
        launchPackagedElectron({
          executable: "/missing/skills-desktop",
          fixture: { ...fixture, [field]: outside },
        }),
      ).rejects.toThrow(/inside the fixture-owned root/i);
    }
    for (const name of ["HOME", "SKILLS_DESKTOP_WORKSPACE", "TMPDIR"]) {
      await expect(
        launchPackagedElectron({
          executable: "/missing/skills-desktop",
          fixture: {
            ...fixture,
            environment: { ...fixture.environment, [name]: outside },
          },
        }),
      ).rejects.toThrow(/environment must stay inside/i);
    }
    await expect(
      launchPackagedElectron({
        executable: "/missing/skills-desktop",
        fixture: {
          ...fixture,
          environment: {
            ...fixture.environment,
            PATH: `${outside}${delimiter}${fixture.environment.PATH}`,
          },
        },
      }),
    ).rejects.toThrow(/environment must stay inside/i);
    await expect(
      launchPackagedElectron({
        executable: "/missing/skills-desktop",
        fixture: {
          ...fixture,
          environment: {
            ...fixture.environment,
            NPM_CONFIG_USERCONFIG: join(outside, "npmrc"),
          },
        },
      }),
    ).rejects.toThrow(/environment must stay inside/i);
    await expect(
      access(join(outside, "electron.stdout.log")),
    ).rejects.toThrow();
    await expect(
      access(join(outside, "electron.stderr.log")),
    ).rejects.toThrow();
  });

  it.skipIf(process.platform === "win32")(
    "rejects a fixture environment symlink that resolves outside its root",
    async () => {
      const fixture = await createPackagedQaFixture();
      fixtures.push(fixture);
      const outside = await mkdtemp(
        join(tmpdir(), "skills-desktop-qa-symlink-outside-"),
      );
      fixtures.push({
        cleanup: () => rm(outside, { force: true, recursive: true }),
      });
      const escapedHome = join(fixture.root, "escaped-home");
      await symlink(outside, escapedHome, "dir");

      await expect(
        launchPackagedElectron({
          executable: "/missing/skills-desktop",
          fixture: {
            ...fixture,
            environment: { ...fixture.environment, HOME: escapedHome },
          },
        }),
      ).rejects.toThrow(/inside the fixture-owned root/i);
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects a symlinked fixture ancestor before creating an outside directory",
    async () => {
      const fixture = await createPackagedQaFixture();
      fixtures.push(fixture);
      const outside = await mkdtemp(
        join(tmpdir(), "skills-desktop-qa-ancestor-outside-"),
      );
      fixtures.push({
        cleanup: () => rm(outside, { force: true, recursive: true }),
      });
      const escapedAncestor = join(fixture.root, "escaped-artifacts");
      const outsideArtifacts = join(outside, "nested-artifacts");
      await symlink(outside, escapedAncestor, "dir");

      await expect(
        launchPackagedElectron({
          executable: "/missing/skills-desktop",
          fixture: {
            ...fixture,
            artifacts: join(escapedAncestor, "nested-artifacts"),
          },
        }),
      ).rejects.toThrow(/inside the fixture-owned root/i);
      await expect(access(outsideArtifacts)).rejects.toThrow();
    },
  );

  it("stops a Windows process tree through the injected terminator", async () => {
    const directKills = [];
    const treeKills = [];
    const child = {
      exitCode: null,
      kill: (signal) => directKills.push(signal),
      pid: 4242,
      signalCode: null,
    };

    await stopChild(child, Promise.resolve({ kind: "exit", code: 0 }), {
      killWindowsTree: async (pid) => treeKills.push(pid),
      platform: "win32",
      stopTimeoutMs: 20,
      treeTerminationTimeoutMs: 20,
    });

    expect(treeKills).toEqual([4242]);
    expect(directKills).toEqual([]);
  });

  it("stops a surviving Windows process tree after the direct child exits", async () => {
    const directKills = [];
    const treeKills = [];
    const child = {
      exitCode: 0,
      kill: (signal) => directKills.push(signal),
      pid: 4243,
      signalCode: null,
    };

    await stopChild(child, Promise.resolve({ kind: "exit", code: 0 }), {
      killWindowsTree: async (pid) => treeKills.push(pid),
      platform: "win32",
      stopTimeoutMs: 20,
      treeTerminationTimeoutMs: 20,
    });

    expect(treeKills).toEqual([4243]);
    expect(directKills).toEqual([]);
  });

  it("bounds a hanging Windows process-tree terminator", async () => {
    const child = {
      exitCode: null,
      kill: () => {
        throw new Error("direct child termination is not allowed");
      },
      pid: 4343,
      signalCode: null,
    };
    const startedAt = Date.now();

    await expect(
      stopChild(child, new Promise(() => {}), {
        killWindowsTree: () => new Promise(() => {}),
        platform: "win32",
        stopTimeoutMs: 20,
        treeTerminationTimeoutMs: 20,
      }),
    ).rejects.toThrow(/timed out/i);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it("does not issue a second Windows tree kill when exit is not observed", async () => {
    const treeKills = [];
    const child = {
      exitCode: null,
      kill: () => {
        throw new Error("direct child termination is not allowed");
      },
      pid: 4344,
      signalCode: null,
    };

    await expect(
      stopChild(child, new Promise(() => {}), {
        killWindowsTree: async (pid) => treeKills.push(pid),
        platform: "win32",
        stopTimeoutMs: 20,
        treeTerminationTimeoutMs: 20,
      }),
    ).rejects.toThrow(/did not exit/i);
    expect(treeKills).toEqual([4344]);
  });

  it("fails closed when a forced POSIX child exit is not observed", async () => {
    const signals = [];
    const child = {
      exitCode: null,
      kill: (signal) => signals.push(signal),
      pid: undefined,
      signalCode: null,
    };

    await expect(
      stopChild(child, new Promise(() => {}), {
        platform: "linux",
        stopTimeoutMs: 20,
      }),
    ).rejects.toThrow(/did not exit/i);
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("kills a surviving POSIX process group after its direct child exits", async () => {
    const signals = [];
    let groupAlive = true;
    const child = {
      exitCode: 0,
      kill: () => {
        throw new Error("direct child termination is not allowed");
      },
      pid: 4545,
      signalCode: null,
    };

    await stopChild(child, Promise.resolve({ code: 0, kind: "exit" }), {
      platform: "linux",
      posixProcessGroupAlive: () => groupAlive,
      signalPosixProcessGroup: (_pid, signal) => {
        signals.push(signal);
        if (signal === "SIGKILL") groupAlive = false;
      },
      stopTimeoutMs: 20,
    });

    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("accepts an observed Darwin child exit while a dead group remains observable", async () => {
    const signals = [];
    let groupProbeCount = 0;
    const child = {
      exitCode: null,
      kill: () => {
        throw new Error("direct child termination is not allowed");
      },
      pid: 4646,
      signalCode: null,
    };
    const childExit = new Promise((resolve) => {
      queueMicrotask(() => resolve({ code: 0, kind: "exit" }));
    });

    await stopChild(child, childExit, {
      platform: "darwin",
      posixProcessGroupAlive: () => {
        groupProbeCount += 1;
        return true;
      },
      signalPosixProcessGroup: (_pid, signal) => signals.push(signal),
      stopTimeoutMs: 20,
    });

    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(groupProbeCount).toBeGreaterThan(1);
  });

  it("fails closed when forced Darwin process-group SIGKILL delivery fails", async () => {
    const signals = [];
    const child = {
      exitCode: null,
      kill: () => {
        throw new Error("direct child termination is not allowed");
      },
      pid: 4747,
      signalCode: null,
    };
    const signalError = Object.assign(
      new Error("permission denied for process-group SIGKILL"),
      { code: "EPERM" },
    );

    await expect(
      stopChild(child, new Promise(() => {}), {
        platform: "darwin",
        posixProcessGroupAlive: () => true,
        signalPosixProcessGroup: (_pid, signal) => {
          signals.push(signal);
          if (signal === "SIGKILL") throw signalError;
        },
        stopTimeoutMs: 20,
      }),
    ).rejects.toBe(signalError);
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("bounds a Darwin process-group stop when direct-child exit is unobserved", async () => {
    const signals = [];
    const child = {
      exitCode: null,
      kill: () => {
        throw new Error("direct child termination is not allowed");
      },
      pid: 4848,
      signalCode: null,
    };
    const startedAt = Date.now();

    await expect(
      stopChild(child, new Promise(() => {}), {
        platform: "darwin",
        posixProcessGroupAlive: () => true,
        signalPosixProcessGroup: (_pid, signal) => signals.push(signal),
        stopTimeoutMs: 20,
      }),
    ).rejects.toThrow(/direct child did not exit/i);

    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it("invokes taskkill with an argument-array process-tree contract", async () => {
    const calls = [];
    const completion = terminateWindowsProcessTree(4444, {
      execFileImpl: (command, args, options, callback) => {
        calls.push({ args, command, options });
        queueMicrotask(() => callback(null));
      },
      timeoutMs: 20,
    });

    await completion;
    expect(calls).toEqual([
      {
        args: ["/pid", "4444", "/t", "/f"],
        command: "taskkill.exe",
        options: expect.objectContaining({ shell: false }),
      },
    ]);
  });

  it("clears a Windows tree timeout after immediate termination", async () => {
    vi.useFakeTimers();
    try {
      const completion = terminateWindowsProcessTree(4546, {
        execFileImpl: (_file, _args, _options, callback) => callback(null),
        timeoutMs: 3_000,
      });

      await completion;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when taskkill cannot prove the process tree was removed", async () => {
    const completion = terminateWindowsProcessTree(4445, {
      execFileImpl: (_command, _args, _options, callback) => {
        const error = Object.assign(
          new Error('ERROR: The process "4445" not found.'),
          { code: 128 },
        );
        queueMicrotask(() => callback(error));
      },
      timeoutMs: 20,
    });

    await expect(completion).rejects.toMatchObject({ code: 128 });
  });
});

describe("packaged UI QA scenario contract", () => {
  it("classifies only bounded focus-restoration state", () => {
    expect(reviewActionFocusDiagnostic(undefined)).toBe(
      "focus-state-unavailable",
    );
    expect(
      reviewActionFocusDiagnostic({
        documentFocused: false,
        targetActive: false,
        targetDisabled: false,
        targetPresent: true,
      }),
    ).toBe("workspace-unfocused");
    expect(
      reviewActionFocusDiagnostic({
        documentFocused: true,
        targetActive: false,
        targetDisabled: true,
        targetPresent: true,
      }),
    ).toBe("review-action-disabled");
    expect(
      reviewActionFocusDiagnostic({
        documentFocused: true,
        targetActive: false,
        targetDisabled: false,
        targetPresent: true,
      }),
    ).toBe("review-action-not-active");
    expect(
      mutationOutcomeFocusDiagnostic({
        documentFocused: true,
        targetActive: false,
        targetPresent: false,
      }),
    ).toBe("mutation-outcome-missing");
    expect(
      mutationOutcomeFocusDiagnostic({
        documentFocused: true,
        targetActive: false,
        targetPresent: true,
      }),
    ).toBe("mutation-outcome-not-active");
  });

  it("propagates only context-bound diagnostics through scenario errors", () => {
    const failure = createPackagedUiQaScenarioError(new Error("untrusted"), {
      check: "workspace-review-focus-restore",
      diagnostic: "review-action-disabled",
      stage: "focus-order",
    });
    expect(failureReceipt(failure)).toMatchObject({
      check: "workspace-review-focus-restore",
      diagnostic: "review-action-disabled",
      stage: "focus-order",
    });
    failure.qaCheck = "error-state-render";
    expect(failureReceipt(failure).diagnostic).toBe("unknown");

    failure.qaCheck = "workspace-axe";
    failure.qaDiagnostic = "axe-blocking-color-contrast";
    expect(failureReceipt(failure).diagnostic).toBe(
      "axe-blocking-color-contrast",
    );
    failure.qaCheck = "workspace-semantics";
    expect(failureReceipt(failure).diagnostic).toBe("unknown");
  });

  it("documents the required Local-only scenarios and setup commands", () => {
    expect(PACKAGED_UI_QA_SCENARIOS).toEqual([
      "keyboard-workflow",
      "focus-order",
      "axe-semantics",
      "narrow-layout",
      "reduced-motion",
      "empty-state",
      "error-state",
      "console-failures",
    ]);
    const help = packagedUiQaHelp();
    expect(help).toContain("npm run package:linux");
    expect(help).toContain("xvfb-run -a npm run qa:packaged-ui");
    expect(help).not.toContain("sshd");
  });

  it("writes only an allowlisted failure receipt to the artifact upload path", async () => {
    const fixture = await createPackagedQaFixture();
    fixtures.push(fixture);
    await writeFile(
      join(fixture.artifacts, "electron.stdout.log"),
      "/Users/alice/skills-desktop\nhttps://example.test/?token=top-secret\n",
    );
    await writeFile(
      join(fixture.artifacts, "electron.stderr.log"),
      'Authorization: Bearer secret-value\nAPI_KEY=another-secret\nAWS_SECRET_ACCESS_KEY=env-secret\npassword="my secret value"\npath=C:\\Users\\Alice Smith\\repo\n',
    );
    const destination = await mkdtemp(join(tmpdir(), "skills-desktop-qa-art-"));
    fixtures.push({
      cleanup: () => rm(destination, { force: true, recursive: true }),
    });
    await writeFile(join(destination, "error.txt"), "stale artifact");
    const error = new Error(
      'qa failed at /tmp/fixture and C:\\Users\\Alice with https://example.test/path, Authorization: Basic dXNlcjpwYXNz, --token unquoted-secret, and sk_live_example',
    );
    error.name = "PackagedUiQaScenarioError";
    error.qaCheck = "workspace-review-focus-restore";
    error.qaDiagnostic = "review-action-disabled";
    error.qaStage = "focus-order";
    await persistFailureArtifacts(
      error,
      destination,
    );
    expect(safeFailureSummary(error)).toBe(
      "Packaged UI QA failed during focus-order/workspace-review-focus-restore (PackagedUiQaScenarioError; review-action-disabled).",
    );
    const untrusted = Object.assign(new Error("sk_live_untrusted"), {
      name: "sk_live_class",
      qaCheck: "sk_live_check",
      qaDiagnostic: "sk_live_diagnostic",
      qaStage: "sk_live_stage",
    });
    expect(failureReceipt(untrusted)).toMatchObject({
      check: "unknown",
      diagnostic: "unknown",
      errorClass: "Error",
      stage: "unknown",
    });
    expect(safeFailureSummary(untrusted)).toBe(
      "Packaged UI QA failed during unknown/unknown (Error; unknown).",
    );
    if (process.platform !== "win32") {
      expect((await stat(join(destination, "failure.json"))).mode & 0o777).toBe(
        0o600,
      );
    }
    const artifact = await readFile(join(destination, "failure.json"), "utf8");
    expect(JSON.parse(artifact)).toEqual({
      architecture: process.arch,
      check: "workspace-review-focus-restore",
      diagnostic: "review-action-disabled",
      errorClass: "PackagedUiQaScenarioError",
      platform: process.platform,
      schemaVersion: 1,
      stage: "focus-order",
    });
    for (const secret of [
      "/Users/alice/skills-desktop",
      "/tmp/fixture",
      "https://example.test",
      "top-secret",
      "secret-value",
      "another-secret",
      "env-secret",
      "my secret value",
      "Alice",
      "dXNlcjpwYXNz",
      "unquoted-secret",
      "sk_live_diagnostic",
      "sk_live_example",
    ]) {
      expect(artifact).not.toContain(secret);
    }
    await expect(
      access(join(destination, "electron.stdout.log")),
    ).rejects.toThrow();
    await expect(
      access(join(destination, "electron.stderr.log")),
    ).rejects.toThrow();
  });

  it("pins the axe-core runtime used by the packaged scan", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    );
    const packageLock = JSON.parse(
      await readFile(
        new URL("../../package-lock.json", import.meta.url),
        "utf8",
      ),
    );
    expect(packageJson.devDependencies["axe-core"]).toBe("4.13.0");
    expect(packageLock.packages[""].devDependencies["axe-core"]).toBe("4.13.0");
    expect(packageLock.packages["node_modules/axe-core"]).toMatchObject({
      integrity:
        "sha512-UzGt8zg7Ny8djbYMhxl2zuEevVa7r2gJjYY5Lwr1xM7+XU2nd6CkIWFTVcCIbAP63vSz71NaVyyuSk9lHKcy0A==",
      version: "4.13.0",
    });
  });

  it("fails closed when the pinned axe source cannot be loaded", async () => {
    await expect(
      requireAxeSource("/missing/axe-core/axe.min.js"),
    ).rejects.toThrow(/axe-core/i);
  });

  it("does not launch without a packaged executable", async () => {
    const failure = runPackagedUiQa({
      executable: "/missing/skills-desktop",
      fixture: await createPackagedQaFixture().then((fixture) => {
        fixtures.push(fixture);
        return fixture;
      }),
    });
    await expect(failure).rejects.toMatchObject({
      message: "Packaged UI QA scenario failed.",
      name: "PackagedUiQaScenarioError",
      qaCheck: "executable-launch",
      qaStage: "launch",
    });
  });
});
