import { describe, expect, it } from "vitest";

import type {
  Inventory,
  WellKnownSkillInput,
} from "@skills-desktop/skills-runtime";

import { createNodeWellKnownCodec } from "../adapters/node-well-known-codec.js";
import type { SkillsProcess } from "../adapters/local-skills-process.js";
import type {
  GitPublisher,
  PreparedPublication,
  PublicationReadback,
} from "../git/git-publisher.js";
import { createMemoryRecoveryRecords } from "../persistence/recovery-records.js";
import { createSkillsTargetsCatalog } from "../targets/local-skills-targets.js";
import {
  createDesktopCapabilities,
  type TargetDefinition,
} from "./desktop-capabilities.js";
import type { PublicationHost } from "./publication.js";

const target: TargetDefinition = {
  connectionReference: null,
  dialectId: "skills-1.5.23",
  executionBindingDigest: null,
  generation: 1,
  harnessIds: ["codex"],
  id: "00000000-0000-4000-8000-000000000001",
  kind: "local",
  label: "This device",
  registryDigest:
    "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de",
  registryVersion: 1,
  workspace: "/work/skills-desktop",
  workspaceLabel: "skills-desktop",
};

const freshInventory: Inventory = {
  cliVersion: "1.5.23",
  entries: [],
  observedAt: "2026-08-21T10:00:00.000Z",
  schemaVersion: 1,
};

const codec = createNodeWellKnownCodec();
const BASE = "a".repeat(40);
const CANDIDATE = "c".repeat(40);
const REMOTE = "https://github.com/acme/skills.git";

const skills: readonly WellKnownSkillInput[] = [
  {
    files: [
      {
        bytes: new TextEncoder().encode(
          "---\nname: hello\ndescription: Says hello.\n---\n",
        ),
        path: "SKILL.md",
      },
    ],
    name: "hello",
  },
];

function host(): PublicationHost {
  return {
    async chooseExportDestination() {
      return { label: "out", path: "/private/out", status: "picked" };
    },
    async chooseSourceFolder() {
      return { label: "skills", path: "/private/skills", status: "picked" };
    },
    async readSourceFolder() {
      return { ok: true, value: skills };
    },
    async writeExport() {
      return { ok: true, value: undefined };
    },
  };
}

function publisher(script: {
  push?: () => Awaited<ReturnType<GitPublisher["push"]>>;
  readback?: () => PublicationReadback;
}) {
  const discarded: PreparedPublication[] = [];
  let pushes = 0;
  const fake: GitPublisher & { readonly pushes: () => number } = {
    pushes: () => pushes,
    async discard(prepared) {
      discarded.push(prepared);
    },
    async prepare(input) {
      return {
        ok: true,
        value: {
          base: { commit: BASE, kind: "commit" },
          candidateCommit: CANDIDATE,
          files: input.files.map(({ bytes, path }) => ({
            digest: `sha256:${codec.sha256Hex(bytes)}` as const,
            path,
          })),
          root: "/tmp/owned",
        },
      };
    },
    async push() {
      pushes += 1;
      return (
        script.push?.() ?? {
          ok: true,
          value: { observed: CANDIDATE, pushExitCode: 0, status: "published" },
        }
      );
    },
    async readback() {
      return (
        script.readback?.() ?? { observed: CANDIDATE, status: "published" }
      );
    },
  };
  return { discarded, fake };
}

async function createFixture(options: {
  readonly ids: readonly string[];
  readonly publication?: {
    readonly host?: PublicationHost;
    readonly publisher?: GitPublisher;
  };
  readonly records?: ReturnType<typeof createMemoryRecoveryRecords>;
}) {
  const ids = [...options.ids];
  const lifecycle: string[] = [];
  const process: SkillsProcess = {
    async executeConfirmed() {
      throw new Error("not exercised");
    },
    async inspectSource() {
      throw new Error("not exercised");
    },
    async observeInventory() {
      return { ok: true, value: freshInventory };
    },
    async prepareMutation() {
      throw new Error("not exercised");
    },
  };
  const records = options.records ?? createMemoryRecoveryRecords();
  const reviewsRequested: string[] = [];
  const capabilities = createDesktopCapabilities({
    clock: () => new Date("2026-08-21T10:00:00.000Z"),
    id: () => ids.shift() ?? "unexpected-id",
    onReviewRequested: (reviewId) => {
      reviewsRequested.push(reviewId);
    },
    ...(options.publication === undefined
      ? {}
      : { publication: { codec, ...options.publication } }),
    recoveryRecords: {
      async commit(change) {
        lifecycle.push(change.type);
        return records.commit(change);
      },
      restore: () => records.restore(),
    },
    skillsTargets: createSkillsTargetsCatalog({
      id: () => "00000000-0000-4000-8000-000000000010",
      initialTarget: target,
      processFor: () => process,
    }),
  });
  await capabilities.initialize();
  const workspace = capabilities.attach(
    {
      endpointId: "workspace-1",
      role: "workspace",
      sessionEpoch: "workspace-epoch",
    },
    () => undefined,
  );
  lifecycle.length = 0;
  return { capabilities, lifecycle, records, reviewsRequested, workspace };
}

const choose = { type: "publication.choose-source", version: 2 } as const;
const prepare = {
  branch: "main",
  remote: REMOTE,
  type: "publication.prepare",
  version: 2,
} as const;

describe("DesktopCapabilities publication contract (ADR 0019 / ADR 0020)", () => {
  it("omits the publication projection and refuses requests when not wired", async () => {
    const fixture = await createFixture({ ids: [] });
    expect(await fixture.workspace.snapshot()).not.toHaveProperty(
      "publication",
    );
    expect(await fixture.workspace.request(choose)).toMatchObject({
      error: { code: "publication_unavailable" },
      ok: false,
    });
  });

  it("accepts only remote text and a branch from the renderer", async () => {
    const fixture = await createFixture({
      ids: ["op-1", "grant-1"],
      publication: { host: host(), publisher: publisher({}).fake },
    });
    expect(await fixture.workspace.request(choose)).toEqual({
      ok: true,
      value: { operationId: "op-1" },
    });
    for (const extra of [
      { path: "/tmp/repo" },
      { refspec: "+main:main" },
      { force: true },
      { args: ["--force"] },
    ]) {
      expect(
        await fixture.workspace.request({ ...prepare, ...extra }),
      ).toMatchObject({ error: { code: "invalid_request" }, ok: false });
    }
    expect(
      await fixture.workspace.request({ ...prepare, remote: "file:///tmp/x" }),
    ).toMatchObject({ error: { code: "remote_unsupported" }, ok: false });
    expect(
      await fixture.workspace.request({ ...prepare, branch: "-f" }),
    ).toMatchObject({ error: { code: "branch_unsupported" }, ok: false });
    expect(await fixture.workspace.snapshot()).toMatchObject({
      publication: { phase: "idle", plan: null },
    });
  });

  it("commits the Guard before the push, reviews through publication-push, and releases the Guard on published", async () => {
    const git = publisher({});
    const fixture = await createFixture({
      ids: ["op-1", "grant-1", "op-2", "plan-1", "review-1", "op-3"],
      publication: { host: host(), publisher: git.fake },
    });
    await fixture.workspace.request(choose);
    const snapshot = await fixture.workspace.snapshot();
    expect(snapshot).toMatchObject({
      publication: {
        available: true,
        guard: null,
        source: { grantId: "grant-1", label: "skills", skills: ["hello"] },
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain("/private/skills");

    expect(await fixture.workspace.request(prepare)).toEqual({
      ok: true,
      value: { operationId: "op-2" },
    });
    const planned = await fixture.workspace.snapshot();
    expect(planned).toMatchObject({
      publication: {
        phase: "planned",
        plan: {
          base: { commit: BASE, kind: "commit" },
          branch: "main",
          candidateCommit: CANDIDATE,
          id: "plan-1",
          ref: "refs/heads/main",
          remote: { host: "github.com", kind: "https", url: REMOTE },
        },
      },
    });

    expect(
      await fixture.workspace.request({
        planId: "missing",
        type: "publication.review.request",
        version: 2,
      }),
    ).toMatchObject({ error: { code: "review_invalid" }, ok: false });
    expect(
      await fixture.workspace.request({
        planId: "plan-1",
        type: "publication.review.request",
        version: 2,
      }),
    ).toEqual({ ok: true, value: { operationId: "review-1" } });
    expect(fixture.reviewsRequested).toEqual(["review-1"]);
    expect(fixture.capabilities.restartSafety().guardReasons).toContain(
      "trusted-review-active",
    );

    const review = fixture.capabilities.attach(
      {
        endpointId: "review-1",
        reviewId: "review-1",
        role: "review",
        sessionEpoch: "review-epoch",
      },
      () => undefined,
    );
    expect(await review.snapshot()).toMatchObject({
      projection: {
        plan: { id: "plan-1", planDigest: expect.stringMatching(/^sha256:/) },
        purpose: "publication-push",
        reviewId: "review-1",
      },
      status: "pending",
    });
    expect(
      await review.request({
        decision: "approve",
        type: "review.decide",
        version: 2,
      }),
    ).toEqual({ ok: true, value: { operationId: "op-3" } });
    expect(git.fake.pushes()).toBe(1);
    expect(fixture.lifecycle).toEqual([
      "publication.guard.replace",
      "publication.guard.replace",
    ]);
    expect(git.discarded).toHaveLength(1);
    expect(await review.snapshot()).toMatchObject({
      decision: "approve",
      status: "settled",
    });
    expect(await fixture.workspace.snapshot()).toMatchObject({
      publication: {
        guard: null,
        lastOutcome: { planId: "plan-1", status: "published" },
        phase: "idle",
        plan: null,
      },
    });
    expect((await fixture.records.restore()).publicationGuard).toBeNull();
  });

  it("rejecting or closing the review discards the prepared root and never pushes", async () => {
    const git = publisher({});
    const fixture = await createFixture({
      ids: ["op-1", "grant-1", "op-2", "plan-1", "review-1", "op-3"],
      publication: { host: host(), publisher: git.fake },
    });
    await fixture.workspace.request(choose);
    await fixture.workspace.request(prepare);
    await fixture.workspace.request({
      planId: "plan-1",
      type: "publication.review.request",
      version: 2,
    });
    const review = fixture.capabilities.attach(
      {
        endpointId: "review-1",
        reviewId: "review-1",
        role: "review",
        sessionEpoch: "review-epoch",
      },
      () => undefined,
    );
    expect(
      await review.request({
        decision: "reject",
        type: "review.decide",
        version: 2,
      }),
    ).toEqual({ ok: true, value: { operationId: "review-1" } });
    expect(git.fake.pushes()).toBe(0);
    expect(git.discarded).toHaveLength(1);
    expect(fixture.lifecycle).toEqual([]);
    expect(await fixture.workspace.snapshot()).toMatchObject({
      publication: { plan: null },
    });
    expect(
      await review.request({
        decision: "approve",
        type: "review.decide",
        version: 2,
      }),
    ).toMatchObject({ error: { code: "unauthorized" }, ok: false });
  });

  it("retains an uncertain Guard across restart and reconciles by readback only", async () => {
    const git = publisher({
      push: () => ({
        ok: true,
        value: { observed: undefined, pushExitCode: 1, status: "uncertain" },
      }),
    });
    const fixture = await createFixture({
      ids: ["op-1", "grant-1", "op-2", "plan-1", "review-1", "op-3", "op-4"],
      publication: { host: host(), publisher: git.fake },
    });
    await fixture.workspace.request(choose);
    await fixture.workspace.request(prepare);
    await fixture.workspace.request({
      planId: "plan-1",
      type: "publication.review.request",
      version: 2,
    });
    const review = fixture.capabilities.attach(
      {
        endpointId: "review-1",
        reviewId: "review-1",
        role: "review",
        sessionEpoch: "review-epoch",
      },
      () => undefined,
    );
    await review.request({
      decision: "approve",
      type: "review.decide",
      version: 2,
    });
    expect(await fixture.workspace.snapshot()).toMatchObject({
      publication: {
        guard: {
          lastReadback: "uncertain",
          phase: "uncertain",
          plan: { id: "plan-1" },
        },
        lastOutcome: { status: "uncertain" },
      },
    });
    expect(await fixture.workspace.request(prepare)).toMatchObject({
      error: { code: "publication_guarded" },
      ok: false,
    });
    expect((await fixture.records.restore()).publicationGuard).toMatchObject({
      phase: "uncertain",
    });

    // Restart with the same durable records and a fresh coordinator.
    let readbacks = 0;
    const restartedGit = publisher({
      readback: () => {
        readbacks += 1;
        return { observed: CANDIDATE, status: "published" };
      },
    });
    const restarted = await createFixture({
      ids: ["op-r1"],
      publication: { host: host(), publisher: restartedGit.fake },
      records: fixture.records,
    });
    expect(await restarted.workspace.snapshot()).toMatchObject({
      publication: {
        guard: { phase: "uncertain", plan: { id: "plan-1" } },
        source: null,
      },
    });
    expect(
      await restarted.workspace.request({
        type: "publication.reconcile",
        version: 2,
      }),
    ).toEqual({ ok: true, value: { operationId: "op-r1" } });
    expect(readbacks).toBe(1);
    expect(restartedGit.fake.pushes()).toBe(0);
    expect(restarted.lifecycle).toEqual(["publication.guard.replace"]);
    expect(await restarted.workspace.snapshot()).toMatchObject({
      publication: {
        guard: null,
        lastOutcome: { observedCommit: CANDIDATE, status: "published" },
      },
    });
    expect((await restarted.records.restore()).publicationGuard).toBeNull();
  });

  it("export-only stays available without Git and prepare reports git_unavailable", async () => {
    const fixture = await createFixture({
      ids: ["op-1", "grant-1", "op-2"],
      publication: { host: host() },
    });
    await fixture.workspace.request(choose);
    expect(
      await fixture.workspace.request({
        type: "publication.export",
        version: 2,
      }),
    ).toEqual({ ok: true, value: { operationId: "op-2" } });
    expect(await fixture.workspace.snapshot()).toMatchObject({
      publication: {
        export: { destinationLabel: "out", fileCount: 2 },
      },
    });
    expect(await fixture.workspace.request(prepare)).toMatchObject({
      error: { code: "git_unavailable" },
      ok: false,
    });
    expect(fixture.lifecycle).toEqual([]);
  });
});
