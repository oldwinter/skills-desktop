import { createHash } from "node:crypto";

import { z } from "zod";

import { resolveLegacyHarnessAlias } from "@skills-desktop/skills-runtime";

import type {
  PublicCollectionPlan,
  PublicCollectionsState,
  PublicInventoryState,
  TargetDefinition,
} from "../../contracts/workspace.js";
import { isInventoryEntryAvailableToHarness } from "../../contracts/inventory-availability.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const skillNameSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const repositorySchema = z
  .string()
  .min(3)
  .max(256)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/);

const compatibilitySchema = z
  .object({
    cliVersion: z.literal("1.5.23"),
    harnesses: z
      .array(z.string().min(1).max(128))
      .min(1)
      .max(64)
      .refine((values) => new Set(values).size === values.length),
    platforms: z
      .array(z.enum(["darwin", "linux", "win32"]))
      .min(1)
      .max(3)
      .refine((values) => new Set(values).size === values.length),
    requiredCapabilities: z
      .array(z.enum(["local", "ssh"]))
      .min(1)
      .max(2)
      .refine((values) => new Set(values).size === values.length),
  })
  .strict();

const manifestSchema = z
  .object({
    collectionId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    compatibility: compatibilitySchema,
    description: z.string().min(1).max(1_024),
    releaseNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    schemaVersion: z.literal(1),
    skills: z.array(skillNameSchema).min(1).max(128),
    source: z
      .object({
        repository: repositorySchema,
        repositoryUrl: z.string().url().max(512),
        reviewedRevision: z.string().regex(/^[a-f0-9]{40}$/),
        sourceType: z.literal("github"),
      })
      .strict(),
    status: z.enum(["active", "deprecated", "revoked"]),
    supersedesDigest: digestSchema.nullable(),
    title: z.string().min(1).max(256),
  })
  .strict()
  .superRefine((manifest, context) => {
    const exactNames = new Set(manifest.skills);
    const foldedNames = new Set(
      manifest.skills.map((name) => name.toLocaleLowerCase("en-US")),
    );
    if (
      exactNames.size !== manifest.skills.length ||
      foldedNames.size !== manifest.skills.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Collection Skill names must be unique and case distinct.",
        path: ["skills"],
      });
    }
    if (
      manifest.source.repositoryUrl !==
      `https://github.com/${manifest.source.repository}`
    ) {
      context.addIssue({
        code: "custom",
        message: "Collection source must be one canonical public GitHub URL.",
        path: ["source", "repositoryUrl"],
      });
    }
  });

const receiptSchema = z
  .object({
    author: z.string().trim().min(1).max(256),
    manifestDigest: digestSchema,
    reviewLocation: z.string().url().max(2_048).nullable(),
    reviewPolicy: z.literal("official-collection-v1"),
    reviewedAt: z.string().datetime({ offset: true }).nullable(),
    reviewer: z.string().trim().min(1).max(256).nullable(),
    schemaVersion: z.literal(1),
    status: z.enum(["approved", "pending"]),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.status !== "approved") return;
    if (
      receipt.reviewer === null ||
      receipt.reviewer.toLocaleLowerCase("en-US") ===
        receipt.author.toLocaleLowerCase("en-US") ||
      receipt.reviewedAt === null ||
      receipt.reviewLocation === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Approved Collection receipts require independent review.",
      });
    }
  });

const releaseSchema = z
  .object({
    manifest: manifestSchema,
    manifestDigest: digestSchema,
    receipt: receiptSchema,
  })
  .strict();

const officialCollectionCatalogSchema = z
  .object({
    releases: z.array(releaseSchema).max(1_000),
    schemaVersion: z.literal(1),
  })
  .strict();

export type OfficialCollectionCatalog = z.infer<
  typeof officialCollectionCatalogSchema
>;
export type OfficialCollectionRelease = z.infer<typeof releaseSchema>;

export const EMPTY_OFFICIAL_COLLECTION_CATALOG: OfficialCollectionCatalog = {
  releases: [],
  schemaVersion: 1,
};

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

export function digestCanonicalJson(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex")}`;
}

function manifestDigest(manifest: OfficialCollectionRelease["manifest"]) {
  return digestCanonicalJson(manifest);
}

export function validateOfficialCollectionCatalog(
  value: unknown,
): OfficialCollectionCatalog {
  const parsed = officialCollectionCatalogSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Official Collection catalog validation failed.");
  }

  const releaseKeys = new Set<string>();
  const digests = new Set<string>();
  const releasesByCollection = new Map<string, OfficialCollectionRelease[]>();
  for (const release of parsed.data.releases) {
    const key = `${release.manifest.collectionId}:${release.manifest.releaseNumber}`;
    if (
      releaseKeys.has(key) ||
      digests.has(release.manifestDigest) ||
      release.manifestDigest !== manifestDigest(release.manifest) ||
      release.receipt.manifestDigest !== release.manifestDigest
    ) {
      throw new Error("Official Collection catalog validation failed.");
    }
    releaseKeys.add(key);
    digests.add(release.manifestDigest);
    const releases =
      releasesByCollection.get(release.manifest.collectionId) ?? [];
    releases.push(release);
    releasesByCollection.set(release.manifest.collectionId, releases);
  }
  for (const releases of releasesByCollection.values()) {
    releases.sort(
      (left, right) =>
        left.manifest.releaseNumber - right.manifest.releaseNumber,
    );
    let prior: OfficialCollectionRelease | undefined;
    let activeReleases = 0;
    for (const release of releases) {
      if (
        release.manifest.supersedesDigest !== (prior?.manifestDigest ?? null)
      ) {
        throw new Error("Official Collection catalog validation failed.");
      }
      if (release.manifest.status === "active") activeReleases += 1;
      prior = release;
    }
    if (activeReleases > 1) {
      throw new Error("Official Collection catalog validation failed.");
    }
  }
  return parsed.data;
}

function isCompatible(input: {
  readonly inventory: PublicInventoryState;
  readonly platform: NodeJS.Platform;
  readonly release: OfficialCollectionRelease;
  readonly target: TargetDefinition;
}) {
  const { compatibility } = input.release.manifest;
  const platformCompatible =
    input.target.kind === "ssh"
      ? (["darwin", "linux", "win32"] as const).every((platform) =>
          compatibility.platforms.includes(platform),
        )
      : compatibility.platforms.includes(
          input.platform as "darwin" | "linux" | "win32",
        );
  return (
    compatibility.requiredCapabilities.includes(input.target.kind) &&
    input.target.harnessIds.every((harnessId) =>
      compatibility.harnesses.some((declaredHarness) => {
        const resolved = resolveLegacyHarnessAlias(declaredHarness);
        return resolved.ok
          ? resolved.value === harnessId
          : declaredHarness === harnessId;
      }),
    ) &&
    platformCompatible &&
    input.inventory.cliVersion === compatibility.cliVersion
  );
}

export function projectOfficialCollections(input: {
  readonly acknowledgements?: PublicCollectionsState["acknowledgements"];
  readonly catalog: OfficialCollectionCatalog;
  readonly inventory: PublicInventoryState;
  readonly platform: NodeJS.Platform;
  readonly plan?: PublicCollectionPlan | null;
  readonly target: TargetDefinition;
}): PublicCollectionsState {
  const byDigest = new Map(
    input.catalog.releases.map((release) => [release.manifestDigest, release]),
  );
  return {
    acknowledgements: structuredClone(input.acknowledgements ?? []),
    plan: structuredClone(input.plan ?? null),
    releases: input.catalog.releases.map((release) => {
      const compatible = isCompatible({ ...input, release });
      const prior =
        release.manifest.supersedesDigest === null
          ? undefined
          : byDigest.get(release.manifest.supersedesDigest);
      return {
        assessments: (["project", "global"] as const).map((scope) => {
          const entries: PublicCollectionsState["releases"][number]["assessments"][number]["entries"] =
            release.manifest.skills.map((name) => {
              const observed = input.inventory.entries.find(
                (entry) =>
                  entry.name === name &&
                  entry.scope === scope &&
                  input.target.harnessIds.every((harnessId) =>
                    isInventoryEntryAvailableToHarness(entry, harnessId),
                  ),
              );
              let status:
                | "incompatible"
                | "missing"
                | "present-content-unknown"
                | "source-conflict"
                | "unchanged";
              if (!compatible) status = "incompatible";
              else if (observed === undefined) status = "missing";
              else if (
                observed.declaredSource.sourceType === null &&
                observed.declaredSource.source === null
              ) {
                status = "present-content-unknown";
              } else if (
                observed.declaredSource.sourceType !==
                  release.manifest.source.sourceType ||
                observed.declaredSource.source !==
                  release.manifest.source.repository
              ) {
                status = "source-conflict";
              } else if (
                observed.revision.status === "known" &&
                observed.revision.kind === "git-commit" &&
                observed.revision.value ===
                  release.manifest.source.reviewedRevision
              ) {
                status = "unchanged";
              } else status = "present-content-unknown";
              return {
                inRelease: true,
                name,
                selectable:
                  status === "missing" ||
                  status === "present-content-unknown" ||
                  status === "unchanged",
                selectionModes:
                  status === "missing"
                    ? (["add"] as const)
                    : status === "present-content-unknown" ||
                        status === "unchanged"
                      ? (["reapply"] as const)
                      : [],
                status,
              };
            });
          if (compatible && prior !== undefined) {
            for (const name of prior.manifest.skills) {
              if (release.manifest.skills.includes(name)) continue;
              const observed = input.inventory.entries.find(
                (entry) =>
                  entry.name === name &&
                  entry.scope === scope &&
                  input.target.harnessIds.every((harnessId) =>
                    isInventoryEntryAvailableToHarness(entry, harnessId),
                  ),
              );
              if (observed === undefined) continue;
              entries.push({
                inRelease: false,
                name,
                selectable: false,
                selectionModes: [],
                status: "removal-candidate",
              });
            }
          }
          return {
            compatibility: compatible ? "compatible" : "incompatible",
            entries,
            inventoryFreshness: input.inventory.freshness,
            scope,
            targetGeneration: input.target.generation,
            targetId: input.target.id,
          };
        }),
        blockers: [
          ...(release.manifest.status === "active"
            ? []
            : [`Release status is ${release.manifest.status}.`]),
          ...(release.receipt.status === "approved"
            ? []
            : ["Independent review is pending."]),
        ],
        collectionId: release.manifest.collectionId,
        compatibility: structuredClone(release.manifest.compatibility),
        description: release.manifest.description,
        executable:
          release.manifest.status === "active" &&
          release.receipt.status === "approved",
        manifestDigest: release.manifestDigest,
        receipt: structuredClone(release.receipt),
        releaseNumber: release.manifest.releaseNumber,
        skills: [...release.manifest.skills],
        source: structuredClone(release.manifest.source),
        status: release.manifest.status,
        supersedesDigest: release.manifest.supersedesDigest,
        title: release.manifest.title,
      };
    }),
  };
}
