import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  classifyPublicationReadback,
  isPublicationManagedPath,
  PUBLICATION_MAX_BRANCH_LENGTH,
  PUBLICATION_MAX_REMOTE_LENGTH,
  sanitizePublicationRemote,
  sealPublicationPlan,
  validatePublicationBranch,
  verifyPublicationPlan,
  type PublicationPlanBody,
} from "./publication.js";

const sha256Hex = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

describe("sanitizePublicationRemote (ADR 0020)", () => {
  it.each([
    ["https://github.com/acme/skills.git", "https", "github.com"],
    ["https://git.example.com:8443/team/skills", "https", "git.example.com"],
    ["http://127.0.0.1:4711/fixture.git", "http-loopback", "127.0.0.1"],
    ["http://localhost:4711/fixture.git", "http-loopback", "localhost"],
    ["ssh://git@github.com/acme/skills.git", "ssh", "github.com"],
    ["ssh://git.example.com:2222/team/skills.git", "ssh", "git.example.com"],
    ["git@github.com:acme/skills.git", "ssh", "github.com"],
  ])("accepts %s as %s", (input, kind, host) => {
    expect(sanitizePublicationRemote(input)).toEqual({
      ok: true,
      value: { host, kind, url: input },
    });
  });

  it.each([
    ["", "empty"],
    [
      `https://h.example/${"a".repeat(PUBLICATION_MAX_REMOTE_LENGTH)}`,
      "too long",
    ],
    ["https://user:secret@github.com/acme/skills.git", "credentials"],
    ["https://token@github.com/acme/skills.git", "userinfo"],
    ["https://github.com/acme/skills.git?x=1", "query"],
    ["https://github.com/acme/skills.git#main", "fragment"],
    ["https://github.com/", "root path"],
    ["https://github.com/acme/../etc", "traversal"],
    ["HTTPS://github.com/acme/skills.git", "non-canonical scheme"],
    ["https://GitHub.com/acme/skills.git", "non-canonical host"],
    ["https://github.com:443/acme/skills.git", "default port spelled out"],
    ["https://github.com/acme/sk%69lls.git", "percent-encoding"],
    ["https://github.com/acme/sk ills.git", "whitespace"],
    ["https://github.com/acme/skills.git\n", "newline"],
    ["-https://github.com/acme/skills.git", "option-shaped"],
    ["--upload-pack=evil", "option"],
    ["http://example.com/skills.git", "plain http off loopback"],
    ["file:///tmp/repo.git", "file scheme"],
    ["ext::sh -c evil", "ext transport"],
    ["git://github.com/acme/skills.git", "git scheme"],
    ["/tmp/repo.git", "bare path"],
    ["../repo.git", "relative path"],
    ["acme/skills", "shorthand"],
    ["git@github.com:/acme/skills.git", "scp absolute path"],
    ["git@github.com:acme/../x.git", "scp traversal"],
    ["ssh://git@github.com/acme/skills.git?x", "ssh query"],
  ])("refuses %s (%s)", (input) => {
    expect(sanitizePublicationRemote(input)).toMatchObject({
      error: { code: "remote_unsupported", effects: "none" },
      ok: false,
    });
  });

  it("refuses non-text", () => {
    expect(sanitizePublicationRemote(42)).toMatchObject({ ok: false });
    expect(sanitizePublicationRemote(undefined)).toMatchObject({ ok: false });
  });
});

describe("validatePublicationBranch (ADR 0020)", () => {
  it.each(["main", "skills/publish", "release-2026.09", "team_a/v1.2"])(
    "accepts %s as one exact refs/heads name",
    (branch) => {
      expect(validatePublicationBranch(branch)).toEqual({
        ok: true,
        value: { branch, ref: `refs/heads/${branch}` },
      });
    },
  );

  it.each([
    "",
    "a".repeat(PUBLICATION_MAX_BRANCH_LENGTH + 1),
    "refs/heads/main",
    "refs/tags/v1",
    "HEAD",
    "main..dev",
    "feature/*",
    "a//b",
    "/main",
    "main/",
    ".hidden",
    "-flag",
    "main.lock",
    "x/y.lock",
    "main.",
    "a@{1}",
    "a:b",
    "a b",
    "a\tb",
    "a\\b",
    "a~1",
    "a^2",
    "a?b",
    "a[b]",
  ])("refuses %j", (branch) => {
    expect(validatePublicationBranch(branch)).toMatchObject({
      error: { code: "branch_unsupported" },
      ok: false,
    });
  });
});

describe("isPublicationManagedPath", () => {
  it("allows only the well-known export tree", () => {
    expect(
      isPublicationManagedPath(".well-known/agent-skills/index.json"),
    ).toBe(true);
    expect(
      isPublicationManagedPath(".well-known/agent-skills/artifacts/x.tar.gz"),
    ).toBe(true);
    expect(isPublicationManagedPath(".well-known/agent-skills")).toBe(false);
    expect(isPublicationManagedPath(".well-known/other/index.json")).toBe(
      false,
    );
    expect(isPublicationManagedPath("README.md")).toBe(false);
    expect(
      isPublicationManagedPath("/.well-known/agent-skills/index.json"),
    ).toBe(false);
    expect(isPublicationManagedPath(".well-known/agent-skills/../x")).toBe(
      false,
    );
    expect(isPublicationManagedPath(".well-known/agent-skills//x")).toBe(false);
    expect(isPublicationManagedPath(".well-known\\agent-skills\\x")).toBe(
      false,
    );
  });
});

describe("PublicationPlanV1", () => {
  const body: PublicationPlanBody = {
    base: { commit: "a".repeat(40), kind: "commit" },
    branch: "main",
    candidateCommit: "b".repeat(40),
    createdAt: "2026-09-15T10:00:00.000Z",
    expiresAt: "2026-09-15T10:10:00.000Z",
    exporterVersion: 1,
    files: [
      {
        digest: `sha256:${"c".repeat(64)}`,
        path: ".well-known/agent-skills/index.json",
      },
    ],
    id: "publication-1",
    ref: "refs/heads/main",
    remote: {
      host: "github.com",
      kind: "https",
      url: "https://github.com/acme/skills.git",
    },
    schemaVersion: 1,
    skills: ["hello"],
    treeDigest: `sha256:${"d".repeat(64)}`,
  };

  it("seals a digest over the canonical body and verifies it", () => {
    const plan = sealPublicationPlan(body, sha256Hex);
    expect(plan.planDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(verifyPublicationPlan(plan, sha256Hex)).toBe(true);
    // Key order never changes the digest.
    const reordered = sealPublicationPlan(
      JSON.parse(
        JSON.stringify({
          ...body,
          treeDigest: body.treeDigest,
          base: body.base,
        }),
      ),
      sha256Hex,
    );
    expect(reordered.planDigest).toBe(plan.planDigest);
  });

  it("refuses a plan whose facts drifted from its digest or escaped the managed root", () => {
    const plan = sealPublicationPlan(body, sha256Hex);
    expect(
      verifyPublicationPlan(
        { ...plan, candidateCommit: "e".repeat(40) },
        sha256Hex,
      ),
    ).toBe(false);
    expect(
      verifyPublicationPlan(
        { ...plan, planDigest: `sha256:${"0".repeat(64)}` },
        sha256Hex,
      ),
    ).toBe(false);
    expect(() =>
      sealPublicationPlan(
        {
          ...body,
          files: [{ digest: `sha256:${"c".repeat(64)}`, path: "README.md" }],
        },
        sha256Hex,
      ),
    ).toThrow();
    expect(() =>
      sealPublicationPlan({ ...body, ref: "refs/tags/v1" } as never, sha256Hex),
    ).toThrow();
  });
});

describe("classifyPublicationReadback", () => {
  const candidate = "b".repeat(40);
  it("classifies exact readback against the plan", () => {
    const base = { commit: "a".repeat(40), kind: "commit" } as const;
    expect(
      classifyPublicationReadback({
        base,
        candidateCommit: candidate,
        observed: candidate,
      }),
    ).toBe("published");
    expect(
      classifyPublicationReadback({
        base,
        candidateCommit: candidate,
        observed: base.commit,
      }),
    ).toBe("not-published");
    expect(
      classifyPublicationReadback({
        base,
        candidateCommit: candidate,
        observed: "f".repeat(40),
      }),
    ).toBe("diverged");
    expect(
      classifyPublicationReadback({
        base,
        candidateCommit: candidate,
        observed: null,
      }),
    ).toBe("diverged");
    expect(
      classifyPublicationReadback({
        base,
        candidateCommit: candidate,
        observed: undefined,
      }),
    ).toBe("uncertain");
  });

  it("treats an unborn base as not-published only while the ref is still absent", () => {
    const base = { kind: "unborn" } as const;
    expect(
      classifyPublicationReadback({
        base,
        candidateCommit: candidate,
        observed: null,
      }),
    ).toBe("not-published");
    expect(
      classifyPublicationReadback({
        base,
        candidateCommit: candidate,
        observed: "f".repeat(40),
      }),
    ).toBe("diverged");
    expect(
      classifyPublicationReadback({
        base,
        candidateCommit: candidate,
        observed: candidate,
      }),
    ).toBe("published");
  });
});
