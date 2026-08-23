import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CdpDisconnectedError, CdpPage } from "./cdp.mjs";
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

export async function requireAxeSource(sourcePath) {
  const require = createRequire(import.meta.url);
  try {
    return await readFile(
      sourcePath ?? require.resolve("axe-core/axe.min.js"),
      "utf8",
    );
  } catch (error) {
    throw new Error("The pinned axe-core dependency could not be loaded.", {
      cause: error,
    });
  }
}

async function clickNamedButton(page, name, { focus = false } = {}) {
  const clicked = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) =>
        candidate.getAttribute("aria-label") === ${JSON.stringify(name)} ||
        candidate.textContent?.trim() === ${JSON.stringify(name)},
    );
    if (!(button instanceof HTMLButtonElement)) return false;
    if (${focus ? "true" : "false"}) button.focus();
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Button not found: ${name}`);
}

async function scanWithAxe(page, axeSource, label) {
  const installed = await page.evaluate(
    `${axeSource}; typeof window.axe?.run === "function"`,
  );
  if (installed !== true) {
    throw new Error(`Axe did not install in the ${label} renderer.`);
  }
  const result = await page.evaluate(`(async () => {
    if (typeof window.axe?.run !== "function") throw new Error("Axe is unavailable.");
    const scan = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    });
    return {
      version: window.axe.version,
      violations: scan.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length,
      })),
    };
  })()`);
  if (typeof result?.version !== "string" || result.version.length === 0) {
    throw new Error(`Axe did not report a version in the ${label} renderer.`);
  }
  const blocking = result.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  if (blocking.length > 0) {
    throw new Error(`Axe violations in ${label}: ${JSON.stringify(blocking)}`);
  }
  return result;
}

async function waitForTargetGone(port, expectedUrl, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`Timed out waiting for ${expectedUrl} to close.`);
    }
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(Math.min(remaining, 1_000)),
    })
      .then((response) => response.json())
      .catch(() => []);
    if (!targets.some(({ url }) => url === expectedUrl)) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(50, remaining)));
  }
}

function rendererErrors(workspacePage, reviewPage) {
  return [
    ...workspacePage.errors.map((message) => `workspace: ${message}`),
    ...(reviewPage?.errors ?? []).map((message) => `review: ${message}`),
  ];
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
  let reviewPage;
  let scenarioFailure;
  let result;
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
    const keyboardOrder = [keyboard.current];
    for (let index = 1; index < keyboard.names.length; index += 1) {
      await page.dispatchKey("Tab");
      keyboardOrder.push(
        await page.evaluate(
          `document.activeElement?.getAttribute("aria-label") ?? ""`,
        ),
      );
    }
    if (JSON.stringify(keyboardOrder) !== JSON.stringify(keyboard.names)) {
      throw new Error(`Tab order failed: ${JSON.stringify(keyboardOrder)}`);
    }

    await page.evaluate(`(() => {
      document.querySelector('button[aria-label="Comparison"]')?.focus();
    })()`);
    await page.dispatchKey("Enter");
    await page.waitFor(
      `document.querySelector('button[aria-label="Comparison"]')?.getAttribute("aria-current") === "page"`,
      "keyboard navigation activation",
    );
    await page.evaluate(`(() => {
      document.querySelector('button[aria-label="Inventory"]')?.focus();
    })()`);
    await page.dispatchKey("Enter");
    await page.waitFor(
      `document.querySelector('button[aria-label="Inventory"]')?.getAttribute("aria-current") === "page"`,
      "return to inventory",
    );
    await page.dispatchKey("Tab");
    const focusTarget = await page.evaluate(
      `document.activeElement?.getAttribute("aria-label") ?? ""`,
    );
    if (focusTarget !== "Comparison") {
      throw new Error(`Focus indicator target was not reached: ${focusTarget}`);
    }

    const focus = await page.evaluate(`(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return { visible: false };
      const style = getComputedStyle(active);
      const rect = active.getBoundingClientRect();
      const outlineWidth = Number.parseFloat(style.outlineWidth);
      return {
        boxShadow: style.boxShadow,
        outline: style.outlineStyle + " " + style.outlineWidth,
        visible: rect.width > 0 && rect.height > 0 &&
          ((style.outlineStyle !== "none" && outlineWidth > 0) ||
            style.boxShadow !== "none"),
      };
    })()`);
    if (focus.visible !== true) {
      throw new Error(`Focus visibility failed: ${JSON.stringify(focus)}`);
    }

    const axeSource = await requireAxeSource();
    await scanWithAxe(page, axeSource, "workspace");
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
    const reduced = await page.evaluate(`(() => {
      const durationMs = (value) => Math.max(...value.split(",").map((part) => {
        const number = Number.parseFloat(part);
        return part.trim().endsWith("s") ? number * 1_000 : number;
      }));
      const offenders = [];
      let animationMs = 0;
      let transitionMs = 0;
      for (const element of document.querySelectorAll("*")) {
        const style = getComputedStyle(element);
        const animationDuration = durationMs(style.animationDuration);
        const transitionDuration = durationMs(style.transitionDuration);
        animationMs = Math.max(animationMs, animationDuration);
        transitionMs = Math.max(transitionMs, transitionDuration);
        if (animationDuration > 0.01 || transitionDuration > 0.01) {
          offenders.push(element.tagName.toLowerCase());
        }
      }
      return {
        animationMs,
        matches: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        offenders,
        scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
        transitionMs,
      };
    })()`);
    if (
      reduced.matches !== true ||
      reduced.animationMs > 0.01 ||
      reduced.transitionMs > 0.01 ||
      reduced.scrollBehavior !== "auto" ||
      reduced.offenders.length > 0
    ) {
      throw new Error(`Reduced-motion styles failed: ${JSON.stringify(reduced)}`);
    }

    await clickNamedButton(page, "Prepare update", { focus: true });
    await page.waitFor(
      `document.body?.textContent?.includes("Open Trusted Review") === true`,
      "prepared mutation review action",
    );
    await clickNamedButton(page, "Open Trusted Review", { focus: true });
    reviewPage = await CdpPage.connect(
      session.port,
      "skills-desktop://review/index.html",
      { connectTimeoutMs: 5_000 },
    );
    await reviewPage.waitFor(
      `document.body?.textContent?.includes("Trusted Review") === true`,
      "Trusted Review window",
    );
    const reviewFocus = await reviewPage.evaluate(`(() => {
      const focusable = [...document.querySelectorAll("button")];
      const names = focusable.map((button) =>
        button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "",
      );
      focusable[0]?.focus();
      return {
        contained: focusable.every((button) => button.closest("main.review-surface") !== null),
        names,
      };
    })()`);
    if (
      reviewFocus.contained !== true ||
      JSON.stringify(reviewFocus.names) !==
        JSON.stringify(["Reject", "Approve mutation"])
    ) {
      throw new Error(`Review focus containment failed: ${JSON.stringify(reviewFocus)}`);
    }
    await reviewPage.dispatchKey("Tab");
    const reviewAfterTab = await reviewPage.evaluate(
      `document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim() ?? ""`,
    );
    if (reviewAfterTab !== "Approve mutation") {
      throw new Error(`Review tab order failed at ${reviewAfterTab}`);
    }
    await scanWithAxe(reviewPage, axeSource, "review");
    await reviewPage.evaluate(`(() => {
      document.querySelector("button.review-button")?.focus();
    })()`);
    await reviewPage.dispatchKey("Enter").catch((error) => {
      if (!(error instanceof CdpDisconnectedError)) throw error;
    });
    await waitForTargetGone(session.port, "skills-desktop://review/index.html");
    const restored = await page.evaluate(
      `document.activeElement?.textContent?.includes("Open Trusted Review") === true`,
    );
    if (restored !== true) {
      throw new Error("Workspace focus was not restored after Trusted Review closed.");
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

    const invocations = await fixture.readInvocations();
    if (
      !invocations.some(
        (args) =>
          args[0] === "--yes" &&
          args[1] === "skills@1.5.23" &&
          args.includes("list"),
      )
    ) {
      throw new Error(`Fixture CLI invocation was not recorded: ${JSON.stringify(invocations)}`);
    }

    result = {
      artifacts: fixture.artifacts,
      scenarios: PACKAGED_UI_QA_SCENARIOS,
      sessionName: session.sessionName,
    };
  } catch (error) {
    scenarioFailure = error;
  } finally {
    const reviewErrors = reviewPage?.errors ?? [];
    await reviewPage?.disconnect().catch(() => undefined);
    await session?.close().catch(() => undefined);
    if (ownedFixture) await fixture.cleanup();
    if (session !== undefined) {
      const errors = rendererErrors(session.page, { errors: reviewErrors });
      if (errors.length > 0) {
        const consoleFailure = `Renderer console failures:\n${errors.join("\n")}`;
        const prior =
          scenarioFailure instanceof Error
            ? scenarioFailure.message
            : scenarioFailure === undefined
              ? ""
              : String(scenarioFailure);
        scenarioFailure = new Error(
          prior === "" ? consoleFailure : `${prior}\n${consoleFailure}`,
          { cause: scenarioFailure },
        );
      }
    }
  }
  if (scenarioFailure !== undefined) throw scenarioFailure;
  return result;
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
