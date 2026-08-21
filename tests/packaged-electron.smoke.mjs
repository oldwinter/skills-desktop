import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, watch, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = resolve(
  repositoryRoot,
  "apps/desktop/out/Skills Desktop-linux-x64/skills-desktop",
);
const temporaryRoot = await mkdtemp(join(tmpdir(), "skills-desktop-packaged-"));
const binDirectory = join(temporaryRoot, "bin");
const homeDirectory = join(temporaryRoot, "home");
const workspace = join(temporaryRoot, "workspace");
const npxPath = join(binDirectory, "npx");
const invocationLog = join(homeDirectory, "invocations.log");
const activeChildren = new Set();

class CdpPage {
  constructor(socket) {
    this.errors = [];
    this.nextId = 1;
    this.pending = new Map();
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (pending === undefined) return;
        this.pending.delete(message.id);
        if (message.error !== undefined) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        this.errors.push(message.params.exceptionDetails.text);
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        this.errors.push(
          message.params.args.map((argument) => argument.value ?? argument.description ?? "Error").join(" "),
        );
      }
    });
  }

  static async connect(port) {
    const listTargets = () =>
      fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    let targets = await listTargets();
    let target = targets.find(({ type }) => type === "page");
    if (target === undefined) {
      const browserDetails = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) =>
        response.json(),
      );
      const discoverySocket = new WebSocket(browserDetails.webSocketDebuggerUrl);
      await new Promise((resolveTarget, rejectTarget) => {
        discoverySocket.addEventListener(
          "open",
          () => {
            discoverySocket.send(
              JSON.stringify({
                id: 1,
                method: "Target.setDiscoverTargets",
                params: { discover: true },
              }),
            );
          },
          { once: true },
        );
        discoverySocket.addEventListener("message", (event) => {
          const message = JSON.parse(event.data);
          if (message.method === "Target.targetCreated" && message.params.targetInfo.type === "page") {
            resolveTarget();
          }
        });
        discoverySocket.addEventListener(
          "error",
          () => rejectTarget(new Error("CDP target discovery failed.")),
          { once: true },
        );
      });
      discoverySocket.close();
      targets = await listTargets();
      target = targets.find(({ type }) => type === "page");
    }
    if (target === undefined) throw new Error("Packaged Electron page target is missing.");
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", () => rejectOpen(new Error("CDP connection failed.")), {
        once: true,
      });
    });
    const page = new CdpPage(socket);
    await Promise.all([page.send("Runtime.enable"), page.send("Page.enable")]);
    return page;
  }

  close() {
    this.socket.close();
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      awaitPromise: true,
      expression,
      returnByValue: true,
    });
    if (response.exceptionDetails !== undefined) {
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    }
    return response.result.value;
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolveResult, rejectResult) => {
      this.pending.set(id, { reject: rejectResult, resolve: resolveResult });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async setViewportSize(width, height) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      deviceScaleFactor: 1,
      height,
      mobile: false,
      width,
    });
  }

  async waitFor(expression, label) {
    await this.evaluate(`(() => new Promise((resolve, reject) => {
      const check = () => {
        if (${expression}) {
          observer.disconnect();
          clearTimeout(timeout);
          resolve(true);
        }
      };
      const observer = new MutationObserver(check);
      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error(${JSON.stringify(`Timed out waiting for ${label}.`)}));
      }, 30000);
      observer.observe(document, { childList: true, subtree: true, characterData: true });
      check();
    }))()`);
  }
}

const projectEntry = {
  agents: ["Codex"],
  name: "packaged-project-skill",
  path: "/SECRET_PROJECT_PATH/.agents/skills/packaged-project-skill",
  scope: "project",
  source: "example/packaged-skills",
  sourceType: "github",
  sourceUrl: "https://SECRET_TOKEN@example.test/project.git",
};
const globalEntry = {
  agents: ["Codex"],
  name: "packaged-global-skill",
  path: "/SECRET_HOME_PATH/.agents/skills/packaged-global-skill",
  scope: "global",
  source: null,
  sourceType: null,
  sourceUrl: null,
};

await Promise.all([
  mkdir(binDirectory, { recursive: true }),
  mkdir(homeDirectory, { recursive: true }),
  mkdir(workspace, { recursive: true }),
]);

async function writeScript(mode) {
  await writeFile(
    npxPath,
    `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const { join } = require("node:path");
const args = process.argv.slice(2);
appendFileSync(join(process.env.HOME, "invocations.log"), args.join(" ") + "\\n");
if (args.at(-1) === "--version") {
  process.stdout.write("1.5.23\\n");
} else if (${JSON.stringify(mode)} === "failure") {
  process.stderr.write("SECRET_RAW_STDERR");
  process.exitCode = 2;
} else if (args.join(" ").endsWith("list --json")) {
  process.stdout.write(${JSON.stringify(JSON.stringify([projectEntry]))});
} else if (args.join(" ").endsWith("list --global --json")) {
  process.stdout.write(${JSON.stringify(JSON.stringify([globalEntry]))});
} else {
  process.exitCode = 2;
}
`,
    { mode: 0o700 },
  );
  await chmod(npxPath, 0o700);
}

const launchEnvironment = {
  ...process.env,
  HOME: homeDirectory,
  PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ""}`,
  SKILLS_DESKTOP_WORKSPACE: workspace,
  XDG_CACHE_HOME: join(temporaryRoot, "cache"),
  XDG_CONFIG_HOME: join(temporaryRoot, "config"),
};

async function launch() {
  const errors = [];
  const userDataDirectory = join(temporaryRoot, "config", "Skills Desktop");
  const portFile = join(userDataDirectory, "DevToolsActivePort");
  await mkdir(userDataDirectory, { recursive: true });
  await rm(portFile, { force: true });
  const changes = watch(userDataDirectory);
  const changeIterator = changes[Symbol.asyncIterator]();
  const child = spawn(executablePath, ["--remote-debugging-port=0"], {
    env: launchEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  activeChildren.add(child);
  const childExit = new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => {
      activeChildren.delete(child);
      resolveExit({ code, signal });
    });
  });
  let port;
  try {
    for (;;) {
      try {
        port = (await readFile(portFile, "utf8")).split("\n")[0];
        if (port) break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const next = await Promise.race([
        changeIterator.next(),
        childExit.then(({ code, signal }) => {
          throw new Error(`Packaged Electron exited before CDP was ready (${code ?? signal}).`);
        }),
      ]);
      if (next.done) throw new Error("DevTools port watcher ended before launch.");
    }
  } finally {
    await changeIterator.return?.();
  }
  const page = await CdpPage.connect(port);
  return {
    errors: page.errors,
    page,
    async close() {
      page.close();
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      let forceTimer;
      const exited = await Promise.race([
        childExit.then(() => true),
        new Promise((resolveExit) => {
          forceTimer = setTimeout(() => resolveExit(false), 3_000);
        }),
      ]);
      if (forceTimer !== undefined) clearTimeout(forceTimer);
      if (!exited && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await childExit;
      }
    },
  };
}

try {
  await writeScript("success");
  const first = await launch();
  console.log("packaged smoke: workspace opened");
  await first.page.waitFor(
    `document.body?.textContent?.includes("packaged-project-skill") &&
      document.body?.textContent?.includes("packaged-global-skill") &&
      document.body?.textContent?.includes("Fresh evidence")`,
    "fresh Inventory evidence",
  );
  console.log("packaged smoke: fresh inventory rendered");

  const rendererBoundary = await first.page.evaluate(`({
    bridgeKeys: Object.keys(window.skillsDesktop).sort(),
    hasNodeProcess: typeof window.process !== "undefined",
    hasRequire: typeof window.require !== "undefined",
    text: document.body.textContent ?? "",
    url: window.location.href,
  })`);
  console.log("packaged smoke: renderer boundary inspected");
  if (rendererBoundary.hasNodeProcess || rendererBoundary.hasRequire) {
    throw new Error("Renderer exposes a Node.js primitive.");
  }
  if (rendererBoundary.url !== "skills-desktop://workspace/index.html") {
    throw new Error(`Unexpected packaged URL: ${rendererBoundary.url}`);
  }
  if (
    JSON.stringify(rendererBoundary.bridgeKeys) !==
    JSON.stringify(["cancelInventory", "getSnapshot", "refreshInventory", "subscribe"])
  ) {
    throw new Error(`Unexpected preload surface: ${rendererBoundary.bridgeKeys.join(", ")}`);
  }
  if (/SECRET_PROJECT_PATH|SECRET_HOME_PATH|SECRET_TOKEN|SECRET_RAW_STDERR/.test(rendererBoundary.text)) {
    throw new Error("Sensitive process evidence reached the renderer.");
  }
  const maliciousPayload = await first.page.evaluate(
    `window.skillsDesktop.refreshInventory({ executable: "sh" })`,
  );
  if (maliciousPayload.ok || maliciousPayload.error?.code !== "invalid_request") {
    throw new Error(`Malicious preload payload was not rejected: ${JSON.stringify(maliciousPayload)}`);
  }
  const subframeBoundary = await first.page.evaluate(`(() => {
    const frame = document.createElement("iframe");
    frame.srcdoc = "<p>untrusted frame</p>";
    document.body.append(frame);
    const bridgeType = typeof frame.contentWindow?.skillsDesktop;
    frame.remove();
    return bridgeType;
  })()`);
  if (subframeBoundary !== "undefined") {
    throw new Error("A renderer subframe received the workspace preload capability.");
  }
  console.log("packaged smoke: hostile payload and subframe rejected");

  await first.page.setViewportSize(760, 820);
  const narrowLayout = await first.page.evaluate(`({
    documentWidth: document.documentElement.scrollWidth,
    rowDisplay: getComputedStyle(document.querySelector(".inventory-table tbody tr")).display,
    targetSummaryDisplay: getComputedStyle(document.querySelector(".mobile-target-summary")).display,
    viewportWidth: window.innerWidth,
    workspaceDisplay: getComputedStyle(document.querySelector(".workspace-layout")).display,
  })`);
  console.log("packaged smoke: narrow layout inspected");
  if (
    narrowLayout.documentWidth > narrowLayout.viewportWidth ||
    narrowLayout.rowDisplay !== "grid" ||
    narrowLayout.targetSummaryDisplay !== "flex" ||
    narrowLayout.workspaceDisplay !== "block"
  ) {
    throw new Error(`Narrow layout failed: ${JSON.stringify(narrowLayout)}`);
  }
  if ((await first.page.evaluate(`document.querySelectorAll('nav[aria-label="Primary"]').length`)) !== 1) {
    throw new Error("Primary navigation semantics are missing.");
  }
  if ((await first.page.evaluate(`document.querySelectorAll("table").length`)) !== 1) {
    throw new Error("Inventory table semantics are missing.");
  }
  await first.page.setViewportSize(420, 820);
  const compactNavigation = await first.page.evaluate(`({
    labels: [...document.querySelectorAll(".nav-item")].map((button) => button.getAttribute("aria-label")),
    targetSummary: document.querySelector(".mobile-target-summary")?.textContent ?? "",
  })`);
  if (
    JSON.stringify(compactNavigation.labels) !==
      JSON.stringify(["Inventory", "Comparison", "Collections", "Targets"]) ||
    !compactNavigation.targetSummary.includes("Codex")
  ) {
    throw new Error(`Compact accessibility contract failed: ${JSON.stringify(compactNavigation)}`);
  }
  await first.close();
  console.log("packaged smoke: first launch closed");
  if (first.errors.length > 0) throw new Error(first.errors.join("\n"));

  await writeScript("failure");
  const second = await launch();
  console.log("packaged smoke: restart opened");
  await second.page.waitFor(
    `document.body?.textContent?.includes("packaged-project-skill") &&
      document.body?.textContent?.includes("Stale after error")`,
    "stale restored Inventory evidence",
  );
  const restoredText = await second.page.evaluate("document.body.innerText");
  if (restoredText.includes("SECRET_RAW_STDERR")) {
    throw new Error("Raw refresh failure reached the restored Inventory shell.");
  }
  await second.close();
  console.log("packaged smoke: stale restart verified");
  if (second.errors.length > 0) throw new Error(second.errors.join("\n"));

  const invocations = (await readFile(invocationLog, "utf8")).trim().split("\n");
  const versionChecks = invocations.filter((line) => line === "--yes skills@1.5.23 --version");
  if (versionChecks.length !== 2) {
    throw new Error(`Expected one version check per Adapter lifetime, got ${versionChecks.length}.`);
  }
  if (!invocations.includes("--yes skills@1.5.23 list --json")) {
    throw new Error("Project Inventory invocation is missing.");
  }
  if (!invocations.includes("--yes skills@1.5.23 list --global --json")) {
    throw new Error("Global Inventory invocation is missing.");
  }
} finally {
  for (const child of activeChildren) child.kill("SIGKILL");
  await rm(temporaryRoot, { force: true, recursive: true });
}
