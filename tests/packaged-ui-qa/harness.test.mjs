import { afterEach, describe, expect, it } from "vitest";

import {
  CdpDisconnectedError,
  CdpPage,
  CdpRequestTimeoutError,
} from "./cdp.mjs";
import {
  createPackagedQaFixture,
  resolvePackagedExecutable,
} from "./fixture.mjs";
import { findAvailablePort, launchPackagedElectron } from "./launch.mjs";
import {
  PACKAGED_UI_QA_SCENARIOS,
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
    ).toContain("Skills Desktop.app/Contents/MacOS/Skills Desktop");
    expect(
      resolvePackagedExecutable({
        root: "C:\\repo",
        platform: "win32",
        arch: "x64",
      }),
    ).toContain("skills-desktop.exe");
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
