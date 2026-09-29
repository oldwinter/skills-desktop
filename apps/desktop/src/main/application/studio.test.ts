import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_MAX_DRAFT_TEXT_LENGTH,
  type StudioTreeEntry,
} from "@skills-desktop/skills-runtime";

import { publicStudioStateSchema } from "../../contracts/workspace.js";
import {
  createMemoryStudioDraftRecords,
  type StudioDraftRecords,
} from "../persistence/studio-draft-records.js";
import type { FolderPick } from "./publication.js";
import {
  createStudioCoordinator,
  draftSkillName,
  type StudioHost,
} from "./studio.js";

const encoder = new TextEncoder();

const SKILL_MD = `---
name: demo-skill
description: Demo.
---

# Demo
`;

function file(path: string, text: string): StudioTreeEntry {
  const bytes = encoder.encode(text);
  return { bytes, kind: "file", path, size: bytes.byteLength };
}

function fakeHost(overrides: Partial<StudioHost> = {}) {
  const picks: FolderPick[] = [];
  const host: StudioHost & { picks: FolderPick[] } = {
    picks,
    chooseExportParent: vi.fn(
      async (): Promise<FolderPick> => picks.shift() ?? { status: "cancelled" },
    ),
    chooseSkillFolder: vi.fn(
      async (): Promise<FolderPick> => picks.shift() ?? { status: "cancelled" },
    ),
    exportSkill: vi.fn(async (_parent, _name, files) => ({
      ok: true as const,
      value: { fileCount: files.length },
    })),
    readTree: vi.fn(async () => ({
      ok: true as const,
      value: [file("SKILL.md", SKILL_MD)],
    })),
    ...overrides,
  };
  return host;
}

function harness(host?: StudioHost, drafts?: StudioDraftRecords) {
  let ids = 0;
  let now = Date.parse("2026-09-15T10:00:00.000Z");
  const onChange = vi.fn();
  const records = drafts ?? createMemoryStudioDraftRecords();
  const studio = createStudioCoordinator({
    clock: () => new Date((now += 1_000)),
    drafts: records,
    ...(host === undefined ? {} : { host }),
    id: () => `id-${(ids += 1)}`,
    onChange,
  });
  return { drafts: records, onChange, studio };
}

describe("createStudioCoordinator (ADR 0018)", () => {
  it("is unavailable without a host and still keeps Drafts", async () => {
    const { studio } = harness();
    await studio.initialize();
    expect(studio.state().available).toBe(false);
    expect(await studio.open("w1")).toMatchObject({
      error: { code: "studio_unavailable" },
      ok: false,
    });
    expect((await studio.createDraft("w1")).ok).toBe(true);
    expect(studio.state().drafts).toHaveLength(1);
  });

  it("opens a folder as an opaque grant bound to the endpoint", async () => {
    const host = fakeHost();
    host.picks.push({
      label: "demo-skill",
      path: "/secret/demo-skill",
      status: "picked",
    });
    const { studio } = harness(host);
    const result = await studio.open("w1");
    expect(result.ok).toBe(true);
    const state = studio.state();
    expect(publicStudioStateSchema.safeParse(state).success).toBe(true);
    expect(state.grants).toHaveLength(1);
    const grant = state.grants[0]!;
    expect(grant).toMatchObject({ label: "demo-skill", purpose: "author" });
    expect(grant.validation).toMatchObject({ name: "demo-skill", ok: true });
    expect(JSON.stringify(state)).not.toContain("/secret");
    expect(host.readTree).toHaveBeenCalledWith("/secret/demo-skill");

    expect(await studio.validate("w2", grant.id)).toMatchObject({
      error: { code: "studio_grant_invalid" },
      ok: false,
    });
    expect(await studio.release("w2", grant.id)).toMatchObject({
      error: { code: "studio_grant_invalid" },
      ok: false,
    });
    expect((await studio.validate("w1", grant.id)).ok).toBe(true);
    studio.releaseGrantsFor("w1");
    expect(studio.state().grants).toEqual([]);
    expect(await studio.validate("w1", grant.id)).toMatchObject({
      error: { code: "studio_grant_invalid" },
      ok: false,
    });
  });

  it("surfaces fail-closed findings from the observed tree", async () => {
    const host = fakeHost({
      readTree: vi.fn(async () => ({
        ok: true as const,
        value: [
          file("SKILL.md", SKILL_MD),
          { kind: "symlink" as const, path: "escape", size: 0 },
        ],
      })),
    });
    host.picks.push({ label: "demo-skill", path: "/p", status: "picked" });
    const { studio } = harness(host);
    await studio.open("w1");
    const grant = studio.state().grants[0]!;
    expect(grant.validation.ok).toBe(false);
    expect(grant.validation.findings.map(({ code }) => code)).toEqual([
      "symlink",
    ]);
  });

  it("treats a cancelled dialog as a no-op", async () => {
    const host = fakeHost();
    const { studio } = harness(host);
    expect((await studio.open("w1")).ok).toBe(true);
    expect(studio.state().grants).toEqual([]);
    expect(studio.state().lastError).toBeNull();
  });

  it("creates, autosaves with compare-and-swap, previews, and deletes Drafts", async () => {
    const { drafts, studio } = harness(fakeHost());
    await studio.initialize();
    expect((await studio.createDraft("w1")).ok).toBe(true);
    const created = studio.state().drafts[0]!;
    expect(created).toMatchObject({ name: "my-skill", revision: 1 });
    expect(created.validation.ok).toBe(true);

    const saved = await studio.saveDraft(created.id, 1, SKILL_MD);
    expect(saved.ok).toBe(true);
    const updated = studio.state().drafts[0]!;
    expect(updated).toMatchObject({ name: "demo-skill", revision: 2 });
    expect((await drafts.restore()).drafts[0]).toMatchObject({ revision: 2 });

    expect(await studio.saveDraft(created.id, 1, "stale")).toMatchObject({
      error: { code: "studio_draft_conflict" },
      ok: false,
    });
    expect(studio.state().lastError?.code).toBe("studio_draft_conflict");

    expect((await studio.preview(created.id)).ok).toBe(true);
    expect(studio.state().preview).toMatchObject({
      draftId: created.id,
      preview: { blocks: [{ kind: "heading", level: 1 }] },
      revision: 2,
    });
    await studio.saveDraft(created.id, 2, `${SKILL_MD}\nMore text.\n`);
    expect(studio.state().preview).toMatchObject({
      preview: { blocks: [{ kind: "heading" }, { kind: "paragraph" }] },
      revision: 3,
    });

    expect(await studio.deleteDraft(created.id, 2)).toMatchObject({
      error: { code: "studio_draft_conflict" },
      ok: false,
    });
    expect((await studio.deleteDraft(created.id, 3)).ok).toBe(true);
    expect(studio.state().drafts).toEqual([]);
    expect(studio.state().preview).toBeNull();
  });

  it("seeds a Draft from a granted folder's SKILL.md", async () => {
    const host = fakeHost();
    host.picks.push({ label: "demo-skill", path: "/p", status: "picked" });
    const { studio } = harness(host);
    await studio.open("w1");
    const grant = studio.state().grants[0]!;
    expect(await studio.createDraft("w2", grant.id)).toMatchObject({
      error: { code: "studio_grant_invalid" },
      ok: false,
    });
    expect((await studio.createDraft("w1", grant.id)).ok).toBe(true);
    expect(studio.state().drafts[0]).toMatchObject({
      name: "demo-skill",
      skillMd: SKILL_MD,
    });
  });

  it("exports only valid Drafts through the host and records a label", async () => {
    const host = fakeHost();
    const { studio } = harness(host);
    await studio.createDraft("w1");
    const draft = studio.state().drafts[0]!;
    await studio.saveDraft(draft.id, 1, "# no frontmatter\n");
    expect(await studio.exportDraft(draft.id)).toMatchObject({
      error: { code: "studio_validation_failed" },
      ok: false,
    });
    expect(host.exportSkill).not.toHaveBeenCalled();

    await studio.saveDraft(draft.id, 2, SKILL_MD);
    host.picks.push({ label: "out", path: "/out", status: "picked" });
    expect((await studio.exportDraft(draft.id)).ok).toBe(true);
    expect(host.exportSkill).toHaveBeenCalledWith("/out", "demo-skill", [
      { bytes: encoder.encode(SKILL_MD), path: "SKILL.md" },
    ]);
    expect(studio.state().lastExport).toMatchObject({
      destinationLabel: "out",
      draftId: draft.id,
      fileCount: 1,
      name: "demo-skill",
    });
    expect(JSON.stringify(studio.state())).not.toContain("/out");
  });

  it("reports export failures without leaving state half-updated", async () => {
    const host = fakeHost({
      exportSkill: vi.fn(async () => ({
        error: {
          code: "studio_export_failed" as const,
          effects: "none" as const,
          message: "nope",
          phase: "export",
          retryable: false,
        },
        ok: false as const,
      })),
    });
    const { studio } = harness(host);
    await studio.createDraft("w1");
    const draft = studio.state().drafts[0]!;
    host.picks.push({ label: "out", path: "/out", status: "picked" });
    expect(await studio.exportDraft(draft.id)).toMatchObject({
      error: { code: "studio_export_failed" },
      ok: false,
    });
    expect(studio.state().lastExport).toBeNull();
    expect(studio.state().lastError?.code).toBe("studio_export_failed");
  });

  it("treats a cancelled export pick as a no-op without host writes", async () => {
    const host = fakeHost();
    const { studio } = harness(host);
    await studio.createDraft("w1");
    const draft = studio.state().drafts[0]!;
    await studio.saveDraft(draft.id, 1, SKILL_MD);

    const cancelled = await studio.exportDraft(draft.id);
    expect(cancelled).toMatchObject({ ok: true });
    expect(host.chooseExportParent).toHaveBeenCalledOnce();
    expect(host.exportSkill).not.toHaveBeenCalled();
    expect(studio.state().lastExport).toBeNull();
    expect(studio.state().lastError).toBeNull();
  });

  it("rejects draft text over the bounded length before touching records", async () => {
    const { studio } = harness();
    await studio.createDraft("w1");
    const draft = studio.state().drafts[0]!;
    const huge = `${"x".repeat(128 * 1_024 + 1)}`;
    expect(
      await studio.saveDraft(draft.id, 1, huge),
    ).toMatchObject({
      error: { code: "studio_draft_invalid" },
      ok: false,
    });
    // The draft keeps its original text; nothing was persisted.
    expect(
      studio.state().drafts.find(({ id }) => id === draft.id)?.skillMd,
    ).toBe(draft.skillMd);
  });

  it("surfaces a failed records put without advancing the draft revision", async () => {
    const memory = createMemoryStudioDraftRecords();
    // createDraft (expectedRevision null) succeeds; the revision-bumping
    // saveDraft put fails, so the in-memory draft must stay at revision 1.
    const failingPut = vi.fn(
      async (
        record: Parameters<StudioDraftRecords["put"]>[0],
        expectedRevision: number | null,
      ) =>
        expectedRevision === null
          ? memory.put(record, expectedRevision)
          : {
              error: {
                code: "persist_failed" as const,
                effects: "none" as const,
                message: "disk full",
                phase: "persist" as const,
                retryable: true,
              },
              ok: false as const,
            },
    );
    const { studio } = harness(fakeHost(), {
      ...memory,
      put: failingPut,
    });
    await studio.createDraft("w1");
    const draft = studio.state().drafts[0]!;

    const saved = await studio.saveDraft(draft.id, 1, "# updated\n");
    expect(saved).toMatchObject({ ok: false });
    expect(studio.state().lastError?.message).toBe("disk full");
    expect(
      studio.state().drafts.find(({ id }) => id === draft.id)?.revision,
    ).toBe(1);
  });

  it("serializes host-backed steps and clears grants on shutdown", async () => {
    let release!: (pick: FolderPick) => void;
    const host = fakeHost({
      chooseSkillFolder: vi.fn(
        () =>
          new Promise<FolderPick>((resolve) => {
            release = resolve;
          }),
      ),
    });
    const { studio } = harness(host);
    const first = studio.open("w1");
    expect(studio.busy()).toBe(true);
    expect(await studio.open("w1")).toMatchObject({
      error: { code: "mutation_conflict" },
      ok: false,
    });
    release({ label: "demo-skill", path: "/p", status: "picked" });
    expect((await first).ok).toBe(true);
    expect(studio.state().grants).toHaveLength(1);
    await studio.shutdown();
    expect(studio.state().grants).toEqual([]);
  });

  it("does not revive a grant released while revalidation is still reading", async () => {
    type ReadResult = Awaited<ReturnType<StudioHost["readTree"]>>;
    const pendingReads: Array<(result: ReadResult) => void> = [];
    const host = fakeHost({
      readTree: vi.fn(
        () => new Promise<ReadResult>((resolve) => pendingReads.push(resolve)),
      ),
    });
    host.picks.push({ label: "demo-skill", path: "/p", status: "picked" });
    const { studio } = harness(host);
    const opening = studio.open("w1");
    await vi.waitFor(() => expect(pendingReads).toHaveLength(1));
    pendingReads[0]!({ ok: true, value: [file("SKILL.md", SKILL_MD)] });
    expect((await opening).ok).toBe(true);
    const grant = studio.state().grants[0]!;

    const validating = studio.validate("w1", grant.id);
    await vi.waitFor(() => expect(pendingReads).toHaveLength(2));
    expect((await studio.release("w1", grant.id)).ok).toBe(true);
    pendingReads[1]!({ ok: true, value: [file("SKILL.md", SKILL_MD)] });
    expect(await validating).toMatchObject({
      error: { code: "studio_grant_invalid" },
      ok: false,
    });
    expect(studio.state().grants).toEqual([]);
  });

  it("does not publish a grant for an endpoint released during the dialog", async () => {
    let finishPick!: (pick: FolderPick) => void;
    const host = fakeHost({
      chooseSkillFolder: vi.fn(
        () =>
          new Promise<FolderPick>((resolve) => {
            finishPick = resolve;
          }),
      ),
    });
    const { studio } = harness(host);
    const opening = studio.open("w1");
    studio.releaseGrantsFor("w1");
    finishPick({ label: "demo-skill", path: "/p", status: "picked" });
    expect(await opening).toMatchObject({
      error: { code: "studio_grant_invalid" },
      ok: false,
    });
    expect(studio.state().grants).toEqual([]);
    expect(host.readTree).not.toHaveBeenCalled();
  });

  it("does not publish a grant for an endpoint released while reading", async () => {
    type ReadResult = Awaited<ReturnType<StudioHost["readTree"]>>;
    const pendingReads: Array<(result: ReadResult) => void> = [];
    const host = fakeHost({
      readTree: vi.fn(
        () => new Promise<ReadResult>((resolve) => pendingReads.push(resolve)),
      ),
    });
    host.picks.push({ label: "demo-skill", path: "/p", status: "picked" });
    const { studio } = harness(host);
    const opening = studio.open("w1");
    await vi.waitFor(() => expect(pendingReads).toHaveLength(1));
    studio.releaseGrantsFor("w1");
    pendingReads[0]!({ ok: true, value: [file("SKILL.md", SKILL_MD)] });
    expect(await opening).toMatchObject({
      error: { code: "studio_grant_invalid" },
      ok: false,
    });
    expect(studio.state().grants).toEqual([]);
  });

  it("does not revive a grant when shutdown lands during a read", async () => {
    type ReadResult = Awaited<ReturnType<StudioHost["readTree"]>>;
    const pendingReads: Array<(result: ReadResult) => void> = [];
    const host = fakeHost({
      readTree: vi.fn(
        () => new Promise<ReadResult>((resolve) => pendingReads.push(resolve)),
      ),
    });
    host.picks.push({ label: "demo-skill", path: "/p", status: "picked" });
    const { studio } = harness(host);
    const opening = studio.open("w1");
    await vi.waitFor(() => expect(pendingReads).toHaveLength(1));
    pendingReads[0]!({ ok: true, value: [file("SKILL.md", SKILL_MD)] });
    expect((await opening).ok).toBe(true);
    const grant = studio.state().grants[0]!;

    const validating = studio.validate("w1", grant.id);
    await vi.waitFor(() => expect(pendingReads).toHaveLength(2));
    await studio.shutdown();
    pendingReads[1]!({ ok: true, value: [file("SKILL.md", SKILL_MD)] });
    expect(await validating).toMatchObject({
      error: { code: "studio_grant_invalid" },
      ok: false,
    });
    expect(studio.state().grants).toEqual([]);
    expect(await studio.open("w1")).toMatchObject({
      error: { code: "studio_unavailable" },
      ok: false,
    });
  });

  it("restores Drafts and quarantined ids without content", async () => {
    const drafts = createMemoryStudioDraftRecords([
      {
        createdAt: "2026-09-15T09:00:00.000Z",
        id: "restored",
        name: "demo-skill",
        revision: 4,
        schemaVersion: 1,
        skillMd: SKILL_MD,
        updatedAt: "2026-09-15T09:00:00.000Z",
      },
    ]);
    const studio = createStudioCoordinator({
      clock: () => new Date(),
      drafts,
      id: () => "x",
      onChange: () => undefined,
    });
    await studio.initialize();
    expect(studio.state().drafts).toMatchObject([
      { id: "restored", revision: 4 },
    ]);
  });

  it("fails closed when a granted folder has no readable SKILL.md", async () => {
    const host = fakeHost({
      readTree: vi.fn(async () => ({
        ok: true as const,
        value: [file("README.md", "# no skill here\n")],
      })),
    });
    host.picks.push({
      label: "demo",
      path: "/secret/demo",
      status: "picked",
    });
    const { studio } = harness(host);
    await studio.initialize();
    await studio.open("w1");
    const grant = studio.state().grants[0]!;
    expect(await studio.createDraft("w1", grant.id)).toMatchObject({
      error: { code: "studio_validation_failed" },
      ok: false,
    });
    expect(studio.state().drafts).toHaveLength(0);
  });

  it("fails closed when a granted SKILL.md is not valid UTF-8", async () => {
    const bad: StudioTreeEntry = {
      bytes: new Uint8Array([0xff, 0xfe, 0xfa]),
      kind: "file",
      path: "SKILL.md",
      size: 3,
    };
    const host = fakeHost({
      readTree: vi.fn(async () => ({ ok: true as const, value: [bad] })),
    });
    host.picks.push({
      label: "demo",
      path: "/secret/demo",
      status: "picked",
    });
    const { studio } = harness(host);
    await studio.initialize();
    await studio.open("w1");
    const grant = studio.state().grants[0]!;
    expect(await studio.createDraft("w1", grant.id)).toMatchObject({
      error: { code: "studio_validation_failed" },
      ok: false,
    });
  });

  it("rejects a granted SKILL.md above the Draft text limit", async () => {
    const host = fakeHost({
      readTree: vi.fn(async () => ({
        ok: true as const,
        value: [
          file(
            "SKILL.md",
            `---\nname: demo\ndescription: d.\n---\n\n${"x".repeat(STUDIO_MAX_DRAFT_TEXT_LENGTH + 1)}`,
          ),
        ],
      })),
    });
    host.picks.push({
      label: "demo",
      path: "/secret/demo",
      status: "picked",
    });
    const { studio } = harness(host);
    await studio.initialize();
    await studio.open("w1");
    const grant = studio.state().grants[0]!;
    expect(await studio.createDraft("w1", grant.id)).toMatchObject({
      error: { code: "studio_draft_invalid" },
      ok: false,
    });
    expect(studio.state().drafts).toHaveLength(0);
  });

  it("surfaces a failed put inside createDraft without adding a Draft", async () => {
    const memory = createMemoryStudioDraftRecords();
    const stored = {
      code: "persist_failed" as const,
      effects: "none" as const,
      message: "The draft could not be persisted.",
      phase: "studio" as const,
      retryable: true,
    };
    const drafts: StudioDraftRecords = {
      ...memory,
      put: vi.fn(async () => ({ error: stored, ok: false as const })),
    };
    const { studio } = harness(undefined, drafts);
    await studio.initialize();
    expect(await studio.createDraft("w1")).toMatchObject({
      error: { code: "persist_failed" },
      ok: false,
    });
    expect(studio.state().drafts).toHaveLength(0);
    expect(studio.state().lastError?.code).toBe("persist_failed");
  });
});

describe("draftSkillName", () => {
  it("returns the frontmatter name only when it is a valid Skill name", () => {
    expect(draftSkillName(SKILL_MD)).toBe("demo-skill");
    expect(draftSkillName(SKILL_MD.replace("demo-skill", "Bad Name"))).toBe("");
    expect(draftSkillName("no frontmatter")).toBe("");
  });
});
