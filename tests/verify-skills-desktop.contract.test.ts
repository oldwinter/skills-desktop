import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  CLI_VERSION,
  QA_GLOBAL_SKILL,
  QA_PROJECT_SKILL,
  QA_PROJECT_SOURCE,
} from "./packaged-ui-qa/fixture.mjs";
import {
  PINNED_CLI,
  PRIMARY_NAV,
} from "../.cursor/skills/verify-skills-desktop/helpers/lib.mjs";
import {
  assertAboutEvidence,
  assertInventoryEvidence,
  hasPinnedListInvocation,
} from "../.cursor/skills/verify-skills-desktop/helpers/prove-checks.mjs";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = join(
  repositoryRoot,
  ".cursor",
  "skills",
  "verify-skills-desktop",
);
const helpersRoot = join(skillRoot, "helpers");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function evidenceDir() {
  const root = await mkdtemp(join(tmpdir(), "verify-skills-desktop-evidence-"));
  temporaryDirectories.push(root);
  return root;
}

async function writeJson(directory: string, name: string, value: unknown) {
  await writeFile(join(directory, name), `${JSON.stringify(value)}\n`);
}

function helperSource(name: string) {
  return readFile(join(helpersRoot, name), "utf8");
}

describe("verify-skills-desktop packaging contract", () => {
  it("pins the same CLI dialect and fixture skills as packaged UI QA", () => {
    expect(PINNED_CLI).toBe(CLI_VERSION);
    expect(PINNED_CLI).toBe("1.5.23");
    expect(QA_PROJECT_SKILL).toBe("qa-project-skill");
    expect(QA_GLOBAL_SKILL).toBe("qa-global-skill");
    expect(QA_PROJECT_SOURCE).toBe("example/skills-desktop-qa");
    expect(PRIMARY_NAV).toEqual([
      "Inventory",
      "Comparison",
      "Collections",
      "Targets",
      "About",
    ]);
  });

  it("reuses packaged-ui-qa launch, fixture, and CDP modules", async () => {
    const lib = await helperSource("lib.mjs");
    const launch = await helperSource("launch.mjs");
    expect(lib).toContain(
      'from "../../../../tests/packaged-ui-qa/cdp.mjs"',
    );
    expect(lib).toContain(
      'from "../../../../tests/packaged-ui-qa/fixture.mjs"',
    );
    expect(launch).toContain(
      'from "../../../../tests/packaged-ui-qa/launch.mjs"',
    );
    expect(launch).toContain("createPackagedQaFixture");
    expect(launch).toContain("launchPackagedElectron");
    expect(launch).not.toContain("spawn(executablePath");
  });

  it("never disables the Chromium sandbox in skill helpers or packaged smoke", async () => {
    const skillFiles = [
      "SKILL.md",
      "helpers/lib.mjs",
      "helpers/launch.mjs",
      "helpers/drive.mjs",
      "helpers/doctor.mjs",
      "helpers/cleanup.mjs",
      "helpers/prove-inventory.mjs",
      "helpers/prove-about.mjs",
      "helpers/prove-checks.mjs",
      "helpers/prove-lib.mjs",
    ];
    for (const relative of skillFiles) {
      const source = await readFile(join(skillRoot, relative), "utf8");
      if (relative === "SKILL.md") {
        expect(source).toContain("Never pass `--no-sandbox`");
        expect(source).toContain(
          "Never export `SKILLS_DESKTOP_QA_DISABLE_CHROMIUM_SANDBOX`",
        );
        continue;
      }
      expect(source, relative).not.toContain("--no-sandbox");
      expect(source, relative).not.toContain(
        "SKILLS_DESKTOP_QA_DISABLE_CHROMIUM_SANDBOX",
      );
    }
    const smoke = await readFile(
      join(repositoryRoot, "tests", "packaged-electron.smoke.mjs"),
      "utf8",
    );
    expect(smoke).not.toContain("--no-sandbox");
    expect(smoke).not.toContain("SKILLS_DESKTOP_QA_DISABLE_CHROMIUM_SANDBOX");
  });

  it("documents Linux packaging, xvfb, and both one-shot proofs", async () => {
    const skill = await readFile(join(skillRoot, "SKILL.md"), "utf8");
    expect(skill).toContain("npm run package:linux");
    expect(skill).toContain("xvfb-run -a node .cursor/skills/verify-skills-desktop/helpers/launch.mjs");
    expect(skill).toContain("helpers/prove-inventory.mjs");
    expect(skill).toContain("helpers/prove-about.mjs");
    expect(skill).toContain("write-eval");
    expect(skill).toContain("Never pass `--no-sandbox`");
    expect(skill).toContain(
      "Never export `SKILLS_DESKTOP_QA_DISABLE_CHROMIUM_SANDBOX`",
    );
  });

  it("recognizes only pinned list argv arrays as inventory CLI evidence", () => {
    expect(
      hasPinnedListInvocation([
        ["--yes", "skills@1.5.23", "--version"],
        ["--yes", "skills@1.5.23", "list", "--json"],
      ]),
    ).toBe(true);
    expect(
      hasPinnedListInvocation([["--yes", "skills@1.5.23", "remove", QA_PROJECT_SKILL]]),
    ).toBe(false);
    expect(hasPinnedListInvocation([["--yes", "skills@9.9.9", "list", "--json"]])).toBe(
      false,
    );
    expect(hasPinnedListInvocation("--yes skills@1.5.23 list --json")).toBe(false);
  });

  it("fails closed when inventory proof evidence is incomplete", async () => {
    const missing = await evidenceDir();
    await expect(assertInventoryEvidence(missing)).rejects.toThrow(
      /Evidence file unreadable: invocations.json/,
    );

    const noList = await evidenceDir();
    await writeJson(noList, "invocations.json", [
      ["--yes", "skills@1.5.23", "--version"],
    ]);
    await expect(assertInventoryEvidence(noList)).rejects.toThrow(
      /missing pinned list invocation/,
    );

    const complete = await evidenceDir();
    await writeJson(complete, "invocations.json", [
      ["--yes", "skills@1.5.23", "list", "--json"],
      ["--yes", "skills@1.5.23", "list", "--global", "--json"],
    ]);
    await writeJson(complete, "fixture-inventory.json", {
      global: [{ name: QA_GLOBAL_SKILL, scope: "global" }],
      project: [
        { name: QA_PROJECT_SKILL, scope: "project", source: QA_PROJECT_SOURCE },
      ],
    });
    await writeJson(complete, "04-inventory-cleared.json", {
      heading: "Inventory",
      skillNames: [QA_GLOBAL_SKILL, QA_PROJECT_SKILL],
    });
    await expect(assertInventoryEvidence(complete)).resolves.toBeUndefined();
  });

  it("fails closed when unsigned-preview About evidence is incomplete", async () => {
    const missing = await evidenceDir();
    await expect(assertAboutEvidence(missing)).rejects.toThrow(
      /Evidence file unreadable: about.json/,
    );

    const wrongView = await evidenceDir();
    await writeJson(wrongView, "about.json", {
      currentView: "Inventory",
      heading: "Inventory",
    });
    await expect(assertAboutEvidence(wrongView)).rejects.toThrow(
      /About state is not the About view/,
    );

    const liveFeed = await evidenceDir();
    await writeJson(liveFeed, "about.json", {
      currentView: "About",
      heading: "About",
    });
    await writeJson(liveFeed, "about-facts.json", {
      hasCandidateJargon: false,
      hasCheckButton: true,
      hasDiagnosticExport: true,
      hasElectronDownloadJargon: false,
      hasManualUpgrade: true,
      hasProductName: true,
      hasVersion: true,
      heading: "About",
    });
    await expect(assertAboutEvidence(liveFeed)).rejects.toThrow(
      /Unsigned-preview About contract failed/,
    );

    const complete = await evidenceDir();
    await writeJson(complete, "about.json", {
      currentView: "About",
      heading: "About",
    });
    await writeJson(complete, "about-facts.json", {
      hasCandidateJargon: false,
      hasCheckButton: false,
      hasDiagnosticExport: true,
      hasElectronDownloadJargon: false,
      hasManualUpgrade: true,
      hasProductName: true,
      hasVersion: true,
      heading: "About",
    });
    await expect(assertAboutEvidence(complete)).resolves.toBeUndefined();
  });
});
