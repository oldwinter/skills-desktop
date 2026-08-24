import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CdpDisconnectedError, CdpPage } from "./cdp.mjs";
import {
  createPackagedQaFixture,
  resolvePackagedExecutable,
} from "./fixture.mjs";
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

async function focusNamedButton(page, name) {
  const focused = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) =>
        candidate.getAttribute("aria-label") === ${JSON.stringify(name)} ||
        candidate.textContent?.trim() === ${JSON.stringify(name)},
    );
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.focus();
    return document.activeElement === button;
  })()`);
  if (!focused) throw new Error(`Button could not receive focus: ${name}`);
}

export function reviewActionFocusDiagnostic(state) {
  if (state === undefined) return "focus-state-unavailable";
  if (state.documentFocused !== true) return "workspace-unfocused";
  if (state.targetPresent !== true) return "review-action-missing";
  if (state.targetDisabled === true) return "review-action-disabled";
  return state.targetActive === true ? "unknown" : "review-action-not-active";
}

export function mutationOutcomeFocusDiagnostic(state) {
  if (state === undefined) return "focus-state-unavailable";
  if (state.documentFocused !== true) return "workspace-unfocused";
  if (state.targetPresent !== true) return "mutation-outcome-missing";
  return state.targetActive === true ? "unknown" : "mutation-outcome-not-active";
}

export function createPackagedUiQaScenarioError(
  cause,
  { check = "unknown", diagnostic = "unknown", stage = "unknown" } = {},
) {
  const failure = new Error("Packaged UI QA scenario failed.", { cause });
  failure.name = "PackagedUiQaScenarioError";
  failure.qaCheck = check;
  failure.qaDiagnostic = diagnostic;
  failure.qaStage = stage;
  return failure;
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

async function waitForTargetGone(port, expectedUrl, timeoutMs = 5_000, signal) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) throw new CdpDisconnectedError();
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`Timed out waiting for ${expectedUrl} to close.`);
    }
    let targets;
    try {
      const timeoutSignal = AbortSignal.timeout(Math.min(remaining, 1_000));
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal:
          signal === undefined
            ? timeoutSignal
            : AbortSignal.any([signal, timeoutSignal]),
      });
      if (!response.ok)
        throw new Error(`CDP target list failed: ${response.status}`);
      targets = await response.json();
    } catch {
      if (signal?.aborted) throw new CdpDisconnectedError();
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(50, remaining)),
      );
      continue;
    }
    if (!targets.some(({ url }) => url === expectedUrl)) return;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(50, remaining)),
    );
  }
}

function rendererErrors(workspacePage, reviewPage) {
  return [
    ...workspacePage.errors.map((message) => `workspace: ${message}`),
    ...(reviewPage?.errors ?? []).map((message) => `review: ${message}`),
  ];
}

function appendFailures(prior, failures) {
  if (failures.length === 0) return prior;
  const causes = prior === undefined ? failures : [prior, ...failures];
  return new Error(
    causes
      .map((failure) =>
        failure instanceof Error ? failure.message : String(failure),
      )
      .join("\n"),
    { cause: new AggregateError(causes, "Packaged UI QA failures") },
  );
}

export async function runPackagedUiQa({
  executable = resolvePackagedExecutable(),
  fixture: providedFixture,
  signal,
} = {}) {
  if (providedFixture === undefined && executable === undefined) {
    throw new Error(
      "A fixture-owned root is required to launch packaged Electron.",
    );
  }
  const fixture = providedFixture ?? (await createPackagedQaFixture());
  const ownedFixture = providedFixture === undefined;
  let session;
  let reviewPage;
  const reviewErrors = [];
  let scenarioFailure;
  let failureCheck = "unknown";
  let failureDiagnostic = "unknown";
  let failureStage = "unknown";
  let activeCheck = "executable-launch";
  let activeStage = "launch";
  let result;
  try {
    session = await launchPackagedElectron({ executable, fixture, signal });
    const { page } = session;
    activeCheck = "fixture-inventory";
    await page.waitFor(
      `document.body?.textContent?.includes("qa-project-skill") === true`,
      "fixture inventory",
    );

    activeStage = "keyboard-workflow";
    activeCheck = "primary-navigation-order";
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

    activeCheck = "primary-navigation-activation";
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

    activeStage = "focus-order";
    activeCheck = "focus-visibility";
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

    activeStage = "axe-semantics";
    activeCheck = "workspace-axe";
    const axeSource = await requireAxeSource();
    await scanWithAxe(page, axeSource, "workspace");
    activeCheck = "workspace-semantics";
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
      throw new Error(
        `Screen-reader semantics failed: ${JSON.stringify(semantics)}`,
      );
    }

    activeStage = "narrow-layout";
    activeCheck = "narrow-overflow";
    await page.setViewportSize(420, 820);
    const narrow = await page.evaluate(`({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      chooser: document.querySelector("label.inventory-target-chooser, [aria-label='Target summary']") !== null,
    })`);
    if (
      narrow.documentWidth > narrow.viewportWidth ||
      narrow.chooser !== true
    ) {
      throw new Error(`Narrow layout failed: ${JSON.stringify(narrow)}`);
    }

    activeStage = "reduced-motion";
    activeCheck = "reduced-motion";
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
      throw new Error(
        `Reduced-motion styles failed: ${JSON.stringify(reduced)}`,
      );
    }

    activeStage = "keyboard-workflow";
    activeCheck = "mutation-prepare";
    await clickNamedButton(page, "Prepare removal", { focus: true });
    await page.waitFor(
      `document.body?.textContent?.includes("Open Trusted Review") === true`,
      "prepared mutation review action",
    );
    activeStage = "focus-order";
    activeCheck = "workspace-focus-precondition";
    await page.send("Page.bringToFront");
    await page.waitFor(
      `document.hasFocus() === true`,
      "workspace native focus before opening Trusted Review",
      5_000,
    );
    await focusNamedButton(page, "Open Trusted Review");
    await page.waitFor(
      `document.hasFocus() === true &&
        document.activeElement instanceof HTMLButtonElement &&
        document.activeElement.textContent?.trim() === "Open Trusted Review"`,
      "workspace review opener focus",
      5_000,
    );
    activeStage = "keyboard-workflow";
    activeCheck = "review-open";
    await page.dispatchKey("Enter");
    reviewPage = await CdpPage.connect(
      session.port,
      "skills-desktop://review/index.html",
      {
        connectTimeoutMs: 5_000,
        expectedTitle: "Skills Desktop Trusted Review",
        signal,
      },
    );
    await reviewPage.waitFor(
      `document.body?.textContent?.includes("Trusted Review") === true`,
      "Trusted Review window",
    );
    activeStage = "focus-order";
    activeCheck = "review-focus-order";
    await reviewPage.waitFor(
      `(document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim() ?? "") === "Reject"`,
      "Trusted Review initial focus",
    );
    activeCheck = "review-focus-order";
    const reviewFocus = await reviewPage.evaluate(`(() => {
      const focusable = [...document.querySelectorAll("button")];
      const names = focusable.map((button) =>
        button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "",
      );
      return {
        contained: focusable.every((button) => button.closest("main.review-surface") !== null),
        current:
          document.activeElement?.getAttribute("aria-label") ??
          document.activeElement?.textContent?.trim() ??
          "",
        names,
      };
    })()`);
    if (
      reviewFocus.contained !== true ||
      reviewFocus.current !== "Reject" ||
      JSON.stringify(reviewFocus.names) !==
        JSON.stringify(["Reject", "Approve mutation"])
    ) {
      throw new Error(
        `Review focus containment failed: ${JSON.stringify(reviewFocus)}`,
      );
    }
    await reviewPage.dispatchKey("Tab");
    const reviewAfterTab = await reviewPage.evaluate(
      `document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim() ?? ""`,
    );
    if (reviewAfterTab !== "Approve mutation") {
      throw new Error(`Review tab order failed at ${reviewAfterTab}`);
    }
    await reviewPage.dispatchKey("Tab");
    const reviewAfterWrap = await reviewPage.evaluate(
      `document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim() ?? ""`,
    );
    if (reviewAfterWrap !== "Reject") {
      throw new Error(`Review focus did not wrap at ${reviewAfterWrap}`);
    }
    await reviewPage.dispatchKey("Tab", "Tab", { modifiers: 8 });
    const reviewAfterReverseWrap = await reviewPage.evaluate(
      `document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim() ?? ""`,
    );
    if (reviewAfterReverseWrap !== "Approve mutation") {
      throw new Error(
        `Review reverse focus did not wrap at ${reviewAfterReverseWrap}`,
      );
    }
    activeStage = "axe-semantics";
    activeCheck = "review-axe";
    await scanWithAxe(reviewPage, axeSource, "review");
    reviewErrors.push(...reviewPage.errors);

    activeStage = "keyboard-workflow";
    activeCheck = "review-close";
    await reviewPage.send("Page.close").catch((error) => {
      if (!(error instanceof CdpDisconnectedError)) throw error;
    });
    await waitForTargetGone(
      session.port,
      "skills-desktop://review/index.html",
      5_000,
      signal,
    );
    await reviewPage.disconnect();
    reviewPage = undefined;

    activeStage = "focus-order";
    activeCheck = "workspace-review-focus-restore";
    try {
      await page.waitFor(
        `document.hasFocus() === true &&
          document.activeElement instanceof HTMLButtonElement &&
          !document.activeElement.disabled &&
          document.activeElement.textContent?.trim() === "Open Trusted Review"`,
        "workspace focus restoration after review cancellation",
        5_000,
        { stableMs: 50 },
      );
    } catch (error) {
      const state = await page
        .evaluate(`(() => {
          const action = [...document.querySelectorAll("button")].find(
            (button) => button.textContent?.trim() === "Open Trusted Review",
          );
          return {
            documentFocused: document.hasFocus(),
            targetActive: document.activeElement === action,
            targetDisabled: action instanceof HTMLButtonElement && action.disabled,
            targetPresent: action instanceof HTMLButtonElement,
          };
        })()`)
        .catch(() => undefined);
      failureDiagnostic = reviewActionFocusDiagnostic(state);
      throw error;
    }

    activeStage = "keyboard-workflow";
    activeCheck = "review-open";
    await page.dispatchKey("Enter");
    reviewPage = await CdpPage.connect(
      session.port,
      "skills-desktop://review/index.html",
      {
        connectTimeoutMs: 5_000,
        expectedTitle: "Skills Desktop Trusted Review",
        signal,
      },
    );
    await reviewPage.waitFor(
      `(document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim() ?? "") === "Reject"`,
      "reopened Trusted Review initial focus",
    );
    await reviewPage.dispatchKey("Tab");
    await reviewPage.waitFor(
      `(document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim() ?? "") === "Approve mutation"`,
      "reopened Trusted Review approval focus",
    );

    activeStage = "keyboard-workflow";
    activeCheck = "review-approve";
    await reviewPage.dispatchKey("Enter").catch((error) => {
      if (!(error instanceof CdpDisconnectedError)) throw error;
    });
    activeCheck = "review-settled";
    await reviewPage.waitFor(
      `document.body?.textContent?.includes("Mutation started") === true`,
      "approved review outcome",
    );
    activeCheck = "mutation-postflight";
    await page.waitFor(
      `document.body?.textContent?.includes("completed / verified") === true`,
      "confirmed mutation outcome",
    );
    activeStage = "focus-order";
    activeCheck = "settled-focus";
    const settledFocus = await reviewPage.evaluate(
      `document.activeElement?.getAttribute("aria-label") ?? ""`,
    );
    if (settledFocus !== "Close review") {
      throw new Error(`Settled review focus failed at ${settledFocus}`);
    }
    activeStage = "axe-semantics";
    activeCheck = "settled-axe";
    await scanWithAxe(reviewPage, axeSource, "settled review");
    reviewErrors.push(...reviewPage.errors);
    activeStage = "keyboard-workflow";
    activeCheck = "review-close";
    await reviewPage.dispatchKey("Enter").catch((error) => {
      if (!(error instanceof CdpDisconnectedError)) throw error;
    });
    await waitForTargetGone(
      session.port,
      "skills-desktop://review/index.html",
      5_000,
      signal,
    );
    await reviewPage.disconnect();
    reviewPage = undefined;
    activeCheck = "workspace-outcome-focus-restore";
    try {
      await page.waitFor(
        `document.hasFocus() === true &&
          document.activeElement instanceof HTMLParagraphElement &&
          document.activeElement.classList.contains("mutation-outcome") &&
          document.activeElement.textContent?.trim() === "completed / verified"`,
        "workspace focus restoration",
        5_000,
        { stableMs: 50 },
      );
    } catch (error) {
      const state = await page
        .evaluate(`(() => {
          const outcome = document.querySelector("p.mutation-outcome");
          return {
            documentFocused: document.hasFocus(),
            targetActive: document.activeElement === outcome,
            targetPresent: outcome instanceof HTMLParagraphElement,
          };
        })()`)
        .catch(() => undefined);
      failureDiagnostic = mutationOutcomeFocusDiagnostic(state);
      throw error;
    }

    activeStage = "empty-state";
    activeCheck = "empty-state-render";
    await fixture.setProcessMode("empty");
    await clickNamedButton(page, "Refresh inventory");
    await page.waitFor(
      `document.body?.textContent?.includes("No skills found") === true`,
      "empty inventory",
    );

    activeStage = "error-state";
    activeCheck = "error-state-render";
    await fixture.setProcessMode("failure");
    await clickNamedButton(page, "Refresh inventory");
    await page.waitFor(
      `document.body?.textContent?.includes("本地进程执行失败") === true ||
        document.body?.textContent?.includes("Inventory unavailable") === true`,
      "inventory error",
    );

    const invocations = await fixture.readInvocations();
    activeCheck = "cli-list-invocation";
    if (
      !invocations.some(
        (args) =>
          args[0] === "--yes" &&
          args[1] === "skills@1.5.23" &&
          args.includes("list"),
      )
    ) {
      throw new Error(
        `Fixture CLI invocation was not recorded: ${JSON.stringify(invocations)}`,
      );
    }
    activeCheck = "cli-remove-invocation";
    if (!invocations.some((args) => args.includes("remove"))) {
      throw new Error(
        `Confirmed mutation invocation was not recorded: ${JSON.stringify(invocations)}`,
      );
    }

    result = {
      artifacts: fixture.artifacts,
      scenarios: PACKAGED_UI_QA_SCENARIOS,
      sessionName: session.sessionName,
    };
  } catch (error) {
    scenarioFailure = error;
    failureCheck = activeCheck;
    if (failureDiagnostic === "unknown") {
      failureDiagnostic =
        error !== null && typeof error === "object" && "qaDiagnostic" in error
          ? error.qaDiagnostic
          : "unknown";
    }
    failureStage = activeStage;
  } finally {
    const finalizationFailures = [];
    let finalizationCheck;
    if (reviewPage !== undefined) reviewErrors.push(...reviewPage.errors);
    try {
      await reviewPage?.disconnect();
    } catch (error) {
      finalizationCheck ??= "session-cleanup";
      finalizationFailures.push(
        new Error("Trusted Review CDP cleanup failed.", { cause: error }),
      );
    }
    try {
      await session?.close();
    } catch (error) {
      finalizationCheck ??= "session-cleanup";
      finalizationFailures.push(
        new Error("Packaged Electron cleanup failed.", { cause: error }),
      );
    }
    if (ownedFixture) {
      try {
        await fixture.cleanup();
      } catch (error) {
        finalizationCheck ??= "fixture-cleanup";
        finalizationFailures.push(
          new Error("Packaged UI fixture cleanup failed.", { cause: error }),
        );
      }
    }
    if (session !== undefined) {
      const errors = rendererErrors(session.page, { errors: reviewErrors });
      if (errors.length > 0) {
        if (scenarioFailure === undefined && finalizationFailures.length === 0) {
          failureCheck = "renderer-console";
          failureStage = "console-failures";
        }
        finalizationFailures.push(
          new Error(`Renderer console failures:\n${errors.join("\n")}`),
        );
      }
    }
    if (scenarioFailure === undefined && finalizationFailures.length > 0) {
      failureCheck = finalizationCheck ?? failureCheck;
      failureStage =
        failureStage === "console-failures" ? failureStage : "finalization";
    }
    scenarioFailure = appendFailures(scenarioFailure, finalizationFailures);
  }
  if (scenarioFailure !== undefined) {
    throw createPackagedUiQaScenarioError(scenarioFailure, {
      check: failureCheck,
      diagnostic: failureDiagnostic,
      stage: failureStage,
    });
  }
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
