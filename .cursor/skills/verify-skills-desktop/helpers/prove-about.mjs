#!/usr/bin/env node
import { assertAboutEvidence } from "./prove-checks.mjs";
import { runProof } from "./prove-lib.mjs";

const aboutReady = [
  `document.querySelector("h1")?.textContent === "About"`,
  `document.body.textContent.includes("Manual upgrade")`,
  `document.body.textContent.includes("Version 0.1.0")`,
  `[...document.querySelectorAll("h2")].some((heading) => heading.textContent?.trim() === "Skills Desktop")`,
  `[...document.querySelectorAll("button")].some((button) => button.textContent?.includes("Export release diagnostics"))`,
  `![...document.querySelectorAll("button")].some((button) => button.textContent?.includes("Check for updates"))`,
  `!document.body.textContent.includes("Electron is downloading")`,
  `!/\\bCandidate\\b/.test(document.body.textContent ?? "")`,
].join(" && ");

const aboutFacts = `(() => {
  const text = document.body?.textContent ?? "";
  return {
    heading: document.querySelector("h1")?.textContent?.trim() ?? "",
    hasProductName: [...document.querySelectorAll("h2")].some(
      (heading) => heading.textContent?.trim() === "Skills Desktop",
    ),
    hasManualUpgrade: text.includes("Manual upgrade"),
    hasVersion: text.includes("Version 0.1.0"),
    hasDiagnosticExport: [...document.querySelectorAll("button")].some(
      (button) => button.textContent?.includes("Export release diagnostics"),
    ),
    hasCheckButton: [...document.querySelectorAll("button")].some(
      (button) => button.textContent?.includes("Check for updates"),
    ),
    hasElectronDownloadJargon: text.includes("Electron is downloading"),
    hasCandidateJargon: /\\bCandidate\\b/.test(text),
  };
})()`;

await runProof({
  assertEvidence: assertAboutEvidence,
  label: "about",
  requiredFiles: [
    "01-about.png",
    "about-facts.json",
    "about.json",
    "cleanup.json",
  ],
  steps: [
    ["drive.mjs", ["nav", "About"]],
    ["drive.mjs", ["wait", aboutReady, "about unsigned preview"]],
    ["drive.mjs", ["screenshot", "01-about.png"]],
    ["drive.mjs", ["state", "about"]],
    ["drive.mjs", ["write-eval", "about-facts.json", aboutFacts]],
  ],
});
