import { afterEach, describe, expect, it } from "vitest";

import {
  CdpDisconnectedError,
  CdpPage,
  CdpRequestTimeoutError,
} from "./cdp.mjs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { persistFailureArtifacts } from "./artifacts.mjs";
import {
  assertRuntimeArchitecture,
  createPackagedQaFixture,
  resolvePackagedExecutable,
} from "./fixture.mjs";
import { findAvailablePort, launchPackagedElectron } from "./launch.mjs";
import {
  PACKAGED_UI_QA_SCENARIOS,
  requireAxeSource,
  packagedUiQaHelp,
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

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

describe("packaged UI QA CDP seam", () => {
  it("rejects a request at its configured deadline", async () => {
    const socket = new FakeSocket();
    const page = new CdpPage(socket, { requestTimeoutMs: 20 });

    await expect(page.send("Runtime.evaluate")).rejects.toBeInstanceOf(
      CdpRequestTimeoutError,
    );
    expect(socket.sent).toHaveLength(1);
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

  it("rejects requests while the browser is closing", async () => {
    const socket = new FakeSocket();
    const page = new CdpPage(socket, { requestTimeoutMs: 1_000 });
    socket.readyState = 2;

    await expect(page.send("Runtime.enable")).rejects.toBeInstanceOf(
      CdpDisconnectedError,
    );
    expect(socket.sent).toHaveLength(0);
  });

  it("resolves a response and keeps request ids monotonic", async () => {
    const socket = new FakeSocket();
    const page = new CdpPage(socket, { requestTimeoutMs: 100 });
    const response = page.send("Runtime.enable");
    socket.respond(1, { enabled: true });

    await expect(response).resolves.toEqual({ enabled: true });
    expect(socket.sent[0].id).toBe(1);
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
      expect(path.startsWith(`${fixture.root}/`)).toBe(true);
    }
    expect(fixture.environment.HOME).toBe(fixture.home);
    expect(fixture.environment.SKILLS_DESKTOP_WORKSPACE).toBe(
      fixture.workspace,
    );
    expect(fixture.environment.XDG_CONFIG_HOME).toBe(fixture.config);
    expect(fixture.environment.XDG_CACHE_HOME).toBe(fixture.cache);
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
    expect(fixture.userData).toBe(`${fixture.config}/Skills Desktop`);
    expect(fixture.userData.startsWith(`${fixture.root}/`)).toBe(true);
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
    ).toContain("Skills Desktop.app/Contents/MacOS/skills-desktop");
    expect(
      resolvePackagedExecutable({
        root: "C:\\repo",
        platform: "win32",
        arch: "x64",
      }),
    ).toContain("skills-desktop.exe");
  });

  it("creates the Windows node/npm/npx layout used by the production resolver", async () => {
    const fixture = await createPackagedQaFixture({ platform: "win32" });
    fixtures.push(fixture);

    await expect(access(`${fixture.bin}/node.exe`)).resolves.toBeUndefined();
    await expect(
      access(`${fixture.bin}/node_modules/npm/bin/npx-cli.js`),
    ).resolves.toBeUndefined();
    await expect(access(`${fixture.bin}/npm.cmd`)).resolves.toBeUndefined();
    await expect(access(`${fixture.bin}/npx.cmd`)).resolves.toBeUndefined();
    expect(fixture.environment.PATH?.split(";")[0]).toBe(fixture.bin);
  });

  it("fails when the packaged QA runtime architecture does not match", () => {
    expect(assertRuntimeArchitecture(process.arch)).toBe(process.arch);
    expect(() =>
      assertRuntimeArchitecture(process.arch === "x64" ? "arm64" : "x64"),
    ).toThrow(/architecture mismatch/i);
  });
});

describe("packaged Electron launcher seam", () => {
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
});

describe("packaged UI QA scenario contract", () => {
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

  it("writes failure-only redacted logs to an explicit artifact directory", async () => {
    const fixture = await createPackagedQaFixture();
    fixtures.push(fixture);
    await writeFile(
      `${fixture.artifacts}/electron.stdout.log`,
      "/Users/alice/skills-desktop\nhttps://example.test/?token=top-secret\n",
    );
    await writeFile(
      `${fixture.artifacts}/electron.stderr.log`,
      "Authorization: Bearer secret-value\nAPI_KEY=another-secret\nAWS_SECRET_ACCESS_KEY=env-secret\n",
    );
    const destination = await mkdtemp(join(tmpdir(), "skills-desktop-qa-art-"));
    fixtures.push({ cleanup: () => rm(destination, { force: true, recursive: true }) });
    await persistFailureArtifacts(
      fixture,
      new Error(
        "qa failed at /tmp/fixture with https://example.test/path and token=error-secret",
      ),
      destination,
    );
    const artifact = await Promise.all(
      ["error.txt", "electron.stdout.log", "electron.stderr.log"].map(
        (name) => readFile(join(destination, name), "utf8"),
      ),
    ).then((values) => values.join("\n"));
    expect(artifact).toContain("qa failed");
    expect(artifact).not.toContain("/Users/alice/skills-desktop");
    expect(artifact).not.toContain("/tmp/fixture");
    expect(artifact).not.toContain("https://example.test");
    expect(artifact).not.toContain("top-secret");
    expect(artifact).not.toContain("secret-value");
    expect(artifact).not.toContain("another-secret");
    expect(artifact).not.toContain("env-secret");
    expect(artifact).not.toContain("error-secret");
  });

  it("pins the axe-core runtime used by the packaged scan", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    );
    const packageLock = JSON.parse(
      await readFile(new URL("../../package-lock.json", import.meta.url), "utf8"),
    );
    expect(packageJson.devDependencies["axe-core"]).toBe("4.11.0");
    expect(packageLock.packages[""].devDependencies["axe-core"]).toBe("4.11.0");
    expect(packageLock.packages["node_modules/axe-core"]).toMatchObject({
      integrity:
        "sha512-ilYanEU8vxxBexpJd8cWM4ElSQq4QctCLKih0TSfjIfCQTeyH/6zVrmIJfLPrKTKJRbiG+cfnZbQIjAlJmF1jQ==",
      version: "4.11.0",
    });
  });

  it("fails closed when the pinned axe source cannot be loaded", async () => {
    await expect(
      requireAxeSource("/missing/axe-core/axe.min.js"),
    ).rejects.toThrow(/axe-core/i);
  });

  it("does not launch without a packaged executable", async () => {
    await expect(
      runPackagedUiQa({
        executable: "/missing/skills-desktop",
        fixture: await createPackagedQaFixture().then((fixture) => {
          fixtures.push(fixture);
          return fixture;
        }),
      }),
    ).rejects.toThrow(/unavailable/i);
  });
});
