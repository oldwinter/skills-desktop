import { execFile, spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  watch,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { promisify } from "node:util";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = resolve(
  repositoryRoot,
  "apps/desktop/out/Skills Desktop-linux-x64/skills-desktop",
);
const temporaryRoot = await mkdtemp(join(tmpdir(), "skills-desktop-packaged-"));
const binDirectory = join(temporaryRoot, "bin");
const homeDirectory = join(temporaryRoot, "home");
const workspace = join(temporaryRoot, "workspace");
const secondWorkspace = join(temporaryRoot, "workspace-second");
const npxPath = join(binDirectory, "npx");
const invocationLog = join(homeDirectory, "invocations.log");
const projectInventoryState = join(homeDirectory, "project-inventory.json");
const activeChildren = new Set();
const execFileAsync = promisify(execFile);

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
        if (message.error !== undefined)
          pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        this.errors.push(message.params.exceptionDetails.text);
      }
      if (
        message.method === "Runtime.consoleAPICalled" &&
        message.params.type === "error"
      ) {
        this.errors.push(
          message.params.args
            .map(
              (argument) => argument.value ?? argument.description ?? "Error",
            )
            .join(" "),
        );
      }
    });
  }

  static async connect(port, expectedUrl) {
    const listTargets = () =>
      fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
        response.json(),
      );
    const deadline = Date.now() + 30_000;
    let target;
    while (target === undefined && Date.now() < deadline) {
      const targets = await listTargets();
      target = targets.find(
        ({ type, url }) =>
          type === "page" && (expectedUrl === undefined || url === expectedUrl),
      );
      if (target === undefined) {
        await new Promise((resolveRetry) => setTimeout(resolveRetry, 50));
      }
    }
    if (target === undefined)
      throw new Error("Packaged Electron page target is missing.");
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener(
        "error",
        () => rejectOpen(new Error("CDP connection failed.")),
        {
          once: true,
        },
      );
    });
    const page = new CdpPage(socket);
    await Promise.all([page.send("Runtime.enable"), page.send("Page.enable")]);
    return page;
  }

  close() {
    this.socket.close();
  }

  async disconnect() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise((resolveClose, rejectClose) => {
      const timeout = setTimeout(
        () => rejectClose(new Error("CDP connection did not close.")),
        5_000,
      );
      this.socket.addEventListener(
        "close",
        () => {
          clearTimeout(timeout);
          resolveClose();
        },
        { once: true },
      );
      this.socket.close();
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      awaitPromise: true,
      expression,
      returnByValue: true,
    });
    if (response.exceptionDetails !== undefined) {
      throw new Error(
        response.exceptionDetails.exception?.description ??
          response.exceptionDetails.text,
      );
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

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  await new Promise((resolveClose, rejectClose) =>
    server.close((error) =>
      error === undefined ? resolveClose() : rejectClose(error),
    ),
  );
  return port;
}

async function startDisposableSshd() {
  const sshDirectory = join(temporaryRoot, "ssh");
  const userSshDirectory = join(homeDirectory, ".ssh");
  await Promise.all([
    mkdir(sshDirectory, { recursive: true }),
    mkdir(userSshDirectory, { recursive: true }),
  ]);
  const hostKey = join(sshDirectory, "host_ed25519");
  const clientKey = join(sshDirectory, "client_ed25519");
  await execFileAsync("ssh-keygen", [
    "-q",
    "-t",
    "ed25519",
    "-N",
    "",
    "-f",
    hostKey,
  ]);
  await execFileAsync("ssh-keygen", [
    "-q",
    "-t",
    "ed25519",
    "-N",
    "",
    "-f",
    clientKey,
  ]);
  const authorizedKeys = join(sshDirectory, "authorized_keys");
  await writeFile(authorizedKeys, await readFile(`${clientKey}.pub`, "utf8"), {
    mode: 0o600,
  });
  const forceCommand = join(binDirectory, "run-packaged-ssh-command");
  await writeFile(
    forceCommand,
    `#!/bin/sh
export HOME='${homeDirectory}'
export PATH='${binDirectory}${delimiter}${process.env.PATH ?? "/usr/bin:/bin"}'
exec /bin/sh -c "$SSH_ORIGINAL_COMMAND"
`,
    { mode: 0o700 },
  );
  await chmod(forceCommand, 0o700);
  const port = await availablePort();
  const pidFile = join(sshDirectory, "sshd.pid");
  const configuration = join(sshDirectory, "sshd_config");
  await writeFile(
    configuration,
    [
      `Port ${port}`,
      "ListenAddress 127.0.0.1",
      `HostKey ${hostKey}`,
      `PidFile ${pidFile}`,
      `AuthorizedKeysFile ${authorizedKeys}`,
      "PasswordAuthentication no",
      "KbdInteractiveAuthentication no",
      "PubkeyAuthentication yes",
      "StrictModes no",
      "UsePAM no",
      "PrintMotd no",
      "LogLevel ERROR",
      `ForceCommand ${forceCommand}`,
    ].join("\n"),
    "utf8",
  );
  await execFileAsync("/usr/sbin/sshd", ["-t", "-f", configuration]);
  await writeFile(
    join(userSshDirectory, "config"),
    [
      "Host packaged-ssh",
      "  HostName 127.0.0.1",
      `  Port ${port}`,
      `  User ${process.env.USER ?? "cdd"}`,
      `  IdentityFile ${clientKey}`,
      "  IdentitiesOnly yes",
    ].join("\n"),
    { mode: 0o600 },
  );
  await writeFile(
    join(binDirectory, "ssh"),
    `#!/bin/sh
for argument in "$@"; do
  if [ "$argument" = "-F" ]; then
    exec /usr/bin/ssh "$@"
  fi
done
exec /usr/bin/ssh -F '${join(userSshDirectory, "config")}' "$@"
`,
    { mode: 0o700 },
  );
  const daemon = spawn("/usr/sbin/sshd", ["-D", "-e", "-f", configuration], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  activeChildren.add(daemon);
  const errors = [];
  daemon.stderr.on("data", (chunk) => errors.push(chunk));
  await new Promise((resolveReady, rejectReady) => {
    const deadline = setTimeout(
      () =>
        rejectReady(
          new Error("Packaged disposable sshd did not become ready."),
        ),
      10_000,
    );
    const inspect = () => {
      void readFile(pidFile, "utf8").then(
        () => {
          clearTimeout(deadline);
          resolveReady();
        },
        () => setImmediate(inspect),
      );
    };
    daemon.once("exit", (code) => {
      clearTimeout(deadline);
      rejectReady(
        new Error(
          `Packaged disposable sshd exited ${code}: ${Buffer.concat(errors).toString("utf8")}`,
        ),
      );
    });
    inspect();
  });
  return {
    async close() {
      if (daemon.exitCode === null && daemon.signalCode === null) {
        daemon.kill("SIGTERM");
        await new Promise((resolveClose) => daemon.once("close", resolveClose));
      }
      activeChildren.delete(daemon);
    },
    port,
  };
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
  mkdir(secondWorkspace, { recursive: true }),
]);
await writeFile(projectInventoryState, JSON.stringify([projectEntry]), "utf8");

async function writeScript(mode) {
  await writeFile(
    npxPath,
    `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const args = process.argv.slice(2);
appendFileSync(join(process.env.HOME, "invocations.log"), args.join(" ") + "\\n");
if (args.at(-1) === "--version") {
  process.stdout.write("1.5.23\\n");
} else if (${JSON.stringify(mode)} === "failure") {
  process.stderr.write("SECRET_RAW_STDERR");
  process.exitCode = 2;
} else if (args.includes("remove")) {
  const statePath = join(process.env.HOME, "project-inventory.json");
  const current = JSON.parse(readFileSync(statePath, "utf8"));
  const removeIndex = args.indexOf("remove");
  const agentIndex = args.indexOf("--agent");
  const names = args.slice(removeIndex + 1, agentIndex);
  writeFileSync(statePath, JSON.stringify(current.filter(({ name }) => !names.includes(name))));
} else if (args.join(" ").endsWith("list --json")) {
  process.stdout.write(readFileSync(join(process.env.HOME, "project-inventory.json"), "utf8"));
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
          throw new Error(
            `Packaged Electron exited before CDP was ready (${code ?? signal}).`,
          );
        }),
      ]);
      if (next.done)
        throw new Error("DevTools port watcher ended before launch.");
    }
  } finally {
    await changeIterator.return?.();
  }
  const page = await CdpPage.connect(
    port,
    "skills-desktop://workspace/index.html",
  );
  const connectPage = (expectedUrl) => CdpPage.connect(port, expectedUrl);
  return {
    connectPage,
    errors: page.errors,
    page,
    async close() {
      page.close();
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGTERM");
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

let sshServer;
try {
  await writeScript("success");
  sshServer = await startDisposableSshd();
  let first = await launch();
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
    JSON.stringify([
      "cancelInventory",
      "compareTargets",
      "createTarget",
      "deleteTarget",
      "getSnapshot",
      "prepareCollection",
      "prepareComparison",
      "prepareMutation",
      "reconcileMutation",
      "refreshInventory",
      "requestCancellationReview",
      "requestCollectionReview",
      "requestHostTrustReview",
      "requestReview",
      "subscribe",
      "updateTarget",
    ])
  ) {
    throw new Error(
      `Unexpected preload surface: ${rendererBoundary.bridgeKeys.join(", ")}`,
    );
  }
  await first.page.evaluate(`(() => {
    const button = document.querySelector('button[aria-label="Collections"]');
    if (!(button instanceof HTMLButtonElement)) throw new Error("Collections navigation is unavailable.");
    button.click();
  })()`);
  await first.page.waitFor(
    `document.body?.textContent?.includes("Skills Desktop Starter") &&
      document.body?.textContent?.includes("Independent review is pending.") &&
      document.body?.textContent?.includes("435076e78988e1e6ec40d00b0b1d76bdbbc5419a")`,
    "bundled Official Collection evidence",
  );
  const collectionBoundary = await first.page.evaluate(`({
    prepareDisabled: [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Prepare plan"),
    )?.disabled,
    text: document.body.textContent ?? "",
  })`);
  if (
    collectionBoundary.prepareDisabled !== true ||
    !collectionBoundary.text.includes("vercel-labs/skills")
  ) {
    throw new Error(
      "Pending bundled Collection became executable or lost pinned evidence.",
    );
  }
  await first.page.evaluate(`(() => {
    const button = document.querySelector('button[aria-label="Inventory"]');
    if (!(button instanceof HTMLButtonElement)) throw new Error("Inventory navigation is unavailable.");
    button.click();
  })()`);
  console.log("packaged smoke: pending Official Collection inspected");
  if (
    /SECRET_PROJECT_PATH|SECRET_HOME_PATH|SECRET_TOKEN|SECRET_RAW_STDERR/.test(
      rendererBoundary.text,
    )
  ) {
    throw new Error("Sensitive process evidence reached the renderer.");
  }
  const maliciousPayload = await first.page.evaluate(
    `window.skillsDesktop.refreshInventory({ executable: "sh" })`,
  );
  if (
    maliciousPayload.ok ||
    maliciousPayload.error?.code !== "invalid_request"
  ) {
    throw new Error(
      `Malicious preload payload was not rejected: ${JSON.stringify(maliciousPayload)}`,
    );
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
    throw new Error(
      "A renderer subframe received the workspace preload capability.",
    );
  }
  console.log("packaged smoke: hostile payload and subframe rejected");

  const createdSsh = await first.page
    .evaluate(`window.skillsDesktop.createTarget({
    connectionReference: "packaged-ssh",
    harness: "Codex",
    kind: "ssh",
    label: "Packaged SSH",
    workspace: ${JSON.stringify(workspace)},
  })`);
  if (!createdSsh.ok) {
    throw new Error(
      `Packaged SSH Target creation failed: ${JSON.stringify(createdSsh)}`,
    );
  }
  const sshTargetId = await first.page.evaluate(
    `window.skillsDesktop.getSnapshot().then((result) => result.value.targets.find(({ target }) => target.connectionReference === "packaged-ssh")?.target.id)`,
  );
  if (typeof sshTargetId !== "string") {
    throw new Error("Packaged SSH Target identity is unavailable.");
  }
  const untrustedRefresh = await first.page.evaluate(
    `window.skillsDesktop.refreshInventory(${JSON.stringify(sshTargetId)})`,
  );
  if (
    untrustedRefresh.ok ||
    untrustedRefresh.error?.code !== "host_trust_required"
  ) {
    throw new Error(
      `Packaged first-use trust was not required: ${JSON.stringify(untrustedRefresh)}`,
    );
  }
  const requestedHostReview = await first.page.evaluate(
    `window.skillsDesktop.requestHostTrustReview(${JSON.stringify(sshTargetId)})`,
  );
  if (!requestedHostReview.ok) {
    throw new Error(
      `Packaged host review could not open: ${JSON.stringify(requestedHostReview)}`,
    );
  }
  const hostReviewPage = await first.connectPage(
    "skills-desktop://review/index.html",
  );
  await hostReviewPage.waitFor(
    `document.body?.textContent?.includes("Review host key") &&
      document.body?.textContent?.includes("SHA-256 fingerprint")`,
    "packaged host-key Trusted Review",
  );
  await hostReviewPage.evaluate(`(() => {
    const approve = document.querySelector('button[aria-label="Trust host key"]');
    if (!(approve instanceof HTMLButtonElement)) throw new Error("Host trust approval is unavailable.");
    approve.click();
  })()`);
  await hostReviewPage.waitFor(
    `document.body?.textContent?.includes("Host trust confirmed")`,
    "packaged host trust confirmation",
  );
  await hostReviewPage.disconnect();
  await first.page.send("Page.bringToFront");
  const remoteRefresh = await first.page.evaluate(
    `window.skillsDesktop.refreshInventory(${JSON.stringify(sshTargetId)})`,
  );
  if (!remoteRefresh.ok) {
    throw new Error(
      `Packaged SSH refresh failed: ${JSON.stringify(remoteRefresh)}`,
    );
  }
  await first.page.evaluate(`(() => {
    const targets = document.querySelector('button[aria-label="Targets"]');
    if (!(targets instanceof HTMLButtonElement)) throw new Error("Targets navigation is unavailable.");
    targets.click();
  })()`);
  await first.page.waitFor(
    `document.querySelector(".targets-workspace") !== null`,
    "Targets workspace for packaged SSH",
  );
  await first.page.evaluate(`(() => {
    const target = [...document.querySelectorAll(".target-row")].find(
      (candidate) => candidate.textContent?.includes("Packaged SSH"),
    );
    if (!(target instanceof HTMLButtonElement)) throw new Error("Packaged SSH Target is unavailable.");
    target.click();
  })()`);
  await first.page.waitFor(
    `document.querySelector(".header-target")?.textContent?.includes("Packaged SSH") === true &&
      document.body?.textContent?.includes("packaged-project-skill") &&
      document.body?.textContent?.includes("Fresh evidence")`,
    "packaged SSH Inventory",
  );
  const ordinarySshText = await first.page.evaluate("document.body.innerText");
  if (
    ordinarySshText.includes("127.0.0.1") ||
    ordinarySshText.includes("client_ed25519") ||
    ordinarySshText.includes(String(sshServer.port))
  ) {
    throw new Error(
      "Effective SSH identity escaped the packaged workspace boundary.",
    );
  }
  console.log("packaged smoke: SSH trust and remote Inventory verified");
  const sshLaunch = first;
  await sshLaunch.close();
  if (sshLaunch.errors.length > 0) throw new Error(sshLaunch.errors.join("\n"));
  first = await launch();
  await first.page.waitFor(
    `document.body?.textContent?.includes("packaged-project-skill") &&
      document.body?.textContent?.includes("packaged-global-skill") &&
      document.body?.textContent?.includes("Fresh evidence")`,
    "fresh Inventory after packaged SSH restart",
  );
  console.log("packaged smoke: post-SSH restart opened");

  await first.page.evaluate(`(() => {
    const targets = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.getAttribute("aria-label") === "Targets",
    );
    if (!(targets instanceof HTMLButtonElement)) throw new Error("Targets navigation is unavailable.");
    targets.click();
  })()`);
  await first.page.waitFor(
    `document.querySelector(".targets-workspace") !== null`,
    "Targets workspace",
  );
  await first.page.evaluate(`(() => {
    const primary = [...document.querySelectorAll(".target-row")].find(
      (candidate) => candidate.textContent?.includes("This device"),
    );
    if (!(primary instanceof HTMLButtonElement)) throw new Error("Primary Target is unavailable.");
    primary.click();
  })()`);
  await first.page.waitFor(
    `document.querySelector(".header-target")?.textContent?.includes("This device") === true`,
    "primary Target restoration after SSH",
  );
  await first.page.evaluate(`(() => {
    const targets = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.getAttribute("aria-label") === "Targets",
    );
    if (!(targets instanceof HTMLButtonElement)) throw new Error("Targets navigation is unavailable.");
    targets.click();
  })()`);
  await first.page.waitFor(
    `document.querySelector(".targets-workspace") !== null`,
    "Targets workspace after SSH",
  );
  await first.page.evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.includes("New Target"),
    );
    if (!(button instanceof HTMLButtonElement)) throw new Error("New Target is unavailable.");
    button.click();
    const inputFor = (label) => {
      const field = [...document.querySelectorAll("label")].find(
        (candidate) => candidate.textContent?.includes(label),
      )?.querySelector("input");
      if (!(field instanceof HTMLInputElement)) throw new Error(label + " input is unavailable.");
      return field;
    };
    const setInput = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setInput(inputFor("Display label"), "Second local");
    setInput(inputFor("Canonical workspace"), ${JSON.stringify(secondWorkspace)});
  })()`);
  await first.page.waitFor(
    `document.querySelector(".target-editor h2")?.textContent?.includes("Second local") === true`,
    "second Local Target draft",
  );
  await first.page.evaluate(`(() => {
    const save = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.includes("Save Target"),
    );
    if (!(save instanceof HTMLButtonElement)) throw new Error("Save Target is unavailable.");
    save.click();
  })()`);
  await first.page.waitFor(
    `[...document.querySelectorAll(".target-item h2")].some(
      (heading) => heading.textContent?.includes("Second local"),
    )`,
    "created second Local Target",
  );
  await first.page.evaluate(`(() => {
    const target = [...document.querySelectorAll(".target-row")].find(
      (candidate) => candidate.textContent?.includes("Second local"),
    );
    if (!(target instanceof HTMLButtonElement)) throw new Error("Second Local Target is unavailable.");
    target.click();
  })()`);
  await first.page.waitFor(
    `document.querySelector(".header-target")?.textContent?.includes("Second local") === true`,
    "second Local Target selection",
  );
  await first.page.evaluate(`(() => {
    const refresh = document.querySelector('button[aria-label="Refresh inventory"]');
    if (!(refresh instanceof HTMLButtonElement)) throw new Error("Second Target refresh is unavailable.");
    refresh.click();
  })()`);
  await first.page.waitFor(
    `document.querySelector(".header-target")?.textContent?.includes("Second local") === true &&
      document.querySelector(".header-status")?.textContent?.includes("Fresh evidence") === true`,
    "second Local Target Fresh Inventory",
  );
  const invocationsBeforeComparison = (await readFile(invocationLog, "utf8"))
    .trim()
    .split("\n").length;
  await first.page.evaluate(`(() => {
    const comparison = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.getAttribute("aria-label") === "Comparison",
    );
    if (!(comparison instanceof HTMLButtonElement)) throw new Error("Comparison navigation is unavailable.");
    comparison.click();
  })()`);
  await first.page.waitFor(
    `document.querySelector(".comparison-workspace") !== null`,
    "Comparison workspace",
  );
  await first.page.evaluate(`(() => {
    const compare = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === "Compare",
    );
    if (!(compare instanceof HTMLButtonElement)) throw new Error("Compare is unavailable.");
    compare.click();
  })()`);
  await first.page.waitFor(
    `document.querySelector(".comparison-table")?.textContent?.includes("packaged-project-skill") === true &&
      document.querySelector(".comparison-table")?.textContent?.includes("Unknown evidence") === true`,
    "packaged paired Target comparison",
  );
  const invocationsAfterComparison = (await readFile(invocationLog, "utf8"))
    .trim()
    .split("\n").length;
  if (invocationsAfterComparison !== invocationsBeforeComparison) {
    throw new Error("Opening Comparison connected to a Target implicitly.");
  }
  await first.page.evaluate(`(() => {
    const target = [...document.querySelectorAll(".target-row")].find(
      (candidate) => candidate.textContent?.includes("This device"),
    );
    if (!(target instanceof HTMLButtonElement)) throw new Error("Primary Local Target is unavailable.");
    target.click();
  })()`);
  await first.page.waitFor(
    `document.querySelector(".inventory-table")?.textContent?.includes("packaged-project-skill") === true`,
    "primary Local Target inventory",
  );
  console.log("packaged smoke: durable Targets and comparison verified");

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
  if (
    (await first.page.evaluate(
      `document.querySelectorAll('nav[aria-label="Primary"]').length`,
    )) !== 1
  ) {
    throw new Error("Primary navigation semantics are missing.");
  }
  if (
    (await first.page.evaluate(`document.querySelectorAll("table").length`)) !==
    1
  ) {
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
    throw new Error(
      `Compact accessibility contract failed: ${JSON.stringify(compactNavigation)}`,
    );
  }
  console.log("packaged smoke: compact layout inspected");

  await first.page.evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.includes("Prepare removal"),
    );
    if (!(button instanceof HTMLButtonElement)) throw new Error("Prepare removal is unavailable.");
    button.click();
  })()`);
  console.log("packaged smoke: removal preparation requested");
  await first.page.waitFor(
    `document.body?.textContent?.includes("Command Plan") &&
      document.body?.textContent?.includes("remove packaged-project-skill --agent codex --yes")`,
    "prepared removal Command Plan",
  );
  console.log("packaged smoke: removal plan prepared");
  await first.page.evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.includes("Open Trusted Review"),
    );
    if (!(button instanceof HTMLButtonElement)) throw new Error("Trusted Review is unavailable.");
    button.click();
  })()`);
  console.log("packaged smoke: mutation review requested");
  const reviewPage = await first.connectPage(
    "skills-desktop://review/index.html",
  );
  console.log("packaged smoke: mutation review connected");
  await reviewPage.waitFor(
    `document.body?.textContent?.includes("Review removal") &&
      document.body?.textContent?.includes("packaged-project-skill")`,
    "Trusted Review projection",
  );
  const reviewBoundary = await reviewPage.evaluate(`({
    bridgeKeys: Object.keys(window.skillsReview).sort(),
    hasNodeProcess: typeof window.process !== "undefined",
    hasRequire: typeof window.require !== "undefined",
    text: document.body.textContent ?? "",
    url: window.location.href,
  })`);
  if (
    reviewBoundary.hasNodeProcess ||
    reviewBoundary.hasRequire ||
    reviewBoundary.url !== "skills-desktop://review/index.html" ||
    JSON.stringify(reviewBoundary.bridgeKeys) !==
      JSON.stringify(["approve", "getReview", "reject"])
  ) {
    throw new Error(
      `Unexpected review boundary: ${JSON.stringify(reviewBoundary)}`,
    );
  }
  if (
    /SECRET_PROJECT_PATH|SECRET_HOME_PATH|SECRET_TOKEN|SECRET_RAW_STDERR/.test(
      reviewBoundary.text,
    )
  ) {
    throw new Error("Sensitive process evidence reached Trusted Review.");
  }
  await reviewPage.evaluate(`(() => {
    const button = document.querySelector('button[aria-label="Approve mutation"]');
    if (!(button instanceof HTMLButtonElement)) throw new Error("Approval is unavailable.");
    button.click();
  })()`);
  await reviewPage.waitFor(
    `document.body?.textContent?.includes("Mutation started")`,
    "confirmed mutation completion",
  );
  await first.page.waitFor(
    `![...document.querySelectorAll(".inventory-table tbody tr")].some(
        (row) => row.textContent?.includes("packaged-project-skill"),
      ) &&
      [...document.querySelectorAll(".inventory-table tbody tr")].some(
        (row) => row.textContent?.includes("packaged-global-skill"),
      ) &&
      document.body?.textContent?.includes("completed / verified")`,
    "verified mutation postflight",
  );
  reviewPage.close();
  const guardDocument = JSON.parse(
    await readFile(
      join(
        temporaryRoot,
        "config",
        "Skills Desktop",
        "recovery",
        "mutation-guards.json",
      ),
      "utf8",
    ),
  );
  if (guardDocument.guards.length !== 0) {
    throw new Error(
      "Successful postflight did not durably clear the Mutation Guard.",
    );
  }
  console.log("packaged smoke: reviewed mutation and postflight verified");
  await first.close();
  console.log("packaged smoke: first launch closed");
  if (first.errors.length > 0) throw new Error(first.errors.join("\n"));

  await writeScript("failure");
  const second = await launch();
  console.log("packaged smoke: restart opened");
  await second.page.waitFor(
    `!document.body?.textContent?.includes("packaged-project-skill") &&
      document.body?.textContent?.includes("packaged-global-skill") &&
      document.body?.textContent?.includes("Stale after error")`,
    "stale restored Inventory evidence",
  );
  const restoredText = await second.page.evaluate("document.body.innerText");
  if (restoredText.includes("SECRET_RAW_STDERR")) {
    throw new Error(
      "Raw refresh failure reached the restored Inventory shell.",
    );
  }
  await second.close();
  console.log("packaged smoke: stale restart verified");
  if (second.errors.length > 0) throw new Error(second.errors.join("\n"));

  const invocations = (await readFile(invocationLog, "utf8"))
    .trim()
    .split("\n");
  const versionChecks = invocations.filter(
    (line) => line === "--yes skills@1.5.23 --version",
  );
  if (versionChecks.length !== 5) {
    throw new Error(
      `Expected one version check per opened Target Adapter, got ${versionChecks.length}.`,
    );
  }
  const targetDocument = JSON.parse(
    await readFile(
      join(
        temporaryRoot,
        "config",
        "Skills Desktop",
        "recovery",
        "target-definitions.json",
      ),
      "utf8",
    ),
  );
  if (
    targetDocument.schemaVersion !== 3 ||
    targetDocument.targets.length !== 3 ||
    targetDocument.targets
      .filter(({ kind }) => kind === "local")
      .some(({ executionBindingDigest }) => executionBindingDigest !== null) ||
    !targetDocument.targets.some(
      ({ executionBindingDigest, kind }) =>
        kind === "ssh" && /^[a-f0-9]{64}$/.test(executionBindingDigest),
    )
  ) {
    throw new Error("Packaged Target Definitions were not durably restored.");
  }
  if (!invocations.includes("--yes skills@1.5.23 list --json")) {
    throw new Error("Project Inventory invocation is missing.");
  }
  if (!invocations.includes("--yes skills@1.5.23 list --global --json")) {
    throw new Error("Global Inventory invocation is missing.");
  }
  if (
    !invocations.includes(
      "--yes skills@1.5.23 remove packaged-project-skill --agent codex --yes",
    )
  ) {
    throw new Error("Exact reviewed removal invocation is missing.");
  }
} finally {
  await sshServer?.close();
  for (const child of activeChildren) child.kill("SIGKILL");
  await rm(temporaryRoot, { force: true, recursive: true });
}
