import { describe, expect, it } from "vitest";

import { BUNDLED_OFFICIAL_COLLECTION_CATALOG } from "./bundled-official-collections.js";
import {
  digestCanonicalJson,
  projectOfficialCollections,
  validateOfficialCollectionCatalog,
} from "./official-collections.js";

describe("bundled Official Collection catalog", () => {
  it("has a canonical manifest digest and remains non-executable pending independent review", () => {
    const catalog = validateOfficialCollectionCatalog(
      BUNDLED_OFFICIAL_COLLECTION_CATALOG,
    );
    expect(
      projectOfficialCollections({
        catalog,
        inventory: {
          activeOperationId: null,
          cliVersion: "1.5.23",
          entries: [],
          freshness: "fresh",
          lastError: null,
          observedAt: "2026-08-22T06:00:00.000Z",
          persistenceWarning: null,
          phase: "ready",
        },
        platform: "linux",
        target: {
          generation: 1,
          harness: "Codex",
          id: "00000000-0000-4000-8000-000000000001",
          kind: "local",
          label: "This device",
          workspaceLabel: "skills-desktop",
        },
      }).releases[0],
    ).toMatchObject({
      blockers: ["Independent review is pending."],
      executable: false,
      manifestDigest:
        "sha256:182b299da81e6d96be674e473646328ca0032eeb8f189de3e9235a5fc8ae2a8a",
      receipt: { status: "pending" },
      source: {
        reviewedRevision: "435076e78988e1e6ec40d00b0b1d76bdbbc5419a",
      },
    });
  });

  it("preserves every metadata-only assessment and explicit reapply mode", () => {
    const reviewedRevision =
      BUNDLED_OFFICIAL_COLLECTION_CATALOG.releases[0]!.manifest.source
        .reviewedRevision;
    const manifest = {
      ...BUNDLED_OFFICIAL_COLLECTION_CATALOG.releases[0]!.manifest,
      compatibility: {
        ...BUNDLED_OFFICIAL_COLLECTION_CATALOG.releases[0]!.manifest
          .compatibility,
        platforms: ["linux" as const],
      },
      skills: ["missing", "unknown", "unchanged", "conflict"],
    };
    const manifestDigest = digestCanonicalJson(manifest);
    const catalog = validateOfficialCollectionCatalog({
      releases: [
        {
          manifest,
          manifestDigest,
          receipt: {
            author: "author",
            manifestDigest,
            reviewLocation:
              "https://github.com/oldwinter/skills-desktop/issues/20",
            reviewPolicy: "official-collection-v1",
            reviewedAt: "2026-08-22T06:00:00.000Z",
            reviewer: "reviewer",
            schemaVersion: 1,
            status: "approved",
          },
        },
      ],
      schemaVersion: 1,
    });
    const entry = (
      name: string,
      source: string | null,
      revision:
        | { readonly status: "unknown" }
        | {
            readonly authority: "npx-skills";
            readonly kind: "git-commit";
            readonly status: "known";
            readonly value: string;
          },
    ) => ({
      agents: [],
      contentFingerprint: { status: "unknown" as const },
      declaredSource: {
        source,
        sourceType: source === null ? null : "github",
      },
      name,
      revision,
      scope: "project" as const,
    });
    const inventory = {
      activeOperationId: null,
      cliVersion: "1.5.23" as const,
      entries: [
        entry("unknown", null, { status: "unknown" }),
        entry("unchanged", "vercel-labs/skills", {
          authority: "npx-skills",
          kind: "git-commit",
          status: "known",
          value: reviewedRevision,
        }),
        entry("conflict", "another/source", { status: "unknown" }),
      ],
      freshness: "fresh" as const,
      lastError: null,
      observedAt: "2026-08-22T06:00:00.000Z",
      persistenceWarning: null,
      phase: "ready" as const,
    };
    const target = {
      generation: 1,
      harness: "Codex",
      id: "00000000-0000-4000-8000-000000000001",
      kind: "local" as const,
      label: "This device",
      workspaceLabel: "skills-desktop",
    };
    const projectAssessment = projectOfficialCollections({
      catalog,
      inventory,
      platform: "linux",
      target,
    }).releases[0]!.assessments[0]!;

    expect(projectAssessment.entries).toEqual([
      {
        inRelease: true,
        name: "missing",
        selectable: true,
        selectionModes: ["add"],
        status: "missing",
      },
      {
        inRelease: true,
        name: "unknown",
        selectable: true,
        selectionModes: ["reapply"],
        status: "present-content-unknown",
      },
      {
        inRelease: true,
        name: "unchanged",
        selectable: true,
        selectionModes: ["reapply"],
        status: "unchanged",
      },
      {
        inRelease: true,
        name: "conflict",
        selectable: false,
        selectionModes: [],
        status: "source-conflict",
      },
    ]);
    expect(
      projectOfficialCollections({
        catalog,
        inventory,
        platform: "win32",
        target,
      }).releases[0]!.assessments[0],
    ).toMatchObject({
      compatibility: "incompatible",
      entries: expect.arrayContaining([
        expect.objectContaining({
          name: "missing",
          selectable: false,
          status: "incompatible",
        }),
      ]),
    });
  });

  it("keeps prior-release removals inspectable and never selectable", () => {
    const firstManifest = {
      ...BUNDLED_OFFICIAL_COLLECTION_CATALOG.releases[0]!.manifest,
      skills: ["find-skills", "retired-skill"],
      status: "deprecated" as const,
    };
    const firstDigest = digestCanonicalJson(firstManifest);
    const secondManifest = {
      ...BUNDLED_OFFICIAL_COLLECTION_CATALOG.releases[0]!.manifest,
      releaseNumber: 2,
      supersedesDigest: firstDigest,
    };
    const secondDigest = digestCanonicalJson(secondManifest);
    const approvedReceipt = (manifestDigest: string) => ({
      author: "author",
      manifestDigest,
      reviewLocation: "https://github.com/oldwinter/skills-desktop/issues/20",
      reviewPolicy: "official-collection-v1" as const,
      reviewedAt: "2026-08-22T06:00:00.000Z",
      reviewer: "reviewer",
      schemaVersion: 1 as const,
      status: "approved" as const,
    });
    const catalog = validateOfficialCollectionCatalog({
      releases: [
        {
          manifest: firstManifest,
          manifestDigest: firstDigest,
          receipt: approvedReceipt(firstDigest),
        },
        {
          manifest: secondManifest,
          manifestDigest: secondDigest,
          receipt: approvedReceipt(secondDigest),
        },
      ],
      schemaVersion: 1,
    });
    const releases = projectOfficialCollections({
      catalog,
      inventory: {
        activeOperationId: null,
        cliVersion: "1.5.23",
        entries: [
          {
            agents: ["Codex"],
            contentFingerprint: { status: "unknown" },
            declaredSource: {
              source: "vercel-labs/skills",
              sourceType: "github",
            },
            name: "retired-skill",
            revision: { status: "unknown" },
            scope: "project",
          },
        ],
        freshness: "fresh",
        lastError: null,
        observedAt: "2026-08-22T06:00:00.000Z",
        persistenceWarning: null,
        phase: "ready",
      },
      platform: "linux",
      target: {
        generation: 1,
        harness: "Codex",
        id: "00000000-0000-4000-8000-000000000001",
        kind: "local",
        label: "This device",
        workspaceLabel: "skills-desktop",
      },
    }).releases;

    expect(releases[0]).toMatchObject({
      executable: false,
      status: "deprecated",
    });
    expect(releases[1]?.assessments[0]?.entries).toContainEqual({
      inRelease: false,
      name: "retired-skill",
      selectable: false,
      selectionModes: [],
      status: "removal-candidate",
    });
  });

  it.each(["deprecated", "revoked"] as const)(
    "keeps a %s release inspectable but non-executable",
    (status) => {
      const manifest = {
        ...BUNDLED_OFFICIAL_COLLECTION_CATALOG.releases[0]!.manifest,
        status,
      };
      const manifestDigest = digestCanonicalJson(manifest);
      const catalog = validateOfficialCollectionCatalog({
        releases: [
          {
            manifest,
            manifestDigest,
            receipt: {
              author: "author",
              manifestDigest,
              reviewLocation:
                "https://github.com/oldwinter/skills-desktop/issues/20",
              reviewPolicy: "official-collection-v1",
              reviewedAt: "2026-08-22T06:00:00.000Z",
              reviewer: "reviewer",
              schemaVersion: 1,
              status: "approved",
            },
          },
        ],
        schemaVersion: 1,
      });
      const release = projectOfficialCollections({
        catalog,
        inventory: {
          activeOperationId: null,
          cliVersion: "1.5.23",
          entries: [],
          freshness: "fresh",
          lastError: null,
          observedAt: "2026-08-22T06:00:00.000Z",
          persistenceWarning: null,
          phase: "ready",
        },
        platform: "linux",
        target: {
          generation: 1,
          harness: "Codex",
          id: "00000000-0000-4000-8000-000000000001",
          kind: "local",
          label: "This device",
          workspaceLabel: "skills-desktop",
        },
      }).releases[0];
      expect(release).toMatchObject({ executable: false, status });
    },
  );
});
