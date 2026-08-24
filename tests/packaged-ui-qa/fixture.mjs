import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CLI_VERSION = "1.5.23";
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function packageRootCandidate(root, platform, arch) {
  const directory = join(
    root,
    "apps",
    "desktop",
    "out",
    `Skills Desktop-${platform}-${arch}`,
  );
  if (platform === "darwin") {
    return join(
      directory,
      "Skills Desktop.app",
      "Contents",
      "MacOS",
      "skills-desktop",
    );
  }
  return join(directory, `skills-desktop${platform === "win32" ? ".exe" : ""}`);
}

export function resolvePackagedExecutable({
  root = repositoryRoot,
  platform = process.platform,
  arch = process.arch,
  override = process.env.SKILLS_DESKTOP_PACKAGED_EXECUTABLE,
} = {}) {
  return override ?? packageRootCandidate(root, platform, arch);
}

export function assertRuntimeArchitecture(
  expected = process.env.SKILLS_DESKTOP_QA_ARCH,
) {
  if (expected === undefined || expected === "") return process.arch;
  if (expected !== "x64" && expected !== "arm64") {
    throw new Error(`Unsupported packaged QA architecture: ${expected}`);
  }
  if (process.arch !== expected) {
    throw new Error(
      `Packaged QA runtime architecture mismatch: expected ${expected}, got ${process.arch}.`,
    );
  }
  return process.arch;
}

const projectEntry = (workspace) => ({
  agents: ["Codex"],
  name: "qa-project-skill",
  path: join(workspace, ".agents", "skills", "qa-project-skill"),
  scope: "project",
  source: "example/skills-desktop-qa",
  sourceType: "github",
  sourceUrl: "https://example.test/skills-desktop-qa.git",
});

const globalEntry = (home) => ({
  agents: ["Codex"],
  name: "qa-global-skill",
  path: join(home, ".agents", "skills", "qa-global-skill"),
  scope: "global",
  source: null,
  sourceType: null,
  sourceUrl: null,
});

export async function createPackagedQaFixture({
  root: requestedRoot,
  platform = process.platform,
} = {}) {
  const parentRoot = requestedRoot ?? tmpdir();
  await mkdir(parentRoot, { recursive: true });
  const root = await mkdtemp(join(parentRoot, "skills-desktop-ui-qa-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const config = join(root, "config");
  const cache = join(root, "cache");
  const temporary = join(root, "tmp");
  const bin = join(root, "bin");
  const artifacts = join(root, "artifacts");
  const userData = join(config, "Skills Desktop");
  const recovery = join(userData, "recovery");
  const inventoryPath = join(home, "inventory.json");
  const modePath = join(home, "process-mode");
  const invocationLog = join(home, "invocations.log");
  await Promise.all(
    [
      home,
      workspace,
      config,
      cache,
      temporary,
      bin,
      artifacts,
      recovery,
      userData,
      ...(platform === "win32"
        ? [join(config, "Roaming"), join(config, "Local")]
        : []),
    ].map((path) => mkdir(path, { recursive: true })),
  );
  await writeFile(
    inventoryPath,
    JSON.stringify({
      global: [globalEntry(home)],
      project: [projectEntry(workspace)],
    }),
  );
  await writeFile(modePath, "success");
  await writeFile(invocationLog, "");

  const npxScript = join(bin, platform === "win32" ? "npx.cmd" : "npx");
  const npxProgram = join(bin, "qa-npx.cjs");
  const windowsNode = join(bin, "node.exe");
  const windowsNpxCli = join(bin, "node_modules", "npm", "bin", "npx-cli.js");
  const windowsNpm = join(bin, "npm.cmd");
  const qaNpxSource = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const home = process.env.HOME || process.env.USERPROFILE;
const statePath = path.join(home, "inventory.json");
const mode = fs.readFileSync(path.join(home, "process-mode"), "utf8").trim();
fs.appendFileSync(path.join(home, "invocations.log"), JSON.stringify(args) + "\\n");
if (args.at(-1) === "--version") {
  process.stdout.write(${JSON.stringify(CLI_VERSION)} + "\\n");
} else if (mode === "failure") {
  process.stderr.write("QA_STUB_FAILURE");
  process.exitCode = 2;
} else if (args.includes("list") && args.includes("--global")) {
  process.stdout.write(mode === "empty" ? "[]" : JSON.stringify(JSON.parse(fs.readFileSync(statePath, "utf8")).global));
} else if (args.includes("list")) {
  process.stdout.write(mode === "empty" ? "[]" : JSON.stringify(JSON.parse(fs.readFileSync(statePath, "utf8")).project));
} else if (args.includes("remove")) {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const name = args[args.indexOf("remove") + 1];
  const scope = args.includes("--global") ? "global" : "project";
  state[scope] = state[scope].filter((entry) => entry.name !== name);
  fs.writeFileSync(statePath, JSON.stringify(state));
  process.stdout.write("");
} else if (args.includes("update")) {
  process.stdout.write("");
} else {
  process.exitCode = 2;
}
`;
  await writeFile(npxProgram, qaNpxSource, { mode: 0o700 });
  if (platform === "win32") {
    await mkdir(dirname(windowsNpxCli), { recursive: true });
    await copyFile(process.execPath, windowsNode);
    await writeFile(windowsNpxCli, qaNpxSource);
    await writeFile(
      npxScript,
      `@echo off\r\n"%~dp0node.exe" "%~dp0node_modules\\npm\\bin\\npx-cli.js" %*\r\n`,
    );
    await writeFile(
      windowsNpm,
      `@echo off\r\n"%~dp0node.exe" "%~dp0node_modules\\npm\\bin\\npx-cli.js" %*\r\n`,
    );
  } else {
    await writeFile(npxScript, `#!/bin/sh\nexec node "${npxProgram}" "$@"\n`, {
      mode: 0o700,
    });
  }
  await chmod(npxProgram, 0o700).catch(() => undefined);
  await chmod(npxScript, 0o700).catch(() => undefined);

  const inherited = Object.fromEntries(
    [
      "DISPLAY",
      "WAYLAND_DISPLAY",
      "XAUTHORITY",
      "USER",
      "USERNAME",
      "SystemRoot",
      "ComSpec",
      "PATHEXT",
    ].flatMap((name) => (process.env[name] ? [[name, process.env[name]]] : [])),
  );
  const environment = {
    ...inherited,
    HOME: home,
    NPM_CONFIG_CACHE: cache,
    PATH: `${bin}${platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
    SKILLS_DESKTOP_WORKSPACE: workspace,
    TMPDIR: temporary,
    XDG_CACHE_HOME: cache,
    XDG_CONFIG_HOME: config,
    ...(platform === "win32"
      ? {
          APPDATA: join(config, "Roaming"),
          LOCALAPPDATA: join(config, "Local"),
          TEMP: temporary,
          TMP: temporary,
          USERPROFILE: home,
        }
      : {}),
  };
  let cleaned = false;
  return {
    artifacts,
    bin,
    cache,
    config,
    environment,
    home,
    invocationLog,
    inventoryPath,
    recovery,
    root,
    temporary,
    userData,
    workspace,
    async readInventory() {
      return JSON.parse(await readFile(inventoryPath, "utf8"));
    },
    async readInvocations() {
      const value = await readFile(invocationLog, "utf8");
      return value.trim() === ""
        ? []
        : value
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
    },
    async readProcessMode() {
      return (await readFile(modePath, "utf8")).trim();
    },
    async setProcessMode(mode) {
      if (mode !== "success" && mode !== "failure" && mode !== "empty") {
        throw new Error(`Unsupported fixture mode: ${mode}`);
      }
      await writeFile(modePath, mode);
    },
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      await rm(root, { force: true, recursive: true });
    },
  };
}
