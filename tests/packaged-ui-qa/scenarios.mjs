import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPackagedQaFixture, resolvePackagedExecutable } from "./fixture.mjs";
import { launchPackagedElectron } from "./launch.mjs";

export const PACKAGED_UI_QA_SCENARIOS = [
  "keyboard-workflow",
  "focus-order",
  "axe-semantics",
  "narrow-layout",
  "reduced-motion",
  "empty-state",
  "error-state",
  "console-failures",
];

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

async function requireAxeSource() {
  const require = createRequire(import.meta.url);
  try {
    return await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
  } catch {
    return undefined;
  }
}

async function clickNamedButton(page, name) {
  const clicked = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) =>
        candidate.getAttribute("aria-label") === ${JSON.stringify(name)} ||
        candidate.textContent?.trim() === ${JSON.stringify(name)},
    );
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Button not found: ${name}`);
}

export async function runPackagedUiQa({
  executable = resolvePackagedExecutable(),
  fixture: providedFixture,
} = {}) {
  if (providedFixture === undefined && executable === undefined) {
    throw new Error("A fixture-owned root is required to launch packaged Electron.");
  }
  const fixture = providedFixture ?? (await createPackagedQaFixture());
  const ownedFixture = providedFixture === undefined;
  let session;
  try {
    session = await launchPackagedElectron({ executable, fixture });
    const { page } = session;
    await page.waitFor(
      `document.body?.textContent?.includes("qa-project-skill") === true`,
      "fixture inventory",
    );

    const keyboard = await page.evaluate(`(() => {
      const nav = document.querySelector('nav[aria-label="Primary"]');
      const first = nav?.querySelector("button");
      first?.focus();
      return {
        current: document.activeElement?.getAttribute("aria-label") ?? "",
        names: [...(nav?.querySelectorAll("button") ?? [])].map((button) =>
          button.getAttribute("aria-label"),
        ),
      };
    })()`);
    if (
      keyboard.current !== "Inventory" ||
      JSON.stringify(keyboard.names) !==
        JSON.stringify([
          "Inventory",
          "Comparison",
          "Collections",
          "Targets",
          "About",
        ])
    ) {
      throw new Error(`Keyboard workflow failed: ${JSON.stringify(keyboard)}`);
    }
    await page.dispatchKey("Tab");
    const afterTab = await page.evaluate(
      `document.activeElement?.getAttribute("aria-label") ?? ""`,
    );
    if (afterTab !== "Comparison") {
      throw new Error(`Tab order failed at ${afterTab}`);
    }

    const focus = await page.evaluate(`(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return { outline: "", visible: false };
      const style = getComputedStyle(active);
      return {
        outline: style.outlineStyle + " " + style.outlineWidth,
        visible:
          style.outlineStyle !== "none" ||
          style.boxShadow !== "none" ||
          active.matches(":focus-visible"),
      };
    })()`);
    if (focus.visible !== true) {
      throw new Error(`Focus visibility failed: ${JSON.stringify(focus)}`);
    }

    const axeSource = await requireAxeSource();
    if (axeSource !== undefined) {
      await page.evaluate(`${axeSource}; true`);
      const axe = await page.evaluate(`(async () => {
        const result = await window.axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
        });
        return result.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          nodes: violation.nodes.length,
        }));
      })()`);
      const blocking = axe.filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      );
      if (blocking.length > 0) {
        throw new Error(`Axe violations: ${JSON.stringify(blocking)}`);
      }
    }
    const semantics = await page.evaluate(`({
      groups: [...document.querySelectorAll('[role="group"]')].map((group) =>
        group.getAttribute("aria-label"),
      ),
      heading: document.querySelector("h1")?.textContent ?? "",
      refresh: document.querySelector('[aria-label="Refresh inventory"]') !== null,
    })`);
    if (
      !semantics.groups.includes("Inventory scope") ||
      semantics.heading !== "Inventory" ||
      semantics.refresh !== true
    ) {
      throw new Error(`Screen-reader semantics failed: ${JSON.stringify(semantics)}`);
    }

    await page.setViewportSize(800, 820);
    const narrow = await page.evaluate(`({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      chooser: document.querySelector("label.inventory-target-chooser, [aria-label='Target summary']") !== null,
    })`);
    if (narrow.documentWidth > narrow.viewportWidth || narrow.chooser !== true) {
      throw new Error(`Narrow layout failed: ${JSON.stringify(narrow)}`);
    }

    await page.setMediaFeature("prefers-reduced-motion", "reduce");
    const reduced = await page.evaluate(
      `window.matchMedia("(prefers-reduced-motion: reduce)").matches`,
    );
    if (reduced !== true) {
      throw new Error("Reduced-motion media feature was not applied.");
    }

    await fixture.setProcessMode("empty");
    await clickNamedButton(page, "Refresh inventory");
    await page.waitFor(
      `document.body?.textContent?.includes("No skills found") === true`,
      "empty inventory",
    );

    await fixture.setProcessMode("failure");
    await clickNamedButton(page, "Refresh inventory");
    await page.waitFor(
      `document.body?.textContent?.includes("本地进程执行失败") === true ||
        document.body?.textContent?.includes("Inventory unavailable") === true`,
      "inventory error",
    );

    if (page.errors.length > 0) {
      throw new Error(`Renderer console failures: ${page.errors.join(" | ")}`);
    }

    return {
      artifacts: fixture.artifacts,
      scenarios: PACKAGED_UI_QA_SCENARIOS,
      sessionName: session.sessionName,
    };
  } finally {
    await session?.close().catch(() => undefined);
    if (ownedFixture) await fixture.cleanup();
  }
}

export function packagedUiQaHelp() {
  return [
    "Packaged UI QA owns an isolated HOME, workspace, recovery, and CDP session.",
    "Setup: npm run package:linux",
    "Run: xvfb-run -a npm run qa:packaged-ui",
    "Combined: npm run qa:packaged-ui:linux",
    "Teardown is automatic; only the fixture root and spawned Electron process are removed.",
    `Repository root: ${repositoryRoot}`,
    `Default artifact dir: <fixture>/artifacts (ephemeral; do not commit)`,
    `Scenarios: ${PACKAGED_UI_QA_SCENARIOS.join(", ")}`,
  ].join("\n");
}
