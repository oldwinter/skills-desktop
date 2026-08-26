import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  canonicalHarnessRegistryJson,
  HARNESS_IDS,
  HARNESS_REGISTRY,
  HARNESS_REGISTRY_DIGEST,
  HARNESS_REGISTRY_VERSION,
  interpretHarnessCoverage,
  normalizeHarnessIds,
  parseHarnessId,
  resolveLegacyHarnessAlias,
  SKILLS_DIALECT,
  SKILLS_DIALECT_ID,
  validateHarnessScope,
} from "./harness-registry.js";

const reviewedHarnessIds = [
  "aider-desk",
  "amp",
  "antigravity",
  "antigravity-cli",
  "astrbot",
  "autohand-code",
  "augment",
  "bob",
  "claude-code",
  "openclaw",
  "cline",
  "codearts-agent",
  "codebuddy",
  "codemaker",
  "codestudio",
  "codex",
  "command-code",
  "continue",
  "cortex",
  "crush",
  "cursor",
  "deepagents",
  "devin",
  "dexto",
  "droid",
  "eve",
  "firebender",
  "forgecode",
  "gemini-cli",
  "github-copilot",
  "goose",
  "grok",
  "hermes-agent",
  "inference-sh",
  "jazz",
  "junie",
  "iflow-cli",
  "kilo",
  "kimchi",
  "kimi-code-cli",
  "kiro-cli",
  "kode",
  "lingma",
  "loaf",
  "mcpjam",
  "minimax-code",
  "mistral-vibe",
  "moxby",
  "mux",
  "opencode",
  "openhands",
  "ona",
  "pi",
  "posit-assistant",
  "qoder",
  "qoder-cn",
  "qwen-code",
  "replit",
  "reasonix",
  "rovodev",
  "roo",
  "tabnine-cli",
  "terramind",
  "tinycloud",
  "trae",
  "trae-cn",
  "warp",
  "windsurf",
  "zed",
  "zcode",
  "zencoder",
  "zenflow",
  "neovate",
  "pochi",
  "promptscript",
  "adal",
  "universal",
] as const;

const fixtureBytes = readFileSync(
  new URL(
    "../fixtures/skills-1.5.23-harness-registry.v1.tsv",
    import.meta.url,
  ),
  "utf8",
);

function parseReviewedFixture() {
  const [header, ...rows] = fixtureBytes.trimEnd().split("\n");
  expect(header).toBe(
    "cliId\tdisplayAlias\tinventoryToken\tdisplayMessageKey\tprojectScope\tglobalScope\tprojectSharedEffectGroup\tglobalSharedEffectGroup\temptyAgentListCoverage",
  );
  return rows.map((row) => {
    const [
      cliId,
      displayAlias,
      inventoryToken,
      displayMessageKey,
      projectScope,
      globalScope,
      projectSharedEffectGroup,
      globalSharedEffectGroup,
      emptyAgentListCoverage,
    ] = row.split("\t");
    return {
      cliId,
      displayAliases: [displayAlias],
      displayMessageKey,
      emptyAgentListCoverage,
      inventoryTokens: [inventoryToken],
      sharedEffectGroups: {
        global:
          globalSharedEffectGroup === "-" ? null : globalSharedEffectGroup,
        project:
          projectSharedEffectGroup === "-" ? null : projectSharedEffectGroup,
      },
      scopeSupport: {
        global: globalScope === "yes",
        project: projectScope === "yes",
      },
    };
  });
}

describe("skills@1.5.23 Harness Compatibility Registry", () => {
  it("accepts exactly 77 canonical IDs and normalizes sets in registry order", () => {
    expect(HARNESS_IDS).toEqual(reviewedHarnessIds);
    expect(new Set(HARNESS_IDS).size).toBe(77);
    expect(normalizeHarnessIds(["universal", "codex", "codex", "amp"])).toEqual({
      ok: true,
      value: ["amp", "codex", "universal"],
    });
    expect(parseHarnessId("codex")).toEqual({ ok: true, value: "codex" });
    expect(parseHarnessId("Codex")).toMatchObject({
      error: { code: "unsupported_harness" },
      ok: false,
    });
    expect(parseHarnessId("future-harness")).toMatchObject({
      error: { code: "unsupported_harness" },
      ok: false,
    });
  });

  it("keeps display aliases explicit and never case-folds them into authority", () => {
    expect(resolveLegacyHarnessAlias("Codex")).toEqual({
      ok: true,
      value: "codex",
    });
    expect(resolveLegacyHarnessAlias("Autohand Code CLI")).toEqual({
      ok: true,
      value: "autohand-code",
    });
    expect(resolveLegacyHarnessAlias("CODEX")).toMatchObject({
      error: {
        code: "unsupported_harness",
        unsupportedHarnessIds: ["CODEX"],
      },
      ok: false,
    });
  });

  it("interprets direct, shared, absent, and unknown evidence per scope", () => {
    expect(
      interpretHarnessCoverage({
        harnessId: "codex",
        inventoryTokens: ["Codex"],
        scope: "project",
      }),
    ).toBe("direct");
    expect(
      interpretHarnessCoverage({
        harnessId: "codex",
        inventoryTokens: [],
        scope: "project",
      }),
    ).toBe("direct");
    expect(
      interpretHarnessCoverage({
        harnessId: "codex",
        inventoryTokens: ["Amp"],
        scope: "project",
      }),
    ).toBe("shared");
    expect(
      interpretHarnessCoverage({
        harnessId: "codex",
        inventoryTokens: ["Claude Code"],
        scope: "project",
      }),
    ).toBe("absent");
    for (const token of ["CODEX", "Codex Desktop", "future-harness"]) {
      expect(
        interpretHarnessCoverage({
          harnessId: "codex",
          inventoryTokens: [token],
          scope: "project",
        }),
      ).toBe("unknown");
    }
    expect(
      interpretHarnessCoverage({
        harnessId: "codex",
        inventoryTokens: ["Codex", "future-harness"],
        scope: "project",
      }),
    ).toBe("unknown");
  });

  it("rejects unsupported global sets without narrowing supported harnesses", () => {
    expect(validateHarnessScope(["codex", "eve"], "global")).toEqual({
      error: {
        code: "unsupported_harness_scope",
        effects: "none",
        message: "The selected harness set is not supported in this scope.",
        phase: "prepare",
        retryable: false,
        unsupportedHarnessIds: ["eve"],
      },
      ok: false,
    });
    expect(
      validateHarnessScope(["promptscript", "eve"], "global"),
    ).toMatchObject({
      error: {
        code: "unsupported_harness_scope",
        unsupportedHarnessIds: ["eve", "promptscript"],
      },
      ok: false,
    });
    expect(validateHarnessScope(["eve", "codex"], "project")).toEqual({
      ok: true,
      value: ["codex", "eve"],
    });
  });

  it("matches the separately reviewed pinned-dialect fixture and digest", () => {
    const reviewedEntries = parseReviewedFixture();
    const reviewedCanonicalJson = JSON.stringify({
      dialectId: SKILLS_DIALECT_ID,
      registryVersion: HARNESS_REGISTRY_VERSION,
      entries: reviewedEntries,
    });
    const reviewedDigest = `sha256:${createHash("sha256")
      .update(reviewedCanonicalJson)
      .digest("hex")}`;

    expect(createHash("sha256").update(fixtureBytes).digest("hex")).toBe(
      "9256df2f0cd17595720a2c14708bc598bf2f1b5c56689e1883af1df553abb3f2",
    );
    expect(reviewedEntries).toHaveLength(77);
    expect(reviewedEntries.map(({ cliId }) => cliId)).toEqual(
      reviewedHarnessIds,
    );
    expect(HARNESS_REGISTRY).toEqual(reviewedEntries);
    expect(canonicalHarnessRegistryJson()).toBe(reviewedCanonicalJson);
    expect(HARNESS_REGISTRY_DIGEST).toBe(reviewedDigest);
    expect(SKILLS_DIALECT).toEqual({
      cliVersion: "1.5.23",
      harnessRegistryDigest: reviewedDigest,
      harnessRegistryVersion: 1,
      id: "skills-1.5.23",
      inventorySchemaVersion: 1,
      package: "skills@1.5.23",
      sourceListingDialectVersion: 1,
    });
  });
});
