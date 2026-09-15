import { describe, expect, it } from "vitest";

import {
  serializeSkillpack,
  type SkillpackDocument,
  type SkillpackPackage,
} from "@skills-desktop/skills-runtime";

import type {
  PublicInventoryState,
  TargetDefinition,
} from "../../contracts/workspace.js";
import { importedPackageRecordsSchema } from "../persistence/imported-package-records.js";
import {
  createNodeSkillpackCodec,
  importSkillpack,
  projectImportedPackages,
} from "./imported-packages.js";

const codec = createNodeSkillpackCodec();
const REVISION = "0123456789abcdef0123456789abcdef01234567";

function packageFor(
  overrides: Partial<SkillpackPackage> = {},
): SkillpackPackage {
  return {
    compatibility: { dialectId: "skills-1.5.23", harnessIds: ["codex"] },
    description: "Team review recipe.",
    id: "team.review",
    release: 1,
    skills: ["find-skills", "code-review"],
    source: { owner: "vercel-labs", repository: "skills", type: "github" },
    title: "Team review",
    ...overrides,
  };
}

function documentFor(overrides: Partial<SkillpackPackage> = {}) {
  const serialized = serializeSkillpack(packageFor(overrides), codec);
  if (!serialized.ok) throw new Error(serialized.error.message);
  return serialized.value.document;
}

const target: TargetDefinition = {
  connectionReference: null,
  dialectId: "skills-1.5.23",
  executionBindingDigest: null,
  generation: 3,
  harnessIds: ["codex"],
  id: "00000000-0000-4000-8000-000000000001",
  kind: "local",
  label: "This device",
  registryDigest:
    "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de",
  registryVersion: 1,
  workspace: "/work",
  workspaceLabel: "work",
};

function inventoryWith(
  entries: PublicInventoryState["entries"],
): PublicInventoryState {
  return {
    activeOperationId: null,
    cliVersion: "1.5.23",
    entries,
    freshness: "fresh",
    lastError: null,
    observedAt: "2026-08-21T10:00:00.000Z",
    persistenceWarning: null,
    phase: "ready",
  };
}

describe("importSkillpack (ADR 0017)", () => {
  const now = "2026-08-21T10:00:00.000Z";

  it("adds a new package and keeps records sorted and durable-valid", () => {
    const later = documentFor({ id: "zeta.pack" });
    const first = importSkillpack({ document: later, now, records: [] });
    const second = importSkillpack({
      document: documentFor(),
      now,
      records: first.records,
    });
    expect(first.outcome).toEqual({
      documentDigest: later.documentDigest,
      packageId: "zeta.pack",
      relatedRelease: null,
      release: 1,
      status: "imported",
    });
    expect(second.records.map(({ document }) => document.package.id)).toEqual([
      "team.review",
      "zeta.pack",
    ]);
    expect(second.records[0]).toMatchObject({
      conflicts: [],
      delta: null,
      importedAt: now,
    });
    expect(importedPackageRecordsSchema.safeParse(second.records).success).toBe(
      true,
    );
  });

  it("is idempotent for the same ID, release, and digest", () => {
    const document = documentFor();
    const first = importSkillpack({ document, now, records: [] });
    const second = importSkillpack({
      document,
      now: "2026-08-22T10:00:00.000Z",
      records: first.records,
    });
    expect(second.outcome).toMatchObject({
      relatedRelease: 1,
      status: "identical",
    });
    expect(second.records).toBe(first.records);
  });

  it("retains a same-release digest conflict without replacing the document", () => {
    const original = documentFor();
    const edited = documentFor({ description: "Edited elsewhere." });
    const first = importSkillpack({ document: original, now, records: [] });
    const conflict = importSkillpack({
      document: edited,
      now: "2026-08-22T10:00:00.000Z",
      records: first.records,
    });
    expect(conflict.outcome).toMatchObject({
      documentDigest: edited.documentDigest,
      relatedRelease: 1,
      status: "conflict",
    });
    expect(conflict.records[0]).toMatchObject({
      conflicts: [
        {
          documentDigest: edited.documentDigest,
          recordedAt: "2026-08-22T10:00:00.000Z",
          release: 1,
        },
      ],
      document: original,
      importedAt: now,
    });
    const again = importSkillpack({
      document: edited,
      now: "2026-08-23T10:00:00.000Z",
      records: conflict.records,
    });
    expect(again.records[0]?.conflicts).toHaveLength(1);
  });

  it("records explicit upgrade and downgrade deltas and replaces the document", () => {
    const releaseOne = documentFor();
    const releaseTwo = documentFor({ release: 2, skills: ["find-skills"] });
    const first = importSkillpack({ document: releaseOne, now, records: [] });
    const upgraded = importSkillpack({
      document: releaseTwo,
      now: "2026-08-22T10:00:00.000Z",
      records: first.records,
    });
    expect(upgraded.outcome).toMatchObject({
      relatedRelease: 1,
      release: 2,
      status: "upgrade",
    });
    expect(upgraded.records[0]).toMatchObject({
      delta: {
        fromRelease: 1,
        kind: "upgrade",
        recordedAt: "2026-08-22T10:00:00.000Z",
        toRelease: 2,
      },
      document: releaseTwo,
      importedAt: "2026-08-22T10:00:00.000Z",
    });
    const downgraded = importSkillpack({
      document: releaseOne,
      now: "2026-08-23T10:00:00.000Z",
      records: upgraded.records,
    });
    expect(downgraded.outcome).toMatchObject({
      relatedRelease: 2,
      release: 1,
      status: "downgrade",
    });
    expect(downgraded.records[0]?.delta).toMatchObject({
      fromRelease: 2,
      kind: "downgrade",
      toRelease: 1,
    });
  });
});

describe("projectImportedPackages (ADR 0017)", () => {
  const now = "2026-08-21T10:00:00.000Z";
  const record = (document: SkillpackDocument) =>
    importSkillpack({ document, now, records: [] }).records;

  it("projects an imported origin with no receipt and a dimensioned assessment", () => {
    const document = documentFor();
    const [projected] = projectImportedPackages({
      inventory: inventoryWith([
        {
          agents: ["codex"],
          contentFingerprint: { status: "unknown" },
          declaredSource: {
            source: "vercel-labs/skills",
            sourceType: "github",
          },
          name: "find-skills",
          revision: {
            authority: "npx-skills",
            kind: "git-commit",
            status: "known",
            value: REVISION,
          },
          scope: "project",
        },
      ]),
      records: record(document),
      target,
    });
    expect(projected).toMatchObject({
      conflicts: [],
      delta: null,
      documentDigest: document.documentDigest,
      executable: true,
      importedAt: now,
      origin: "imported",
      packageId: "team.review",
      release: 1,
      source: {
        repository: "vercel-labs/skills",
        revision: null,
        sourceType: "github",
      },
    });
    expect(projected).not.toHaveProperty("receipt");
    const project = projected?.assessments.find(
      ({ scope }) => scope === "project",
    );
    expect(project).toMatchObject({
      compatibility: "compatible",
      inventoryFreshness: "fresh",
      targetGeneration: 3,
      targetId: target.id,
    });
    // Unpinned source: present skills can never prove "unchanged".
    expect(project?.entries).toEqual([
      {
        inRelease: true,
        name: "find-skills",
        selectable: true,
        selectionModes: ["reapply"],
        status: "present-content-unknown",
      },
      {
        inRelease: true,
        name: "code-review",
        selectable: true,
        selectionModes: ["add"],
        status: "missing",
      },
    ]);
  });

  it("proves unchanged only for a pinned revision and marks harness gaps incompatible", () => {
    const pinned = documentFor({
      source: {
        owner: "vercel-labs",
        repository: "skills",
        revision: REVISION,
        type: "github",
      },
    });
    const inventory = inventoryWith([
      {
        agents: ["codex"],
        contentFingerprint: { status: "unknown" },
        declaredSource: { source: "vercel-labs/skills", sourceType: "github" },
        name: "find-skills",
        revision: {
          authority: "npx-skills",
          kind: "git-commit",
          status: "known",
          value: REVISION,
        },
        scope: "project",
      },
    ]);
    const [projected] = projectImportedPackages({
      inventory,
      records: record(pinned),
      target,
    });
    expect(
      projected?.assessments
        .find(({ scope }) => scope === "project")
        ?.entries.find(({ name }) => name === "find-skills"),
    ).toMatchObject({ status: "unchanged" });

    const [incompatible] = projectImportedPackages({
      inventory,
      records: record(pinned),
      target: { ...target, harnessIds: ["codex", "claude-code"] },
    });
    expect(incompatible?.assessments[0]).toMatchObject({
      compatibility: "incompatible",
    });
    expect(
      incompatible?.assessments[0]?.entries.every(
        ({ status }) => status === "incompatible",
      ),
    ).toBe(true);
  });
});
