import { describe, expect, it } from "vitest";

import {
  assertAllowlistedSkillsShUrl,
  buildSkillsShUrl,
  createRecordingExternalBrowser,
  deriveSkillsShHandoffRecords,
  publicationDataFromDeclaredSource,
  SKILLS_SH_MAX_URL_LENGTH,
} from "./skills-sh-handoff.js";

describe("skills.sh handoff URL construction (ADR 0021)", () => {
  it("builds only https://skills.sh/{owner}/{repository}[/{skill}]", () => {
    expect(
      buildSkillsShUrl({ owner: "vercel-labs", repository: "agent-skills", skill: null }),
    ).toEqual({ ok: true, value: "https://skills.sh/vercel-labs/agent-skills" });
    expect(
      buildSkillsShUrl({
        owner: "vercel-labs",
        repository: "agent-skills",
        skill: "vercel-react-best-practices",
      }),
    ).toEqual({
      ok: true,
      value: "https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices",
    });
  });

  it("refuses publication data that cannot be a plain path segment", () => {
    const refused = (data: Parameters<typeof buildSkillsShUrl>[0]) => {
      const result = buildSkillsShUrl(data);
      expect(result.ok).toBe(false);
      return result.ok ? "" : result.error.code;
    };
    expect(refused({ owner: "", repository: "repo", skill: null })).toBe(
      "invalid_publication_data",
    );
    expect(refused({ owner: "-bad", repository: "repo", skill: null })).toBe(
      "invalid_publication_data",
    );
    expect(refused({ owner: "own er", repository: "repo", skill: null })).toBe(
      "invalid_publication_data",
    );
    expect(refused({ owner: "owner", repository: "..", skill: null })).toBe(
      "invalid_publication_data",
    );
    expect(refused({ owner: "owner", repository: "repo.git", skill: null })).toBe(
      "invalid_publication_data",
    );
    expect(refused({ owner: "owner", repository: "re/po", skill: null })).toBe(
      "invalid_publication_data",
    );
    expect(refused({ owner: "owner", repository: "repo", skill: "a\u0000b" })).toBe(
      "invalid_publication_data",
    );
    expect(refused({ owner: "owner", repository: "repo", skill: "../etc" })).toBe(
      "invalid_publication_data",
    );
    expect(refused({ owner: "owner", repository: "repo", skill: "x?y=1" })).toBe(
      "invalid_publication_data",
    );
    expect(refused({ owner: "owner", repository: "repo", skill: "x#frag" })).toBe(
      "invalid_publication_data",
    );
    expect(refused({ owner: "owner", repository: "repo", skill: "a".repeat(257) })).toBe(
      "invalid_publication_data",
    );
    expect(refused({ owner: "a".repeat(40), repository: "repo", skill: null })).toBe(
      "invalid_publication_data",
    );
  });

  it("allowlists the final URL independently of the builder", () => {
    const ok = (url: string) =>
      expect(assertAllowlistedSkillsShUrl(url)).toEqual({ ok: true, value: url });
    ok("https://skills.sh/owner/repo");
    ok("https://skills.sh/owner/repo/skill");

    const refused = (url: string) => {
      const result = assertAllowlistedSkillsShUrl(url);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("url_not_allowlisted");
    };
    refused("http://skills.sh/owner/repo");
    refused("https://www.skills.sh/owner/repo");
    refused("https://skills.sh.evil.example/owner/repo");
    refused("https://evil.example/skills.sh/owner/repo");
    refused("https://skills.sh:8443/owner/repo");
    refused("https://user:pass@skills.sh/owner/repo");
    refused("https://skills.sh/owner/repo?utm=1");
    refused("https://skills.sh/owner/repo#section");
    refused("https://skills.sh/owner");
    refused("https://skills.sh/owner/repo/skill/extra");
    refused("https://skills.sh/owner/repo/");
    refused("https://skills.sh//repo");
    refused("https://skills.sh/owner/repo/sk ill");
    refused("https://skills.sh/owner/repo/sk\u0007ill");
    refused("https://skills.sh/owner/%2e%2e/skill");
    refused("javascript:alert(1)");
    refused("file:///etc/passwd");
    refused(`https://skills.sh/owner/${"a".repeat(SKILLS_SH_MAX_URL_LENGTH)}`);
    refused("HTTPS://SKILLS.SH/owner/repo");
  });

  it("derives publication data only from GitHub declared sources", () => {
    expect(
      publicationDataFromDeclaredSource({
        declaredSource: { source: "vercel-labs/agent-skills", sourceType: "github" },
        name: "find-skills",
      }),
    ).toEqual({ owner: "vercel-labs", repository: "agent-skills", skill: "find-skills" });
    expect(
      publicationDataFromDeclaredSource({
        declaredSource: { source: null, sourceType: null },
        name: "local-only",
      }),
    ).toBeNull();
    expect(
      publicationDataFromDeclaredSource({
        declaredSource: { source: "not-a-repo", sourceType: "github" },
        name: "odd",
      }),
    ).toBeNull();
    expect(
      publicationDataFromDeclaredSource({
        declaredSource: { source: "a/b/c", sourceType: "github" },
        name: "odd",
      }),
    ).toBeNull();
  });

  it("binds record ids to the session epoch and Target", () => {
    const entries = [
      {
        agents: [],
        contentFingerprint: { status: "unknown" as const },
        declaredSource: { source: "vercel-labs/agent-skills", sourceType: "github" as const },
        name: "find-skills",
        revision: { status: "unknown" as const },
        scope: "project" as const,
      },
      {
        agents: [],
        contentFingerprint: { status: "unknown" as const },
        declaredSource: { source: null, sourceType: null },
        name: "hand-written",
        revision: { status: "unknown" as const },
        scope: "project" as const,
      },
    ];
    const first = deriveSkillsShHandoffRecords({
      entries,
      sessionEpoch: "epoch-1",
      targetId: "00000000-0000-4000-8000-000000000001",
    });
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      kind: "skills-sh",
      owner: "vercel-labs",
      repository: "agent-skills",
      skill: "find-skills",
      sourceEntry: { name: "find-skills", scope: "project" },
    });
    expect(first[0]!.id).toMatch(/^[a-f0-9]{64}$/);
    expect(
      deriveSkillsShHandoffRecords({
        entries,
        sessionEpoch: "epoch-1",
        targetId: "00000000-0000-4000-8000-000000000001",
      })[0]!.id,
    ).toBe(first[0]!.id);
    expect(
      deriveSkillsShHandoffRecords({
        entries,
        sessionEpoch: "epoch-2",
        targetId: "00000000-0000-4000-8000-000000000001",
      })[0]!.id,
    ).not.toBe(first[0]!.id);
    expect(
      deriveSkillsShHandoffRecords({
        entries,
        sessionEpoch: "epoch-1",
        targetId: "00000000-0000-4000-8000-000000000002",
      })[0]!.id,
    ).not.toBe(first[0]!.id);
  });

  it("records instead of launching when the recorder adapter is used", async () => {
    const browser = createRecordingExternalBrowser();
    await browser.openExternal("https://skills.sh/owner/repo");
    expect(browser.opened).toEqual(["https://skills.sh/owner/repo"]);
  });
});
