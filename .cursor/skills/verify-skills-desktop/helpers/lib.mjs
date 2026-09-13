#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CdpPage } from "../../../../tests/packaged-ui-qa/cdp.mjs";
import {
  createPackagedQaFixture,
  resolvePackagedExecutable,
} from "../../../../tests/packaged-ui-qa/fixture.mjs";
import { EXPECTED_URL, stopChild } from "../../../../tests/packaged-ui-qa/launch.mjs";

export { CdpPage, createPackagedQaFixture, EXPECTED_URL, resolvePackagedExecutable };

export const REVIEW_URL = "skills-desktop://review/index.html";
export const REVIEW_TITLE = "Skills Desktop Trusted Review";
export const WORKSPACE_TITLE = "Skills Desktop";
export const PINNED_CLI = "1.5.23";
export const PRIMARY_NAV = [
  "Inventory",
  "Comparison",
  "Collections",
  "Targets",
  "About",
];

const helpersDir = dirname(fileURLToPath(import.meta.url));
export const skillRoot = resolve(helpersDir, "..");
export const repositoryRoot = resolve(skillRoot, "../../..");

export function scratchRoot(root = repositoryRoot) {
  return resolve(root, ".scratch", "verify-skills-desktop");
}

export function sessionPath(root = repositoryRoot) {
  return (
    process.env.SKILLS_DESKTOP_VERIFY_SESSION ??
    join(scratchRoot(root), "session.json")
  );
}

export function evidenceRoot(root = repositoryRoot) {
  return (
    process.env.SKILLS_DESKTOP_VERIFY_EVIDENCE ??
    join(scratchRoot(root), "evidence")
  );
}

export async function readSession(root = repositoryRoot) {
  const path = sessionPath(root);
  const raw = await readFile(path, "utf8").catch(() => {
    throw new Error(
      `No verification session at ${path}. Run helpers/launch.mjs first.`,
    );
  });
  const session = JSON.parse(raw);
  if (
    typeof session.pid !== "number" ||
    typeof session.port !== "number" ||
    typeof session.fixtureRoot !== "string" ||
    typeof session.evidenceDir !== "string"
  ) {
    throw new Error(`Verification session is incomplete: ${path}`);
  }
  return { ...session, path };
}

export async function writeSession(session, root = repositoryRoot) {
  const path = sessionPath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
  return path;
}

export async function clearSessionFile(root = repositoryRoot) {
  await rm(sessionPath(root), { force: true });
}

export function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

export async function requirePackagedExecutable() {
  const executable = resolvePackagedExecutable({ root: repositoryRoot });
  await access(executable).catch(() => {
    throw new Error(
      [
        `Packaged Skills Desktop is missing: ${executable}`,
        "Build it with: npm run package:linux",
        "Or set SKILLS_DESKTOP_PACKAGED_EXECUTABLE to an existing binary.",
      ].join("\n"),
    );
  });
  return executable;
}

export function requireDisplay() {
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) return;
  throw new Error(
    [
      "No DISPLAY/WAYLAND_DISPLAY. On a headed desktop this is unexpected.",
      "On CI or a machine without a session, wrap the helper with:",
      "  xvfb-run -a node .cursor/skills/verify-skills-desktop/helpers/launch.mjs",
    ].join("\n"),
  );
}

export async function connectWorkspace(session) {
  if (!processAlive(session.pid)) {
    throw new Error(
      `Packaged Electron PID ${session.pid} is not running. Launch again.`,
    );
  }
  return CdpPage.connect(session.port, EXPECTED_URL, {
    connectTimeoutMs: 10_000,
    expectedTitle: WORKSPACE_TITLE,
  });
}

export async function connectReview(session) {
  return CdpPage.connect(session.port, REVIEW_URL, {
    connectTimeoutMs: 8_000,
    expectedTitle: REVIEW_TITLE,
  });
}

export async function listCdpTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) {
    throw new Error(`CDP target list failed: ${response.status}`);
  }
  return response.json();
}

export async function clickNamedButton(page, name, { focus = false } = {}) {
  const clicked = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) =>
        candidate.getAttribute("aria-label") === ${JSON.stringify(name)} ||
        candidate.textContent?.trim() === ${JSON.stringify(name)},
    );
    if (!(button instanceof HTMLButtonElement)) return { ok: false, disabled: false };
    if (button.disabled) return { ok: false, disabled: true };
    if (${focus ? "true" : "false"}) button.focus();
    button.click();
    return { ok: true, disabled: false };
  })()`);
  if (clicked.disabled) throw new Error(`Button is disabled: ${name}`);
  if (!clicked.ok) throw new Error(`Button not found: ${name}`);
}

export async function clickSkillRow(page, name) {
  const clicked = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll("button.skill-button")].find(
      (candidate) => candidate.textContent?.trim() === ${JSON.stringify(name)},
    );
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Skill row not found: ${name}`);
}

export async function fillLabeledInput(page, label, value) {
  const filled = await page.evaluate(`(() => {
    const labeled = [...document.querySelectorAll("label")].find((candidate) => {
      const span = candidate.querySelector("span");
      return span?.textContent?.trim() === ${JSON.stringify(label)};
    });
    const input =
      labeled?.querySelector("input, textarea, select") ??
      document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)});
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement)) {
      return false;
    }
    const proto = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    descriptor?.set?.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!filled) throw new Error(`Labeled field not found: ${label}`);
}

export async function setToggle(page, name, checked) {
  const result = await page.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(`[aria-label="${name}"]`)});
    if (!(input instanceof HTMLInputElement)) return "missing";
    if (input.checked === ${checked ? "true" : "false"}) return "unchanged";
    input.click();
    return "toggled";
  })()`);
  if (result === "missing") throw new Error(`Toggle not found: ${name}`);
}

export async function workspaceState(page) {
  return page.evaluate(`(() => {
    const nav = document.querySelector('nav[aria-label="Primary"]');
    const current =
      nav?.querySelector('[aria-current="page"]')?.getAttribute("aria-label") ??
      "";
    return {
      currentView: current,
      heading: document.querySelector("h1")?.textContent?.trim() ?? "",
      statusPill:
        document.querySelector(".status-pill")?.textContent?.replace(/\\s+/g, " ").trim() ??
        "",
      subtitle:
        document.querySelector(".page-heading p")?.textContent?.trim() ?? "",
      targetLabel:
        document.querySelector(".header-target span")?.textContent?.trim() ?? "",
      skillNames: [...document.querySelectorAll("button.skill-button")].map(
        (button) => button.textContent?.trim() ?? "",
      ),
      inspectorHeading:
        document.querySelector(".inspector h2")?.textContent?.trim() ?? "",
      banners: [...document.querySelectorAll(".state-banner, .empty-state h2")].map(
        (node) => node.textContent?.replace(/\\s+/g, " ").trim(),
      ),
      cliVersion:
        document.querySelector(".rail-version span")?.textContent?.trim() ?? "",
      title: document.title,
      url: location.href,
    };
  })()`);
}

export async function captureScreenshot(page, filePath) {
  const result = await page.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  if (typeof result?.data !== "string" || result.data.length === 0) {
    throw new Error("CDP did not return a screenshot.");
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, Buffer.from(result.data, "base64"));
  return filePath;
}

export async function writeJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

export async function stopOwnedElectron(pid) {
  if (!processAlive(pid)) return;
  const child = { pid, exitCode: null, signalCode: null, kill() {} };
  const childExit = new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (!processAlive(pid) || Date.now() - started > 8_000) {
        clearInterval(timer);
        resolve({ kind: "exit" });
      }
    }, 25);
  });
  await stopChild(child, childExit);
}

export function maybeXvfb(args) {
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
    return spawn(process.execPath, args, { stdio: "inherit" });
  }
  return spawn("xvfb-run", ["-a", process.execPath, ...args], {
    stdio: "inherit",
  });
}

export function fixtureParent() {
  return process.env.SKILLS_DESKTOP_VERIFY_FIXTURE_PARENT ?? tmpdir();
}
