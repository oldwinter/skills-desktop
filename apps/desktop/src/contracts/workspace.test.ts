import { describe, expect, it } from "vitest";

import {
  createTargetRequestSchema,
  desktopEventSchema,
  openComparisonRequestSchema,
  prepareCollectionAcrossTargetsRequestSchema,
  prepareCollectionRequestSchema,
  prepareComparisonRequestSchema,
  publicCollectionPlanSchema,
  publicComparisonSchema,
  targetDraftSchema,
  workspaceRequestSchema,
  workspaceSnapshotResultSchema,
  workspaceSnapshotSchema,
} from "./workspace.js";

const targetId = "00000000-0000-4000-8000-000000000001";
const otherTargetId = "00000000-0000-4000-8000-00000000000a";
const digest = `sha256:${"a".repeat(64)}`;
const hex64 = "b".repeat(64);
const revision = "0123456789abcdef0123456789abcdef01234567";
const targetV4Metadata = {
  dialectId: "skills-1.5.23" as const,
  executionBindingDigest: null,
  harnessIds: ["codex"],
  registryDigest:
    "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de" as const,
  registryVersion: 1 as const,
};

const localDraft = {
  connectionReference: null,
  harnessIds: ["codex"],
  kind: "local" as const,
  label: "This device",
  workspace: "/work/skills-desktop",
};

const sshDraft = {
  connectionReference: "build-host",
  harnessIds: ["codex"],
  kind: "ssh" as const,
  label: "Build host",
  workspace: "/srv/workspace",
};

const inventoryEntry = {
  agents: [],
  contentFingerprint: { status: "unknown" as const },
  declaredSource: { source: "example/skills", sourceType: "github" },
  name: "find-skills",
  revision: { status: "unknown" as const },
  scope: "project" as const,
};

const inventory = {
  activeOperationId: null,
  cliVersion: "1.5.23" as const,
  entries: [inventoryEntry],
  freshness: "fresh" as const,
  lastError: null,
  observedAt: "2026-08-21T10:00:00.000Z",
  persistenceWarning: null,
  phase: "ready" as const,
};

const mutation = {
  activeOperationId: null,
  commandPlan: null,
  lastError: null,
  outcome: null,
  phase: "idle" as const,
  reconciliationDeadline: null,
};

const targetDefinition = {
  connectionReference: null,
  ...targetV4Metadata,
  generation: 1,
  id: targetId,
  kind: "local" as const,
  label: "This device",
  workspace: "/work/skills-desktop",
  workspaceLabel: "skills-desktop",
};

const commandPlan = {
  harness: "Codex",
  names: ["find-skills"],
  operation: "add" as const,
  preview: "skills add find-skills",
  schemaVersion: 1 as const,
  scope: "project" as const,
  source: {
    revision,
    source: "vercel-labs/skills",
    sourceType: "github" as const,
  },
  targetId,
  timeoutMs: 60_000,
};

const collectionCompatibility = {
  cliVersion: "1.5.23" as const,
  harnesses: ["Codex"],
  platforms: ["linux" as const],
  requiredCapabilities: ["local" as const],
};

const collectionReceipt = {
  author: "Author",
  manifestDigest: digest,
  reviewLocation: "https://github.com/oldwinter/skills-desktop/issues/20",
  reviewPolicy: "official-collection-v1" as const,
  reviewedAt: "2026-08-22T05:00:00.000Z",
  reviewer: "Reviewer",
  schemaVersion: 1 as const,
  status: "approved" as const,
};

const releaseEvidence = {
  compatibility: collectionCompatibility,
  receipt: collectionReceipt,
  status: "active" as const,
};

describe("workspace target draft contract", () => {
  it("accepts matching local and ssh drafts", () => {
    expect(targetDraftSchema.parse(localDraft)).toEqual(localDraft);
    expect(targetDraftSchema.parse(sshDraft)).toEqual(sshDraft);
  });

  it("rejects kind and connection reference mismatches", () => {
    expect(
      targetDraftSchema.safeParse({
        ...localDraft,
        connectionReference: "build-host",
      }).success,
    ).toBe(false);
    expect(
      targetDraftSchema.safeParse({
        ...sshDraft,
        connectionReference: null,
      }).success,
    ).toBe(false);
  });
});

describe("workspace comparison and collection request contracts", () => {
  it("rejects opening a comparison against the same Target twice", () => {
    expect(
      openComparisonRequestSchema.safeParse({
        leftTargetId: targetId,
        rightTargetId: targetId,
        type: "comparison.open",
        version: 2,
      }).success,
    ).toBe(false);
    expect(
      openComparisonRequestSchema.parse({
        leftTargetId: targetId,
        rightTargetId: otherTargetId,
        type: "comparison.open",
        version: 2,
      }),
    ).toMatchObject({ leftTargetId: targetId, rightTargetId: otherTargetId });
  });

  it("rejects duplicate skill selections in a single-target collection prepare", () => {
    const base = {
      collectionId: "skills-desktop-starter",
      manifestDigest: digest,
      releaseNumber: 1,
      scope: "project" as const,
      targetId,
      type: "collection.prepare" as const,
      version: 2 as const,
    };
    expect(
      prepareCollectionRequestSchema.safeParse({
        ...base,
        selections: [
          { mode: "add", name: "find-skills" },
          { mode: "reapply", name: "find-skills" },
        ],
      }).success,
    ).toBe(false);
    expect(
      prepareCollectionRequestSchema.parse({
        ...base,
        selections: [
          { mode: "add", name: "find-skills" },
          { mode: "add", name: "tdd" },
        ],
      }).selections,
    ).toHaveLength(2);
  });

  it("rejects duplicate Targets or skill names across a multi-target prepare", () => {
    const unique = {
      collectionId: "skills-desktop-starter",
      manifestDigest: digest,
      releaseNumber: 1,
      targets: [
        {
          scope: "project" as const,
          selections: [{ mode: "add" as const, name: "find-skills" }],
          targetId,
        },
        {
          scope: "global" as const,
          selections: [{ mode: "add" as const, name: "tdd" }],
          targetId: otherTargetId,
        },
      ],
      type: "collection.prepare-many" as const,
      version: 2 as const,
    };
    expect(prepareCollectionAcrossTargetsRequestSchema.parse(unique)).toEqual(
      unique,
    );
    expect(
      prepareCollectionAcrossTargetsRequestSchema.safeParse({
        ...unique,
        targets: [
          unique.targets[0],
          { ...unique.targets[1], targetId },
        ],
      }).success,
    ).toBe(false);
    expect(
      prepareCollectionAcrossTargetsRequestSchema.safeParse({
        ...unique,
        targets: [
          {
            ...unique.targets[0],
            selections: [
              { mode: "add", name: "find-skills" },
              { mode: "reapply", name: "find-skills" },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("workspace multi-target collection plan contract", () => {
  const child = {
    assessmentDigest: digest,
    bindingDigest: digest,
    commandPlan: { ...commandPlan, targetId },
    inventoryDigest: digest,
    position: 1,
    preparedDigest: hex64,
    scope: "project" as const,
    selections: [{ mode: "add" as const, name: "find-skills" }],
    target: targetDefinition,
  };
  const order = {
    names: ["find-skills"],
    position: 1,
    scope: "project" as const,
    targetId,
  };
  const validPlan = {
    children: [child],
    collectionId: "skills-desktop-starter",
    expiresAt: "2026-08-22T06:00:00.000Z",
    id: "collection-plan-many",
    manifestDigest: digest,
    order: [order],
    releaseEvidence,
    releaseNumber: 1,
    reviewDigest: digest,
    schemaVersion: 2 as const,
    source: { repository: "vercel-labs/skills", reviewedRevision: revision },
  };

  it("accepts a coherent multi-target plan and single-target plan", () => {
    expect(publicCollectionPlanSchema.parse(validPlan)).toEqual(validPlan);
    expect(
      publicCollectionPlanSchema.parse({
        assessmentDigest: digest,
        childCommandPlan: commandPlan,
        childPreparedDigest: hex64,
        collectionId: "skills-desktop-starter",
        expiresAt: "2026-08-22T06:00:00.000Z",
        id: "collection-plan-1",
        inventoryDigest: digest,
        manifestDigest: digest,
        order: [{ names: ["find-skills"], position: 1, targetId }],
        releaseEvidence,
        releaseNumber: 1,
        reviewDigest: digest,
        schemaVersion: 1,
        scope: "project",
        selections: [{ mode: "add", name: "find-skills" }],
        source: { repository: "vercel-labs/skills", reviewedRevision: revision },
        targetGeneration: 1,
        targetId,
      }),
    ).toMatchObject({ schemaVersion: 1, targetId });
  });

  it("rejects children that disagree with stable order or Command Plans", () => {
    expect(
      publicCollectionPlanSchema.safeParse({
        ...validPlan,
        order: [{ ...order, names: ["tdd"] }],
      }).success,
    ).toBe(false);
    expect(
      publicCollectionPlanSchema.safeParse({
        ...validPlan,
        children: [{ ...child, position: 2 }],
      }).success,
    ).toBe(false);
    expect(
      publicCollectionPlanSchema.safeParse({
        ...validPlan,
        children: [
          child,
          {
            ...child,
            position: 2,
            target: { ...targetDefinition, id: otherTargetId },
            commandPlan: { ...commandPlan, targetId: otherTargetId },
            selections: [{ mode: "add", name: "find-skills" }],
          },
        ],
        order: [
          order,
          {
            names: ["find-skills"],
            position: 2,
            scope: "project",
            targetId: otherTargetId,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      publicCollectionPlanSchema.safeParse({
        ...validPlan,
        children: [
          child,
          {
            ...child,
            position: 2,
            target: targetDefinition,
            commandPlan: { ...commandPlan, targetId },
          },
        ],
        order: [
          order,
          { ...order, position: 2 },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("workspace snapshot and request envelopes", () => {
  it("accepts only the bundled Workspace Protocol v2", () => {
    const request = {
      targetId,
      type: "inventory.refresh" as const,
      version: 2 as const,
    };

    expect(workspaceRequestSchema.parse(request)).toEqual(request);
    expect(
      workspaceRequestSchema.safeParse({ ...request, version: 1 }).success,
    ).toBe(false);
  });

  it("accepts a snapshot with comparison rows and rejects malformed results", () => {
    const comparison = {
      id: "comparison-1",
      leftFreshness: "fresh" as const,
      leftTargetId: targetId,
      rightFreshness: "stale" as const,
      rightTargetId: otherTargetId,
      rows: [
        {
          dimensions: {
            contentFingerprint: "unknown" as const,
            declaredSource: "matched" as const,
            presence: "both" as const,
            revision: "drift" as const,
          },
          key: "find-skills",
          left: {
            entries: [
              {
                ...inventoryEntry,
                contentFingerprint: {
                  authority: "cli",
                  kind: "sha256",
                  status: "known" as const,
                  value: "a".repeat(64),
                },
                revision: {
                  authority: "git",
                  kind: "commit",
                  status: "known" as const,
                  value: revision,
                },
              },
            ],
            freshness: "fresh" as const,
            harnessAvailability: "available" as const,
          },
          right: {
            entries: [inventoryEntry],
            freshness: "stale" as const,
            harnessAvailability: "unavailable" as const,
          },
          summary: "version-drift" as const,
        },
      ],
    };
    expect(publicComparisonSchema.parse(comparison)).toEqual(comparison);

    const snapshot = {
      eventSequence: 1,
      comparison,
      inventory,
      mutation,
      schemaVersion: 2 as const,
      sessionEpoch: "epoch-1",
      stateRevision: 2,
      target: targetDefinition,
      targets: [
        {
          deletionBlocked: false,
          inventory,
          mutation,
          target: targetDefinition,
        },
      ],
    };
    expect(workspaceSnapshotSchema.parse(snapshot)).toMatchObject({
      schemaVersion: 2,
      target: { id: targetId },
    });
    expect(
      workspaceSnapshotResultSchema.parse({ ok: true, value: snapshot }),
    ).toMatchObject({ ok: true });
    expect(
      workspaceSnapshotResultSchema.parse({
        ok: false,
        error: {
          code: "internal_error",
          effects: "none",
          message: "boom",
          phase: "snapshot",
          retryable: true,
        },
      }),
    ).toMatchObject({ ok: false });
  });

  it("discriminates desktop events and workspace requests", () => {
    expect(
      desktopEventSchema.parse({
        sequence: 1,
        sessionEpoch: "epoch-1",
        snapshot: {
          eventSequence: 1,
          inventory,
          mutation,
          schemaVersion: 2,
          sessionEpoch: "epoch-1",
          stateRevision: 1,
          target: targetDefinition,
        },
        stateRevision: 1,
        type: "snapshot.changed",
      }).type,
    ).toBe("snapshot.changed");
    expect(
      desktopEventSchema.parse({
        reason: "buffer_overflow",
        sequence: 2,
        sessionEpoch: "epoch-1",
        stateRevision: 2,
        type: "resync.required",
      }).type,
    ).toBe("resync.required");

    expect(
      workspaceRequestSchema.parse({
        targetId,
        type: "inventory.refresh",
        version: 2,
      }).type,
    ).toBe("inventory.refresh");
    expect(
      createTargetRequestSchema.parse({
        definition: localDraft,
        type: "target.create",
        version: 2,
      }).type,
    ).toBe("target.create");
    expect(
      prepareComparisonRequestSchema.parse({
        comparisonId: "comparison-1",
        destinationTargetId: targetId,
        rowKey: "find-skills",
        type: "comparison.prepare",
        version: 2,
      }).rowKey,
    ).toBe("find-skills");
  });
});
