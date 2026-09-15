import { describe, expect, it } from "vitest";

import type {
  Inventory,
  StudioTreeEntry,
} from "@skills-desktop/skills-runtime";

import type { SkillsProcess } from "../adapters/local-skills-process.js";
import { createMemoryRecoveryRecords } from "../persistence/recovery-records.js";
import {
  createMemoryStudioDraftRecords,
  type StudioDraftRecords,
} from "../persistence/studio-draft-records.js";
import { createSkillsTargetsCatalog } from "../targets/local-skills-targets.js";
import {
  createDesktopCapabilities,
  type TargetDefinition,
} from "./desktop-capabilities.js";
import type { StudioHost } from "./studio.js";

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

const SKILL_MD = "---\nname: hello\ndescription: Says hello.\n---\n\n# Hello\n";
const encoder = new TextEncoder();

function tree(...extra: StudioTreeEntry[]): StudioTreeEntry[] {
  const bytes = encoder.encode(SKILL_MD);
  return [
    { bytes, kind: "file", path: "SKILL.md", size: bytes.byteLength },
    ...extra,
  ];
}

function host(entries = tree()) {
  const exports: { name: string; parent: string; paths: string[] }[] = [];
  const fake: StudioHost & { readonly exports: typeof exports } = {
    exports,
    async chooseExportParent() {
      return { label: "out", path: "/private/out", status: "picked" };
    },
    async chooseSkillFolder() {
      return { label: "hello", path: "/private/hello", status: "picked" };
    },
    async exportSkill(parent, name, files) {
      exports.push({ name, parent, paths: files.map(({ path }) => path) });
      return { ok: true, value: { fileCount: files.length } };
    },
    async readTree() {
      return { ok: true, value: entries };
    },
  };
  return fake;
}

async function createFixture(options: {
  readonly ids: readonly string[];
  readonly studio?: {
    readonly drafts: StudioDraftRecords;
    readonly host?: StudioHost;
  };
}) {
  const ids = [...options.ids];
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
  const capabilities = createDesktopCapabilities({
    clock: () => new Date("2026-08-21T10:00:00.000Z"),
    id: () => ids.shift() ?? "unexpected-id",
    recoveryRecords: createMemoryRecoveryRecords(),
    skillsTargets: createSkillsTargetsCatalog({
      id: () => "00000000-0000-4000-8000-000000000010",
      initialTarget: target,
      processFor: () => process,
    }),
    ...(options.studio === undefined ? {} : { studio: options.studio }),
  });
  await capabilities.initialize();
  const attach = (endpointId: string) =>
    capabilities.attach(
      { endpointId, role: "workspace", sessionEpoch: `${endpointId}-epoch` },
      () => undefined,
    );
  return { attach, capabilities, workspace: attach("workspace-1") };
}

const open = { type: "studio.open", version: 2 } as const;

describe("DesktopCapabilities Studio contract (ADR 0018)", () => {
  it("omits the studio projection and refuses requests when not wired", async () => {
    const fixture = await createFixture({ ids: [] });
    expect(await fixture.workspace.snapshot()).not.toHaveProperty("studio");
    expect(await fixture.workspace.request(open)).toMatchObject({
      error: { code: "studio_unavailable" },
      ok: false,
    });
  });

  it("hands the renderer an opaque grant with findings and never a path", async () => {
    const studioHost = host(tree({ kind: "symlink", path: "escape", size: 0 }));
    const fixture = await createFixture({
      ids: ["op-1", "grant-1"],
      studio: { drafts: createMemoryStudioDraftRecords(), host: studioHost },
    });
    expect(await fixture.workspace.request(open)).toEqual({
      ok: true,
      value: { operationId: "op-1" },
    });
    const snapshot = await fixture.workspace.snapshot();
    expect(snapshot).toMatchObject({
      studio: {
        available: true,
        grants: [
          {
            id: "grant-1",
            label: "hello",
            purpose: "author",
            validation: {
              findings: [{ code: "symlink", path: "escape" }],
              ok: false,
            },
          },
        ],
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain("/private");
    for (const extra of [{ path: "/etc" }, { root: "/etc" }]) {
      expect(
        await fixture.workspace.request({ ...open, ...extra }),
      ).toMatchObject({ error: { code: "invalid_request" }, ok: false });
    }
  });

  it("binds grants to the window that opened them and expires them on teardown", async () => {
    const fixture = await createFixture({
      ids: ["op-1", "grant-1", "op-2"],
      studio: { drafts: createMemoryStudioDraftRecords(), host: host() },
    });
    await fixture.workspace.request(open);
    const other = fixture.attach("workspace-2");
    expect(
      await other.request({
        grantId: "grant-1",
        type: "studio.validate",
        version: 2,
      }),
    ).toMatchObject({ error: { code: "studio_grant_invalid" }, ok: false });
    expect(
      await fixture.workspace.request({
        grantId: "grant-1",
        type: "studio.validate",
        version: 2,
      }),
    ).toEqual({ ok: true, value: { operationId: "op-2" } });
    fixture.workspace.teardown();
    expect((await other.snapshot()).studio?.grants).toEqual([]);
  });

  it("keeps Drafts revisioned with compare-and-swap and exports only valid ones", async () => {
    const studioHost = host();
    const drafts = createMemoryStudioDraftRecords();
    const fixture = await createFixture({
      ids: ["draft-1", "op-1", "op-2", "op-3", "op-4", "op-5"],
      studio: { drafts, host: studioHost },
    });
    expect(
      await fixture.workspace.request({
        type: "studio.draft.create",
        version: 2,
      }),
    ).toEqual({ ok: true, value: { operationId: "op-1" } });
    let snapshot = await fixture.workspace.snapshot();
    expect(snapshot.studio?.drafts).toMatchObject([
      { id: "draft-1", revision: 1 },
    ]);

    expect(
      await fixture.workspace.request({
        draftId: "draft-1",
        expectedRevision: 1,
        skillMd: "# broken\n",
        type: "studio.draft.save",
        version: 2,
      }),
    ).toEqual({ ok: true, value: { operationId: "op-2" } });
    expect(
      await fixture.workspace.request({
        draftId: "draft-1",
        expectedRevision: 1,
        skillMd: SKILL_MD,
        type: "studio.draft.save",
        version: 2,
      }),
    ).toMatchObject({ error: { code: "studio_draft_conflict" }, ok: false });
    expect(
      await fixture.workspace.request({
        draftId: "draft-1",
        type: "studio.export",
        version: 2,
      }),
    ).toMatchObject({ error: { code: "studio_validation_failed" }, ok: false });
    expect(studioHost.exports).toEqual([]);

    expect(
      await fixture.workspace.request({
        draftId: "draft-1",
        expectedRevision: 2,
        skillMd: SKILL_MD,
        type: "studio.draft.save",
        version: 2,
      }),
    ).toEqual({ ok: true, value: { operationId: "op-3" } });
    expect(
      await fixture.workspace.request({
        draftId: "draft-1",
        type: "studio.preview",
        version: 2,
      }),
    ).toEqual({ ok: true, value: { operationId: "op-4" } });
    snapshot = await fixture.workspace.snapshot();
    expect(snapshot.studio?.preview).toMatchObject({
      draftId: "draft-1",
      preview: { blocks: [{ kind: "heading", level: 1 }] },
      revision: 3,
    });
    expect(
      await fixture.workspace.request({
        draftId: "draft-1",
        type: "studio.export",
        version: 2,
      }),
    ).toEqual({ ok: true, value: { operationId: "op-5" } });
    expect(studioHost.exports).toEqual([
      { name: "hello", parent: "/private/out", paths: ["SKILL.md"] },
    ]);
    snapshot = await fixture.workspace.snapshot();
    expect(snapshot.studio?.lastExport).toMatchObject({
      destinationLabel: "out",
      draftId: "draft-1",
      name: "hello",
    });
    expect(JSON.stringify(snapshot)).not.toContain("/private");
    expect((await drafts.restore()).drafts).toMatchObject([
      { id: "draft-1", revision: 3 },
    ]);
  });

  it("keeps Drafts available without a host while refusing grants and export", async () => {
    const fixture = await createFixture({
      ids: ["draft-1", "op-1"],
      studio: { drafts: createMemoryStudioDraftRecords() },
    });
    expect((await fixture.workspace.snapshot()).studio).toMatchObject({
      available: false,
    });
    expect(await fixture.workspace.request(open)).toMatchObject({
      error: { code: "studio_unavailable" },
      ok: false,
    });
    expect(
      (
        await fixture.workspace.request({
          type: "studio.draft.create",
          version: 2,
        })
      ).ok,
    ).toBe(true);
    expect(
      await fixture.workspace.request({
        draftId: "draft-1",
        type: "studio.export",
        version: 2,
      }),
    ).toMatchObject({ error: { code: "studio_unavailable" }, ok: false });
  });
});
