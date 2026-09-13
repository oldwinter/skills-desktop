#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  captureScreenshot,
  clickNamedButton,
  clickSkillRow,
  connectReview,
  connectWorkspace,
  fillLabeledInput,
  PRIMARY_NAV,
  readSession,
  setToggle,
  workspaceState,
  writeJson,
} from "./lib.mjs";

function usage() {
  return [
    "Drive the launched Skills Desktop session over CDP.",
    "",
    "Usage:",
    "  node helpers/drive.mjs nav <Inventory|Comparison|Collections|Targets|About>",
    "  node helpers/drive.mjs click <button name>",
    "  node helpers/drive.mjs click-skill <skill name>",
    "  node helpers/drive.mjs fill <visible label> <value>",
    "  node helpers/drive.mjs toggle <aria-label> <true|false>",
    "  node helpers/drive.mjs wait <js-expression> <label>",
    "  node helpers/drive.mjs eval <js-expression>",
    "  node helpers/drive.mjs state [json-name]",
    "  node helpers/drive.mjs screenshot <png-name>",
    "  node helpers/drive.mjs invocations",
    "  node helpers/drive.mjs inventory",
    "  node helpers/drive.mjs set-mode <success|empty|failure>",
    "  node helpers/drive.mjs review-wait [label]",
    "  node helpers/drive.mjs review-click <Reject|Approve mutation|Close review>",
    "  node helpers/drive.mjs review-screenshot <png-name>",
    "",
  ].join("\n");
}

const [command, ...rest] = process.argv.slice(2);
if (command === undefined || command === "--help" || command === "-h") {
  process.stdout.write(usage());
  process.exit(command === undefined ? 2 : 0);
}

const session = await readSession();

async function withWorkspace(fn) {
  const page = await connectWorkspace(session);
  try {
    return await fn(page);
  } finally {
    await page.disconnect();
  }
}

async function withReview(fn) {
  const page = await connectReview(session);
  try {
    return await fn(page);
  } finally {
    await page.disconnect();
  }
}

try {
  if (command === "nav") {
    const name = rest[0];
    if (!PRIMARY_NAV.includes(name)) {
      throw new Error(`Unknown view: ${name}. Use ${PRIMARY_NAV.join(", ")}.`);
    }
    await withWorkspace(async (page) => {
      await clickNamedButton(page, name);
      await page.waitFor(
        `document.querySelector(${JSON.stringify(`button[aria-label="${name}"]`)})?.getAttribute("aria-current") === "page" && document.querySelector("h1") !== null`,
        `${name} view`,
      );
    });
    process.stdout.write(`navigated ${name}\n`);
  } else if (command === "click") {
    const name = rest.join(" ").trim();
    if (name.length === 0) throw new Error("click requires a button name.");
    await withWorkspace((page) => clickNamedButton(page, name));
    process.stdout.write(`clicked ${name}\n`);
  } else if (command === "click-skill") {
    const name = rest.join(" ").trim();
    if (name.length === 0) throw new Error("click-skill requires a skill name.");
    await withWorkspace(async (page) => {
      await clickSkillRow(page, name);
      await page.waitFor(
        `document.querySelector(".inspector h2")?.textContent?.trim() === ${JSON.stringify(name)}`,
        `inspector for ${name}`,
      );
    });
    process.stdout.write(`selected ${name}\n`);
  } else if (command === "fill") {
    const label = rest[0];
    const value = rest.slice(1).join(" ");
    if (!label) throw new Error("fill requires a visible label and a value.");
    await withWorkspace((page) => fillLabeledInput(page, label, value));
    process.stdout.write(`filled ${label}\n`);
  } else if (command === "toggle") {
    const name = rest[0];
    const checked = rest[1] === "true";
    if (!name) throw new Error("toggle requires an aria-label and true|false.");
    await withWorkspace((page) => setToggle(page, name, checked));
    process.stdout.write(`toggled ${name} ${checked}\n`);
  } else if (command === "wait") {
    const expression = rest[0];
    const label = rest.slice(1).join(" ") || "condition";
    if (!expression) throw new Error("wait requires a JS expression.");
    await withWorkspace((page) => page.waitFor(expression, label));
    process.stdout.write(`waited ${label}\n`);
  } else if (command === "eval") {
    const expression = rest.join(" ");
    if (!expression) throw new Error("eval requires a JS expression.");
    const value = await withWorkspace((page) => page.evaluate(expression));
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else if (command === "state") {
    const state = await withWorkspace((page) => workspaceState(page));
    const name = rest[0] ?? "workspace-state";
    const path = await writeJson(
      join(session.evidenceDir, `${name.replace(/\.json$/, "")}.json`),
      state,
    );
    process.stdout.write(`${JSON.stringify({ path, state }, null, 2)}\n`);
  } else if (command === "screenshot") {
    const name = rest[0];
    if (!name) throw new Error("screenshot requires a file name.");
    const filePath = join(
      session.evidenceDir,
      name.endsWith(".png") ? name : `${name}.png`,
    );
    await withWorkspace((page) => captureScreenshot(page, filePath));
    process.stdout.write(`${filePath}\n`);
  } else if (command === "invocations") {
    const value = await readFile(session.invocationLog, "utf8");
    const invocations =
      value.trim() === ""
        ? []
        : value
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
    const path = await writeJson(
      join(session.evidenceDir, "invocations.json"),
      invocations,
    );
    process.stdout.write(`${JSON.stringify({ invocations, path }, null, 2)}\n`);
  } else if (command === "inventory") {
    const inventory = JSON.parse(await readFile(session.inventoryPath, "utf8"));
    const path = await writeJson(
      join(session.evidenceDir, "fixture-inventory.json"),
      inventory,
    );
    process.stdout.write(`${JSON.stringify({ inventory, path }, null, 2)}\n`);
  } else if (command === "set-mode") {
    const mode = rest[0];
    if (mode !== "success" && mode !== "empty" && mode !== "failure") {
      throw new Error("set-mode requires success, empty, or failure.");
    }
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(session.home, "process-mode"), mode);
    process.stdout.write(`process-mode ${mode}\n`);
  } else if (command === "review-wait") {
    const label = rest.join(" ") || "Trusted Review window";
    await withReview((page) =>
      page.waitFor(
        `document.body?.textContent?.includes("Trusted Review") === true`,
        label,
      ),
    );
    process.stdout.write("review ready\n");
  } else if (command === "review-click") {
    const name = rest.join(" ").trim();
    if (name.length === 0) throw new Error("review-click requires a button name.");
    await withReview((page) => clickNamedButton(page, name));
    process.stdout.write(`review clicked ${name}\n`);
  } else if (command === "review-screenshot") {
    const name = rest[0];
    if (!name) throw new Error("review-screenshot requires a file name.");
    const filePath = join(
      session.evidenceDir,
      name.endsWith(".png") ? name : `${name}.png`,
    );
    await withReview((page) => captureScreenshot(page, filePath));
    process.stdout.write(`${filePath}\n`);
  } else {
    throw new Error(`Unknown command: ${command}\n${usage()}`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
}
