import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  PINNED_CLI,
  QA_GLOBAL_SKILL,
  QA_PROJECT_SKILL,
  QA_PROJECT_SOURCE,
} from "./lib.mjs";

async function readEvidenceJson(evidenceDir, name) {
  try {
    return JSON.parse(await readFile(join(evidenceDir, name), "utf8"));
  } catch {
    throw new Error(`Evidence file unreadable: ${name}`);
  }
}

export function hasPinnedListInvocation(
  invocations,
  cliVersion = PINNED_CLI,
) {
  if (!Array.isArray(invocations)) return false;
  return invocations.some(
    (args) =>
      Array.isArray(args) &&
      args.includes("list") &&
      args.includes(`skills@${cliVersion}`),
  );
}

export async function assertInventoryEvidence(evidenceDir) {
  const invocations = await readEvidenceJson(evidenceDir, "invocations.json");
  if (!hasPinnedListInvocation(invocations)) {
    throw new Error(
      `Inventory proof missing pinned list invocation for skills@${PINNED_CLI}.`,
    );
  }

  const inventory = await readEvidenceJson(
    evidenceDir,
    "fixture-inventory.json",
  );
  const project = Array.isArray(inventory?.project) ? inventory.project : [];
  const projectSkill = project.find((entry) => entry?.name === QA_PROJECT_SKILL);
  if (projectSkill === undefined) {
    throw new Error(`Fixture inventory lost ${QA_PROJECT_SKILL}.`);
  }
  if (projectSkill.source !== QA_PROJECT_SOURCE) {
    throw new Error(
      `Fixture project skill source drifted: ${JSON.stringify(projectSkill.source)}.`,
    );
  }
  const global = Array.isArray(inventory?.global) ? inventory.global : [];
  if (!global.some((entry) => entry?.name === QA_GLOBAL_SKILL)) {
    throw new Error(`Fixture inventory lost ${QA_GLOBAL_SKILL}.`);
  }

  const state = await readEvidenceJson(
    evidenceDir,
    "04-inventory-cleared.json",
  );
  if (state.heading !== "Inventory") {
    throw new Error(
      `Cleared inventory heading was ${JSON.stringify(state.heading)}.`,
    );
  }
  const names = Array.isArray(state.skillNames) ? state.skillNames : [];
  if (!names.includes(QA_PROJECT_SKILL) || !names.includes(QA_GLOBAL_SKILL)) {
    throw new Error(
      "Cleared inventory state does not show both fixture skills.",
    );
  }
}

export async function assertAboutEvidence(evidenceDir) {
  const state = await readEvidenceJson(evidenceDir, "about.json");
  if (state.heading !== "About" || state.currentView !== "About") {
    throw new Error(
      `About state is not the About view: ${JSON.stringify({
        currentView: state.currentView,
        heading: state.heading,
      })}`,
    );
  }

  const facts = await readEvidenceJson(evidenceDir, "about-facts.json");
  if (
    facts.heading !== "About" ||
    facts.hasProductName !== true ||
    facts.hasManualUpgrade !== true ||
    facts.hasVersion !== true ||
    facts.hasDiagnosticExport !== true ||
    facts.hasCheckButton !== false ||
    facts.hasElectronDownloadJargon !== false ||
    facts.hasCandidateJargon !== false
  ) {
    throw new Error(
      `Unsigned-preview About contract failed: ${JSON.stringify(facts)}`,
    );
  }
}
