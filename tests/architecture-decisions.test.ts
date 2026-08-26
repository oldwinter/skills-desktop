import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

const requiredDecisions = [
  "0014-adopt-multi-harness-targets-and-a-pinned-registry.md",
  "0015-inspect-stable-sources-through-the-pinned-cli.md",
  "0016-promote-posix-ssh-with-wire-v3.md",
  "0017-separate-package-origins-in-canonical-skillpacks.md",
  "0018-author-skills-with-static-studio-grants.md",
  "0019-export-deterministic-well-known-artifacts.md",
  "0020-publish-through-isolated-guarded-git.md",
  "0021-handoff-to-skills-sh-through-the-system-browser.md",
  "0022-recover-through-versioned-records-and-typed-repairs.md",
  "0023-ship-a-native-bilingual-accessible-shell.md",
  "0024-qualify-an-unsigned-mission-candidate.md",
] as const;

describe("accepted comprehensive-evolution decisions", () => {
  it("records every architecture-required category before dependent work", async () => {
    const index = await readFile(
      path.join(repositoryRoot, "docs", "adr", "README.md"),
      "utf8",
    );
    for (const fileName of requiredDecisions) {
      expect(index).toContain(fileName);

      const decision = await readFile(
        path.join(repositoryRoot, "docs", "adr", fileName),
        "utf8",
      );

      expect(decision).toMatch(/^# .+\n\nStatus: Accepted\n/m);
      expect(decision).toContain("## Context");
      expect(decision).toContain("## Decision");
      expect(decision).toContain("## Alternatives considered");
      expect(decision).toContain("## Consequences");
      expect(decision).toContain("## Relationship to earlier decisions");
    }
  });

  it("defines the canonical cross-milestone vocabulary without weakening safety", async () => {
    const context = await readFile(
      path.join(repositoryRoot, "CONTEXT.md"),
      "utf8",
    );
    const index = await readFile(
      path.join(repositoryRoot, "docs", "adr", "README.md"),
      "utf8",
    );
    const normalizedIndex = index.replace(/\s+/g, " ");

    for (const term of [
      "Harness Compatibility Registry",
      "Skills Dialect",
      "Source Descriptor",
      "Source Inspection",
      "Filesystem Grant",
      "Skillpack",
      "Publication Guard",
      "Workspace Protocol v2",
      "Review Protocol v2",
      "Recovery Center",
      "Unsigned Candidate",
    ]) {
      expect(context).toContain(`**${term}**`);
    }

    expect(normalizedIndex).toContain("ADRs 0001 through 0013 remain accepted");
    expect(normalizedIndex).toContain("installed state authority");
    expect(normalizedIndex).toContain("Guard");
    expect(normalizedIndex).toContain(
      "Stable Release requirements remain in force",
    );
  });

  it("keeps future capability claims behind their named milestone gates", async () => {
    const readme = await readFile(path.join(repositoryRoot, "README.md"), "utf8");
    const guide = await readFile(
      path.join(repositoryRoot, "docs", "user-guide.md"),
      "utf8",
    );

    const normalizedReadme = readme.replace(/\s+/g, " ");
    const normalizedGuide = guide.replace(/\s+/g, " ");

    expect(normalizedReadme).toContain(
      "The accepted architecture now targets Local plus POSIX Remote SSH",
    );
    expect(normalizedReadme).toContain(
      "SSH Inventory remains unavailable until Milestone 3 passes",
    );
    expect(normalizedReadme).toContain(
      "SSH mutation remains unavailable until Milestone 4 passes",
    );
    expect(normalizedReadme).toContain("Unsigned Developer Preview");
    expect(normalizedReadme).not.toContain("signed Stable Release is available");

    expect(normalizedGuide).toContain("当前产品仍只开放 Local Target");
    expect(normalizedGuide).toContain("Milestone 3");
    expect(normalizedGuide).toContain("Milestone 4");
  });
});
