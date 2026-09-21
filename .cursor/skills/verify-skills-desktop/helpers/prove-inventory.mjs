#!/usr/bin/env node
import { assertInventoryEvidence } from "./prove-checks.mjs";
import { runProof } from "./prove-lib.mjs";
import { QA_PROJECT_SKILL, QA_PROJECT_SOURCE } from "./lib.mjs";

await runProof({
  assertEvidence: assertInventoryEvidence,
  label: "inventory",
  requiredFiles: [
    "01-inventory-loaded.png",
    "02-inventory-selected.png",
    "04-inventory-cleared.json",
    "cleanup.json",
    "fixture-inventory.json",
    "invocations.json",
  ],
  steps: [
    ["drive.mjs", ["screenshot", "01-inventory-loaded.png"]],
    ["drive.mjs", ["state", "01-inventory-loaded"]],
    ["drive.mjs", ["click-skill", QA_PROJECT_SKILL]],
    [
      "drive.mjs",
      [
        "wait",
        `document.querySelector(".inspector h2")?.textContent?.trim() === ${JSON.stringify(QA_PROJECT_SKILL)} && document.body.textContent.includes(${JSON.stringify(QA_PROJECT_SOURCE)})`,
        "project skill evidence",
      ],
    ],
    ["drive.mjs", ["screenshot", "02-inventory-selected.png"]],
    ["drive.mjs", ["fill", "Search inventory", "qa-project"]],
    [
      "drive.mjs",
      [
        "wait",
        `document.body.textContent.includes("1 matching skill") && document.body.textContent.includes("1 shown")`,
        "filtered inventory",
      ],
    ],
    ["drive.mjs", ["screenshot", "03-inventory-filtered.png"]],
    ["drive.mjs", ["click", "Clear inventory search"]],
    [
      "drive.mjs",
      [
        "wait",
        `document.body.textContent.includes("2 skills across project and global scopes")`,
        "cleared inventory filters",
      ],
    ],
    ["drive.mjs", ["screenshot", "04-inventory-cleared.png"]],
    ["drive.mjs", ["invocations"]],
    ["drive.mjs", ["inventory"]],
    ["drive.mjs", ["state", "04-inventory-cleared"]],
  ],
});
