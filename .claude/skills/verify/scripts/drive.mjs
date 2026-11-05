#!/usr/bin/env node
// Drive one mapped Skills Desktop feature in an isolated packaged Electron
// instance and keep the proof under .claude/skills/verify/evidence/<run-id>/.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CdpPage } from "../../../../tests/packaged-ui-qa/cdp.mjs";
import {
  createPackagedQaFixture,
  resolvePackagedExecutable,
} from "../../../../tests/packaged-ui-qa/fixture.mjs";
import { launchPackagedElectron } from "../../../../tests/packaged-ui-qa/launch.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const evidenceRoot = join(
  repositoryRoot,
  ".claude",
  "skills",
  "verify",
  "evidence",
);

const featureIndex = process.argv.indexOf("--feature");
const feature = featureIndex === -1 ? "inventory" : process.argv[featureIndex + 1];
if (!["inventory", "review", "views"].includes(feature)) {
  console.error("usage: drive.mjs [--feature inventory|review|views]");
  process.exit(2);
}
const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${feature}`;
const evidence = join(evidenceRoot, runId);
mkdirSync(evidence, { recursive: true });

const results = [];
function record(step, value) {
  results.push({ step, value });
  console.log(`${step}: ${JSON.stringify(value)}`);
}

function screenshot(page, name) {
  return page
    .send("Page.captureScreenshot", { format: "png" })
    .then(({ data }) => {
      writeFileSync(join(evidence, `${name}.png`), Buffer.from(data, "base64"));
    });
}

function clickButton(page, name, { focus = false } = {}) {
  return page.evaluate(`(() => {
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
}

async function reviewTargetPresent(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await response.json();
  return targets.some(({ url }) => url === "skills-desktop://review/index.html");
}

async function driveInventory(page) {
  const structure = await page.evaluate(`(() => ({
    title: document.title,
    heading: document.querySelector("h1")?.textContent?.trim() ?? "",
    nav: [...document.querySelectorAll('nav[aria-label="Primary"] button')].map(
      (button) => button.getAttribute("aria-label"),
    ),
    skills: [...document.querySelectorAll("tbody tr")].length,
    targets: document.querySelector('[aria-label="Target summary"]')?.textContent?.trim() ?? "",
  }))()`);
  record("inventory-structure", structure);
  if (
    structure.title !== "Skills Desktop" ||
    structure.heading !== "Inventory" ||
    JSON.stringify(structure.nav) !==
      JSON.stringify(["Inventory", "Comparison", "Collections", "Targets", "About"]) ||
    structure.skills < 2
  ) {
    throw new Error(`inventory structure drifted: ${JSON.stringify(structure)}`);
  }
  await screenshot(page, "01-inventory");

  await page.evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Search inventory"]');
    if (!(input instanceof HTMLInputElement)) return false;
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, "qa-global-skill");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await page.waitFor(
    `document.body?.textContent?.includes("1 shown") === true`,
    "inventory search filter",
  );
  const filtered = await page.evaluate(
    `[...document.querySelectorAll("tbody tr")].map((row) => row.textContent?.trim().split("\\n")[0])`,
  );
  record("inventory-search", filtered);
  await screenshot(page, "02-inventory-search");

  await clickButton(page, "Clear inventory search", { focus: true });
  await page.waitFor(
    `document.body?.textContent?.includes("2 shown") === true`,
    "inventory search cleared",
  );
  record("inventory-reset", { shown: 2 });
}

async function driveViews(page) {
  const views = [
    {
      name: "Comparison",
      assert: (state) =>
        state.text.includes("Needs a second Local Target") &&
        state.pairedTargets === true &&
        state.headingLevels.includes("Comparison"),
    },
    {
      name: "Collections",
      assert: (state) =>
        state.text.includes("Official Collections") &&
        state.text.includes("1 bundled releases") &&
        state.text.includes("find-skills"),
    },
    {
      name: "Targets",
      assert: (state) =>
        state.text.includes("1 Target Definitions") &&
        state.editor === true &&
        state.sshDisabled === true,
    },
    {
      name: "About",
      assert: (state) => state.headingLevels.includes("About"),
    },
    {
      name: "Inventory",
      assert: (state) => state.text.includes("2 skills across project and global scopes"),
    },
  ];
  for (const [index, view] of views.entries()) {
    const clicked = await page.evaluate(`(() => {
      const button = document.querySelector(
        'nav[aria-label="Primary"] button[aria-label=${JSON.stringify(view.name)}]',
      );
      if (!(button instanceof HTMLButtonElement)) return false;
      button.focus();
      button.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`nav button missing: ${view.name}`);
    await page.waitFor(
      `document.querySelector('nav[aria-label="Primary"] button[aria-label=${JSON.stringify(view.name)}]')?.getAttribute("aria-current") === "page"`,
      `${view.name} view`,
    );
    const state = await page.evaluate(`(() => ({
      headingLevels: [...document.querySelectorAll("h1,h2")].map(
        (heading) => heading.textContent?.trim() ?? "",
      ),
      pairedTargets: document.querySelector('[aria-label="Paired Targets"]') !== null,
      editor: document.querySelector('[aria-label="Target Definition editor"]') !== null,
      sshDisabled: [...document.querySelectorAll('[aria-label="SSH 未开放"]')].every(
        (node) =>
          node.getAttribute("aria-disabled") === "true" ||
          node.hasAttribute("disabled"),
      ),
      text: document.body.innerText,
      title: document.title,
    }))()`);
    record(`view-${view.name.toLowerCase()}`, {
      headings: state.headingLevels,
      sshDisabled: state.sshDisabled,
      title: state.title,
    });
    if (!view.assert(state)) {
      throw new Error(`${view.name} view drifted: ${JSON.stringify(state.headingLevels)}`);
    }
    await screenshot(page, `${String(index + 1).padStart(2, "0")}-${view.name.toLowerCase()}`);
  }
}

async function driveReview(session) {
  const { page, port } = session;
  await clickButton(page, "Prepare removal", { focus: true });
  await page.waitFor(
    `document.body?.textContent?.includes("Open Trusted Review") === true`,
    "prepared mutation review action",
  );
  record("prepare-removal", { reviewAction: true });
  await screenshot(page, "01-prepare-removal");

  await page.evaluate(`document.querySelector("button")?.blur()`);
  await page.evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === "Open Trusted Review",
    );
    button?.focus();
    button?.click();
    return button !== undefined;
  })()`);
  const reviewPage = await CdpPage.connect(port, "skills-desktop://review/index.html", {
    connectTimeoutMs: 5_000,
    expectedTitle: "Skills Desktop Trusted Review",
  });
  try {
    await reviewPage.waitFor(
      `document.body?.textContent?.includes("Trusted Review") === true`,
      "Trusted Review window",
    );
    const review = await reviewPage.evaluate(`(() => ({
      title: document.title,
      focus:
        document.activeElement?.getAttribute("aria-label") ??
        document.activeElement?.textContent?.trim() ??
        "",
      buttons: [...document.querySelectorAll("button")].map(
        (button) =>
          button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "",
      ),
    }))()`);
    record("review-window", review);
    if (review.title !== "Skills Desktop Trusted Review" || review.focus !== "Reject") {
      throw new Error(`review window drifted: ${JSON.stringify(review)}`);
    }
    await screenshot(reviewPage, "02-trusted-review");
  } finally {
    await clickButton(reviewPage, "Reject").catch(() => {});
    await reviewPage.waitFor(
      `document.body?.textContent?.includes("Trusted Review") !== true`,
      "Trusted Review closed",
      5_000,
    ).catch(() => {});
    await reviewPage.disconnect().catch(() => {});
  }
  const closed = !(await reviewTargetPresent(port));
  record("review-rejected", { targetClosed: closed });
  if (!closed) throw new Error("review window stayed open after Reject");
}

const executable = resolvePackagedExecutable();
const fixture = await createPackagedQaFixture();
let session;
let failure;
try {
  session = await launchPackagedElectron({ executable, fixture });
  const { page } = session;
  await page.waitFor(
    `document.body?.textContent?.includes("qa-project-skill") === true`,
    "fixture inventory",
  );
  if (feature === "inventory") await driveInventory(page);
  else if (feature === "views") await driveViews(page);
  else await driveReview(session);
  writeFileSync(
    join(evidence, "drive.json"),
    `${JSON.stringify(
      {
        feature,
        executable,
        fixtureRoot: fixture.root,
        ok: true,
        runId,
        steps: results,
      },
      null,
      2,
    )}\n`,
  );
  console.log(JSON.stringify({ feature, ok: true, evidence }, null, 2));
} catch (error) {
  failure = error;
  writeFileSync(
    join(evidence, "drive.json"),
    `${JSON.stringify(
      {
        feature,
        executable,
        fixtureRoot: fixture.root,
        ok: false,
        error: String(error?.message ?? error),
        runId,
        steps: results,
      },
      null,
      2,
    )}\n`,
  );
  throw error;
} finally {
  await session?.close().catch(() => {});
  await fixture.cleanup();
  if (failure === undefined) console.log(`evidence: ${evidence}`);
}
