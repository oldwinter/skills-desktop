import type { OfficialCollectionCatalog } from "./official-collections.js";

export const BUNDLED_OFFICIAL_COLLECTION_CATALOG = {
  releases: [
    {
      manifest: {
        collectionId: "skills-desktop-starter",
        compatibility: {
          cliVersion: "1.5.23",
          harnesses: ["Codex"],
          platforms: ["darwin", "linux", "win32"],
          requiredCapabilities: ["local"],
        },
        description:
          "A minimal official starting point for discovering and installing agent skills.",
        releaseNumber: 1,
        schemaVersion: 1,
        skills: ["find-skills"],
        source: {
          repository: "vercel-labs/skills",
          repositoryUrl: "https://github.com/vercel-labs/skills",
          reviewedRevision: "435076e78988e1e6ec40d00b0b1d76bdbbc5419a",
          sourceType: "github",
        },
        status: "active",
        supersedesDigest: null,
        title: "Skills Desktop Starter",
      },
      manifestDigest:
        "sha256:182b299da81e6d96be674e473646328ca0032eeb8f189de3e9235a5fc8ae2a8a",
      receipt: {
        author: "skills-desktop maintainers",
        manifestDigest:
          "sha256:182b299da81e6d96be674e473646328ca0032eeb8f189de3e9235a5fc8ae2a8a",
        reviewLocation: null,
        reviewPolicy: "official-collection-v1",
        reviewedAt: null,
        reviewer: null,
        schemaVersion: 1,
        status: "pending",
      },
    },
  ],
  schemaVersion: 1,
} as const satisfies OfficialCollectionCatalog;
