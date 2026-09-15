import { describe, expect, it } from "vitest";

import {
  verifyPublicationPlan,
  type PublicationPlanV1,
  type WellKnownSkillInput,
} from "@skills-desktop/skills-runtime";

import { createNodeWellKnownCodec } from "../adapters/node-well-known-codec.js";
import type {
  GitPublisher,
  PreparedPublication,
  PublicationReadback,
  PushPublicationOutcome,
} from "../git/git-publisher.js";
import { publicationGuardRecordSchema } from "../persistence/publication-guard-records.js";
import { publicPublicationStateSchema } from "../../contracts/workspace.js";
import {
  createPublicationCoordinator,
  type FolderPick,
  type PublicationHost,
} from "./publication.js";

const codec = createNodeWellKnownCodec();
const BASE = "a".repeat(40);
const CANDIDATE = "c".repeat(40);
const encoder = new TextEncoder();

const skills: readonly WellKnownSkillInput[] = [
  {
    files: [
      {
        bytes: encoder.encode(
          "---\nname: hello\ndescription: Says hello.\n---\n# Hello\n",
        ),
        path: "SKILL.md",
      },
    ],
    name: "hello",
  },
];

function fakeHost(overrides: Partial<PublicationHost> = {}): PublicationHost & {
  readonly written: { destination: string; paths: string[] }[];
} {
  const written: { destination: string; paths: string[] }[] = [];
  return {
    written,
    async chooseSourceFolder(): Promise<FolderPick> {
      return { label: "skills", path: "/private/skills", status: "picked" };
    },
    async chooseExportDestination(): Promise<FolderPick> {
      return { label: "out", path: "/private/out", status: "picked" };
    },
    async readSourceFolder() {
      return { ok: true, value: skills };
    },
    async writeExport(destination, files) {
      written.push({ destination, paths: files.map(({ path }) => path) });
      return { ok: true, value: undefined };
    },
    ...overrides,
  };
}

interface FakePublisher extends GitPublisher {
  readonly discarded: PreparedPublication[];
  pushResult: Awaited<ReturnType<GitPublisher["push"]>>;
  readbackResult: PublicationReadback;
  readonly pushes: number;
}

function fakePublisher(): FakePublisher {
  const discarded: PreparedPublication[] = [];
  let pushes = 0;
  const publisher: FakePublisher = {
    discarded,
    get pushes() {
      return pushes;
    },
    pushResult: {
      ok: true,
      value: {
        observed: CANDIDATE,
        pushExitCode: 0,
        status: "published",
      } satisfies PushPublicationOutcome,
    },
    readbackResult: { observed: CANDIDATE, status: "published" },
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
          root: "/tmp/owned-root",
        },
      };
    },
    async push() {
      pushes += 1;
      return publisher.pushResult;
    },
    async readback() {
      return publisher.readbackResult;
    },
  };
  return publisher;
}

function harness(input: {
  host?: PublicationHost | undefined;
  publisher?: GitPublisher | undefined;
  initialGuard?: Parameters<typeof publicationGuardRecordSchema.parse>[0];
  failCommit?: boolean;
}) {
  const guards: unknown[] = [];
  let changes = 0;
  let counter = 0;
  let now = Date.parse("2026-09-15T10:00:00.000Z");
  const coordinator = createPublicationCoordinator({
    clock: () => new Date(now),
    codec,
    async commitGuard(guard) {
      if (input.failCommit === true) {
        return {
          error: {
            code: "persist_failed",
            effects: "none",
            message: "disk full",
            phase: "persist",
            retryable: true,
          },
          ok: false,
        };
      }
      guards.push(guard);
      return { ok: true, value: undefined };
    },
    ...(input.host === undefined ? {} : { host: input.host }),
    id: () => `id-${(counter += 1)}`,
    ...(input.initialGuard === undefined
      ? {}
      : {
          initialGuard: publicationGuardRecordSchema.parse(input.initialGuard),
        }),
    onChange: () => {
      changes += 1;
    },
    ...(input.publisher === undefined ? {} : { publisher: input.publisher }),
  });
  return {
    advance(ms: number) {
      now += ms;
    },
    get changes() {
      return changes;
    },
    coordinator,
    guards,
  };
}

async function planned(publisher = fakePublisher()) {
  const host = fakeHost();
  const h = harness({ host, publisher });
  expect((await h.coordinator.chooseSource()).ok).toBe(true);
  const prepared = await h.coordinator.prepare(
    "https://github.com/acme/skills.git",
    "main",
  );
  expect(prepared.ok).toBe(true);
  const plan = h.coordinator.state().plan;
  if (plan === null) throw new Error("plan expected");
  return { ...h, host, plan, publisher };
}

describe("publication coordinator (ADR 0019 / ADR 0020)", () => {
  it("starts unavailable without a host and refuses every step", async () => {
    const h = harness({});
    expect(h.coordinator.state()).toMatchObject({
      available: false,
      phase: "idle",
    });
    for (const result of [
      await h.coordinator.chooseSource(),
      await h.coordinator.export(),
      await h.coordinator.prepare("https://example.com/x.git", "main"),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("publication_unavailable");
    }
  });

  it("derives a source grant from a chosen folder without exposing the path", async () => {
    const host = fakeHost();
    const h = harness({ host });
    const result = await h.coordinator.chooseSource();
    expect(result.ok).toBe(true);
    const state = h.coordinator.state();
    expect(publicPublicationStateSchema.safeParse(state).success).toBe(true);
    expect(state.source).toMatchObject({
      exporterVersion: 1,
      fileCount: 2,
      label: "skills",
      skills: ["hello"],
    });
    expect(JSON.stringify(state)).not.toContain("/private/skills");
    expect(state.available).toBe(true);
  });

  it("treats a cancelled folder dialog as a no-op", async () => {
    const host = fakeHost({
      async chooseSourceFolder() {
        return { status: "cancelled" };
      },
    });
    const h = harness({ host });
    expect((await h.coordinator.chooseSource()).ok).toBe(true);
    expect(h.coordinator.state().source).toBeNull();
    expect(h.coordinator.state().lastError).toBeNull();
  });

  it("reports export validation failures as export_invalid", async () => {
    const host = fakeHost({
      async readSourceFolder() {
        return { ok: true, value: [] };
      },
    });
    const h = harness({ host });
    const result = await h.coordinator.chooseSource();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("export_invalid");
    expect(h.coordinator.state().lastError?.code).toBe("export_invalid");
    expect(h.coordinator.state().source).toBeNull();
  });

  it("export-only writes the exact tree and invokes no Git", async () => {
    const host = fakeHost();
    const h = harness({ host });
    expect((await h.coordinator.chooseSource()).ok).toBe(true);
    expect((await h.coordinator.export()).ok).toBe(true);
    expect(host.written).toEqual([
      {
        destination: "/private/out",
        paths: [
          ".well-known/agent-skills/hello/SKILL.md",
          ".well-known/agent-skills/index.json",
        ],
      },
    ]);
    const state = h.coordinator.state();
    expect(state.export).toMatchObject({
      destinationLabel: "out",
      fileCount: 2,
      treeDigest: state.source?.treeDigest,
    });
    expect(JSON.stringify(state)).not.toContain("/private/out");
  });

  it("refuses export before a source is chosen", async () => {
    const h = harness({ host: fakeHost() });
    const result = await h.coordinator.export();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("export_invalid");
  });

  it("reports git_unavailable for prepare when only export is wired", async () => {
    const h = harness({ host: fakeHost() });
    expect((await h.coordinator.chooseSource()).ok).toBe(true);
    const result = await h.coordinator.prepare(
      "https://github.com/acme/skills.git",
      "main",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("git_unavailable");
  });

  it("sanitizes remote and branch before any Git call", async () => {
    const publisher = fakePublisher();
    const h = harness({ host: fakeHost(), publisher });
    expect((await h.coordinator.chooseSource()).ok).toBe(true);
    const badRemote = await h.coordinator.prepare("file:///tmp/repo", "main");
    expect(badRemote.ok).toBe(false);
    if (!badRemote.ok) expect(badRemote.error.code).toBe("remote_unsupported");
    const badBranch = await h.coordinator.prepare(
      "https://github.com/acme/skills.git",
      "refs/heads/main",
    );
    expect(badBranch.ok).toBe(false);
    if (!badBranch.ok) expect(badBranch.error.code).toBe("branch_unsupported");
    expect(h.coordinator.state().plan).toBeNull();
  });

  it("seals a verifiable PublicationPlanV1 bound to the export digests", async () => {
    const { coordinator, plan } = await planned();
    expect(verifyPublicationPlan(plan, codec.sha256Hex)).toBe(true);
    expect(plan).toMatchObject({
      base: { commit: BASE, kind: "commit" },
      branch: "main",
      candidateCommit: CANDIDATE,
      ref: "refs/heads/main",
      remote: { host: "github.com", kind: "https" },
      schemaVersion: 1,
      skills: ["hello"],
    });
    expect(plan.files.map(({ path }) => path)).toEqual([
      ".well-known/agent-skills/hello/SKILL.md",
      ".well-known/agent-skills/index.json",
    ]);
    expect(coordinator.planForReview(plan.id)).toEqual(plan);
    expect(coordinator.planForReview("other")).toBeUndefined();
    expect(coordinator.state().phase).toBe("planned");
  });

  it("expires the plan for review after its TTL", async () => {
    const { advance, coordinator, plan } = await planned();
    advance(10 * 60_000);
    expect(coordinator.planForReview(plan.id)).toBeUndefined();
    const result = await coordinator.approve(plan.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("publication_invalid");
    expect(coordinator.state().plan).toBeNull();
  });

  it("commits the Guard before pushing and releases it on a published readback", async () => {
    const { coordinator, guards, plan, publisher } = await planned();
    const result = await coordinator.approve(plan.id);
    expect(result.ok).toBe(true);
    expect(publisher.pushes).toBe(1);
    expect(guards).toHaveLength(2);
    expect(guards[0]).toMatchObject({ phase: "pushing", plan });
    expect(guards[1]).toBeNull();
    expect(publisher.discarded).toHaveLength(1);
    const state = coordinator.state();
    expect(state.guard).toBeNull();
    expect(state.plan).toBeNull();
    expect(state.phase).toBe("idle");
    expect(state.lastOutcome).toMatchObject({
      candidateCommit: CANDIDATE,
      observedCommit: CANDIDATE,
      planId: plan.id,
      status: "published",
    });
    expect(publicPublicationStateSchema.safeParse(state).success).toBe(true);
  });

  it("never pushes when the Guard cannot be committed", async () => {
    const publisher = fakePublisher();
    const host = fakeHost();
    const h = harness({ failCommit: true, host, publisher });
    expect((await h.coordinator.chooseSource()).ok).toBe(true);
    expect(
      (
        await h.coordinator.prepare(
          "https://github.com/acme/skills.git",
          "main",
        )
      ).ok,
    ).toBe(true);
    const plan = h.coordinator.state().plan;
    const result = await h.coordinator.approve(plan?.id ?? "");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("persist_failed");
    expect(publisher.pushes).toBe(0);
  });

  it("releases the Guard when drift is detected before transport", async () => {
    const publisher = fakePublisher();
    publisher.pushResult = {
      error: {
        code: "publication_drift",
        effects: "none",
        message: "moved",
        phase: "fetch",
        retryable: true,
      },
      ok: false,
    };
    const { coordinator, guards, plan } = await planned(publisher);
    const result = await coordinator.approve(plan.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("publication_drift");
    expect(guards.at(-1)).toBeNull();
    expect(coordinator.state()).toMatchObject({
      guard: null,
      plan: null,
      lastError: { code: "publication_drift" },
    });
  });

  it("retains an uncertain Guard, blocks a second plan, and reconciles by readback only", async () => {
    const publisher = fakePublisher();
    publisher.pushResult = {
      ok: true,
      value: { observed: undefined, pushExitCode: 1, status: "uncertain" },
    };
    const { coordinator, guards, plan } = await planned(publisher);
    expect((await coordinator.approve(plan.id)).ok).toBe(true);
    expect(guards.at(-1)).toMatchObject({
      lastReadback: "uncertain",
      phase: "uncertain",
      plan,
    });
    expect(coordinator.state().guard?.phase).toBe("uncertain");
    expect(coordinator.state().lastOutcome?.status).toBe("uncertain");
    expect(coordinator.guarded()).toBe(true);

    const blocked = await coordinator.prepare(
      "https://github.com/acme/skills.git",
      "main",
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("publication_guarded");

    publisher.readbackResult = { observed: undefined, status: "uncertain" };
    const stillUncertain = await coordinator.reconcile();
    expect(stillUncertain.ok).toBe(false);
    expect(coordinator.state().guard?.lastReadback).toBe("uncertain");

    publisher.readbackResult = { observed: CANDIDATE, status: "published" };
    const reconciled = await coordinator.reconcile();
    expect(reconciled.ok).toBe(true);
    expect(publisher.pushes).toBe(1);
    expect(coordinator.state().guard).toBeNull();
    expect(coordinator.state().lastOutcome?.status).toBe("published");
    expect(coordinator.guarded()).toBe(false);
  });

  it("restores a durable Guard and reconciles it without a source", async () => {
    const publisher = fakePublisher();
    const { plan } = await planned();
    const restored = harness({
      host: fakeHost(),
      initialGuard: {
        committedAt: "2026-09-15T09:00:00.000Z",
        lastReadback: "uncertain",
        lastReadbackAt: "2026-09-15T09:00:05.000Z",
        phase: "uncertain",
        plan: plan as PublicationPlanV1,
      },
      publisher,
    });
    expect(restored.coordinator.state().guard?.plan.id).toBe(plan.id);
    expect(restored.coordinator.guarded()).toBe(true);
    publisher.readbackResult = { observed: BASE, status: "not-published" };
    expect((await restored.coordinator.reconcile()).ok).toBe(true);
    expect(restored.coordinator.state().guard).toBeNull();
    expect(restored.coordinator.state().lastOutcome?.status).toBe(
      "not-published",
    );
  });

  it("discards the prepared root when the plan is rejected", async () => {
    const { coordinator, plan, publisher } = await planned();
    expect((await coordinator.discard("wrong")).ok).toBe(false);
    expect((await coordinator.discard(plan.id)).ok).toBe(true);
    expect(publisher.discarded).toHaveLength(1);
    expect(coordinator.state().plan).toBeNull();
    expect(coordinator.planForReview(plan.id)).toBeUndefined();
  });

  it("discards a stale plan when the source changes and on shutdown", async () => {
    const { coordinator, publisher } = await planned();
    expect((await coordinator.chooseSource()).ok).toBe(true);
    expect(publisher.discarded).toHaveLength(1);
    expect(coordinator.state().plan).toBeNull();
    await coordinator.shutdown();
    expect(publisher.discarded).toHaveLength(1);
  });

  it("serializes concurrent steps", async () => {
    let release: (() => void) | undefined;
    const host = fakeHost({
      chooseSourceFolder: () =>
        new Promise<FolderPick>((resolve) => {
          release = () =>
            resolve({ label: "skills", path: "/p", status: "picked" });
        }),
    });
    const h = harness({ host });
    const first = h.coordinator.chooseSource();
    const second = await h.coordinator.chooseSource();
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("mutation_conflict");
    release?.();
    expect((await first).ok).toBe(true);
  });
});
