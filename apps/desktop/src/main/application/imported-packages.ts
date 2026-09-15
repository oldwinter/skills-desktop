import { createHash } from "node:crypto";

import {
  relateSkillpack,
  type SkillpackCodec,
  type SkillpackDocument,
} from "@skills-desktop/skills-runtime";

import type {
  PublicImportedPackage,
  PublicInventoryState,
  PublicPackageImportOutcome,
  TargetDefinition,
} from "../../contracts/workspace.js";
import {
  MAX_RETAINED_PACKAGE_CONFLICTS,
  type ImportedPackageRecord,
} from "../persistence/imported-package-records.js";
import { assessRecipe } from "./official-collections.js";

/**
 * Main-owned native file picker. The renderer never names a path; main opens
 * the dialog, reads at most `SKILLPACK_MAX_BYTES + 1` bytes, and hands only the
 * bytes and display name to the import.
 */
export interface SkillpackPicker {
  pick(): Promise<SkillpackPick>;
}

export type SkillpackPick =
  | { readonly status: "cancelled" }
  | {
      readonly bytes: Uint8Array;
      readonly fileName: string;
      readonly status: "selected";
    };

export function createNodeSkillpackCodec(): SkillpackCodec {
  return {
    sha256Hex(bytes) {
      return createHash("sha256").update(bytes).digest("hex");
    },
  };
}

export type PackageImportStatus = Exclude<
  PublicPackageImportOutcome["status"],
  "cancelled"
>;

export interface PackageImportResult {
  readonly outcome: {
    readonly documentDigest: string;
    readonly packageId: string;
    readonly relatedRelease: number | null;
    readonly release: number;
    readonly status: PackageImportStatus;
  };
  readonly records: readonly ImportedPackageRecord[];
}

function sortRecords(records: readonly ImportedPackageRecord[]) {
  return [...records].sort((left, right) =>
    left.document.package.id < right.document.package.id
      ? -1
      : left.document.package.id > right.document.package.id
        ? 1
        : 0,
  );
}

/**
 * Relates a parsed `.skillpack` to the store without any network request.
 * Same ID, release, and digest is idempotent; same ID and release with a
 * different digest is retained as a conflict and never replaces the current
 * document; a different release replaces the document and records the delta.
 */
export function importSkillpack(input: {
  readonly document: SkillpackDocument;
  readonly now: string;
  readonly records: readonly ImportedPackageRecord[];
}): PackageImportResult {
  const incoming = input.document;
  const existing = input.records.find(
    ({ document }) => document.package.id === incoming.package.id,
  );
  const relation = relateSkillpack(incoming, existing?.document);
  const base = {
    documentDigest: incoming.documentDigest,
    packageId: incoming.package.id,
    release: incoming.package.release,
  };
  if (relation.kind === "new") {
    return {
      outcome: { ...base, relatedRelease: null, status: "imported" },
      records: sortRecords([
        ...input.records,
        {
          conflicts: [],
          delta: null,
          document: structuredClone(incoming),
          importedAt: input.now,
        },
      ]),
    };
  }
  const current = existing!;
  if (relation.kind === "identical") {
    return {
      outcome: {
        ...base,
        relatedRelease: current.document.package.release,
        status: "identical",
      },
      records: input.records,
    };
  }
  if (relation.kind === "conflict") {
    const alreadyRetained = current.conflicts.some(
      (conflict) => conflict.documentDigest === incoming.documentDigest,
    );
    const conflicts = alreadyRetained
      ? current.conflicts
      : [
          ...current.conflicts,
          {
            documentDigest: incoming.documentDigest,
            recordedAt: input.now,
            release: incoming.package.release,
          },
        ].slice(-MAX_RETAINED_PACKAGE_CONFLICTS);
    return {
      outcome: {
        ...base,
        relatedRelease: current.document.package.release,
        status: "conflict",
      },
      records: input.records.map((record) =>
        record === current ? { ...record, conflicts } : record,
      ),
    };
  }
  return {
    outcome: {
      ...base,
      relatedRelease: relation.fromRelease,
      status: relation.kind,
    },
    records: input.records.map((record) =>
      record === current
        ? {
            conflicts: record.conflicts,
            delta: {
              fromRelease: relation.fromRelease,
              kind: relation.kind,
              recordedAt: input.now,
              toRelease: relation.toRelease,
            },
            document: structuredClone(incoming),
            importedAt: input.now,
          }
        : record,
    ),
  };
}

export function importedPackageSource(document: SkillpackDocument) {
  return {
    repository: `${document.package.source.owner}/${document.package.source.repository}`,
    revision: document.package.source.revision ?? null,
    sourceType: "github" as const,
  };
}

function isCompatible(input: {
  readonly record: ImportedPackageRecord;
  readonly target: TargetDefinition;
}) {
  const declared = input.record.document.package.compatibility.harnessIds;
  return input.target.harnessIds.every((harnessId) =>
    declared.includes(harnessId),
  );
}

/**
 * Projects Package store records for one Target with the same dimensioned
 * assessment Official releases receive. Imported Packages carry no Official
 * receipt, so they are never presented as reviewed; their only blockers are
 * compatibility ones.
 */
export function projectImportedPackages(input: {
  readonly inventory: PublicInventoryState;
  readonly records: readonly ImportedPackageRecord[];
  readonly target: TargetDefinition;
}): PublicImportedPackage[] {
  return input.records.map((record) => {
    const { package: pkg } = record.document;
    const compatible = isCompatible({ record, target: input.target });
    const source = importedPackageSource(record.document);
    return {
      assessments: (["project", "global"] as const).map((scope) =>
        assessRecipe({
          compatible,
          inventory: input.inventory,
          scope,
          skills: pkg.skills,
          source,
          target: input.target,
        }),
      ),
      blockers: [],
      compatibility: structuredClone(pkg.compatibility),
      conflicts: structuredClone(record.conflicts),
      delta: structuredClone(record.delta),
      description: pkg.description,
      documentDigest: record.document.documentDigest,
      executable: true,
      importedAt: record.importedAt,
      origin: "imported",
      packageId: pkg.id,
      release: pkg.release,
      skills: [...pkg.skills],
      source,
      title: pkg.title,
    };
  });
}
