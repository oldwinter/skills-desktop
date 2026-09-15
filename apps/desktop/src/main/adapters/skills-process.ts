import { createHash } from "node:crypto";

import {
  CLI_VERSION,
  canonicalSourceInspectionJson,
  mutationIntentSchema,
  normalizeHarnessIds,
  resolveLegacyHarnessAlias,
  validateHarnessScope,
  type HarnessId,
  type Inventory,
  type InventoryParseError,
  type MutationIntent,
  type PublicError,
  type Result,
  type SourceCandidate,
  type SourceDescriptorV1,
  type SourceListing,
} from "@skills-desktop/skills-runtime";
import { isInventoryEntryAvailableToHarness } from "../../contracts/inventory-availability.js";

const PREPARED_MUTATION_TTL_MS = 10 * 60_000;
const REMOVE_TIMEOUT_MS = 2 * 60_000;
const WRITE_TIMEOUT_MS = 10 * 60_000;
export const SOURCE_INSPECTION_TIMEOUT_MS = 60_000;

export type ObservationError =
  | InventoryParseError
  | PublicError<
      | "cancelled"
      | "cli_incompatible"
      | "mutation_conflict"
      | "process_failed"
      | "remote_protocol_mismatch"
      | "remote_protocol_violation"
      | "remote_runtime_unavailable"
      | "transport_failed"
      | "transport_lost"
    >;

/**
 * Who a mutation can touch. `bound` mutations pass `--agent` and only change
 * links for the listed harnesses. `cli-unscoped` mutations (update) run
 * without `--agent`; the pinned CLI updates every CLI-managed link for the
 * named Skills in the selected scope, including harnesses outside the
 * Target. Trusted Review must disclose the latter (ADR 0014).
 */
export type CommandPlanHarnessEffect =
  | { readonly harnessIds: string[]; readonly kind: "bound" }
  | { readonly kind: "cli-unscoped"; readonly targetHarnessIds: string[] };

/**
 * ADR 0015: the reviewed add source. Legacy GitHub sources keep their shape;
 * inspected sources carry the exact descriptor plus the inspection digest the
 * preparation was bound to, so review can disclose mutability and Guard
 * creation can revalidate the binding.
 */
export type CommandPlanSource =
  | {
      readonly revision?: string;
      readonly source: string;
      readonly sourceType: "github";
    }
  | {
      readonly family: SourceDescriptorV1["family"];
      readonly inspectionDigest: string;
      readonly inspectionId: string;
      readonly mutability: SourceDescriptorV1["mutability"];
      readonly ref: string | null;
      readonly source: string;
      readonly sourceType: "inspected";
    };

export interface CommandPlan {
  readonly harness: string;
  readonly harnessEffect?: CommandPlanHarnessEffect;
  readonly harnessIds?: string[];
  readonly names: readonly string[];
  readonly operation: "add" | "remove" | "update";
  readonly preview: string;
  readonly schemaVersion: 1;
  readonly scope: "global" | "project";
  readonly source: CommandPlanSource | null;
  readonly targetId: string;
  readonly timeoutMs: number;
}

/**
 * Session evidence from one read-only `add <source> --list`. It is bound to
 * the Target binding and the exact descriptor, grants no mutation authority,
 * and is never persisted.
 */
export interface SourceInspection {
  readonly candidates: readonly SourceCandidate[];
  readonly cliVersion: typeof CLI_VERSION;
  readonly descriptor: SourceDescriptorV1;
  readonly dialectVersion: SourceListing["dialectVersion"];
  readonly digest: string;
  readonly id: string;
  readonly inspectedAt: string;
  readonly targetGeneration: number;
  readonly targetId: string;
}

export type SourceInspectionError = PublicError<
  | "cancelled"
  | "cli_incompatible"
  | "mutation_conflict"
  | "mutation_ineligible"
  | "process_failed"
  | "source_inspection_incompatible"
  | "source_unavailable"
  | "source_unsupported"
>;

export interface InspectSourceInput {
  readonly descriptor: SourceDescriptorV1;
  readonly signal: AbortSignal;
}

export interface PreparedMutation {
  readonly commandPlan: CommandPlan;
  readonly digest: string;
  readonly expiresAt: string;
  readonly id: string;
  readonly inventoryId: string;
  readonly targetGeneration: number;
  readonly targetId: string;
}

export type MutationPreparationError = PublicError<
  "invalid_intent" | "mutation_ineligible" | "stale_inventory"
>;

export interface PrepareMutationInput {
  readonly freshness: "fresh";
  readonly intent: MutationIntent;
  readonly inventory: Inventory;
  readonly inventoryId: string;
}

export interface ConfirmedMutation {
  readonly digest: string;
  readonly preparedMutationId: string;
}

export interface MutationOutcome {
  readonly effects: {
    readonly status:
      "content-unverified" | "not-observed" | "possible" | "verified";
  };
  readonly inventory: Inventory | null;
  readonly preparedMutationId: string;
  readonly process: {
    readonly disposition: "cancelled" | "completed" | "failed" | "timed-out";
    readonly exitCode: number | null;
    readonly termination: "known" | "unknown";
  };
}

export type MutationExecutionError = PublicError<
  "confirmation_expired" | "confirmation_invalid" | "mutation_conflict"
>;

export interface SkillsProcess {
  executeConfirmed(input: {
    readonly confirmation: ConfirmedMutation;
    readonly signal: AbortSignal;
  }): Promise<Result<MutationOutcome, MutationExecutionError>>;
  /** Read-only `add <source> --list` through the pinned CLI (ADR 0015). */
  inspectSource(
    input: InspectSourceInput,
  ): Promise<Result<SourceInspection, SourceInspectionError>>;
  observeInventory(input: {
    readonly signal: AbortSignal;
  }): Promise<Result<Inventory, ObservationError>>;
  prepareMutation(
    input: PrepareMutationInput,
  ): Promise<Result<PreparedMutation, MutationPreparationError>>;
}

export function sourceInspectionFailure(
  code: SourceInspectionError["code"],
  message: string,
  retryable = false,
): Result<never, SourceInspectionError> {
  return {
    error: { code, effects: "none", message, phase: "inspect", retryable },
    ok: false,
  };
}

export function sourceInspectionDigest(input: {
  readonly descriptor: SourceDescriptorV1;
  readonly listing: SourceListing;
}): string {
  return createHash("sha256")
    .update(canonicalSourceInspectionJson(input))
    .digest("hex");
}

/** The exact read-only argument array for one Source Inspection. */
export function sourceInspectionArguments(
  descriptor: SourceDescriptorV1,
): readonly string[] {
  return ["add", descriptor.source, "--list"];
}

export type NormalizedMutation = Exclude<
  MutationIntent,
  { readonly type: "update-all" }
>;

export interface PreparedMutationPlan {
  readonly args: readonly string[];
  /** Harnesses whose links this plan is allowed to change or verify. */
  readonly boundHarnessIds: readonly HarnessId[];
  readonly mutation: NormalizedMutation;
  readonly prepared: PreparedMutation;
}

export function mutationPreparationFailure(
  code: MutationPreparationError["code"],
  message: string,
): Result<never, MutationPreparationError> {
  return {
    error: {
      code,
      effects: "none",
      message,
      phase: "prepare",
      retryable: code === "stale_inventory",
    },
    ok: false,
  };
}

export function mutationExecutionFailure(
  code: MutationExecutionError["code"],
  message: string,
): Result<never, MutationExecutionError> {
  return {
    error: {
      code,
      effects: "none",
      message,
      phase: "execute",
      retryable: code === "mutation_conflict",
    },
    ok: false,
  };
}

function commandPlanSource(
  source: Extract<NormalizedMutation, { type: "add" }>["source"],
): CommandPlanSource {
  if (source.sourceType === "github") return { ...source };
  return {
    family: source.descriptor.family,
    inspectionDigest: source.inspection.digest,
    inspectionId: source.inspection.id,
    mutability: source.descriptor.mutability,
    ref: source.descriptor.ref,
    source: source.descriptor.source,
    sourceType: "inspected",
  };
}

function mutationArguments(
  intent: NormalizedMutation,
  harnessIds: readonly HarnessId[],
) {
  const scopeFlag =
    intent.scope === "global"
      ? ["--global"]
      : intent.type === "update"
        ? ["--project"]
        : [];
  if (intent.type === "add") {
    const source =
      intent.source.sourceType === "inspected"
        ? intent.source.descriptor.source
        : intent.source.revision === undefined
          ? intent.source.source
          : `https://github.com/${intent.source.source}/archive/${intent.source.revision}.tar.gz`;
    return [
      "add",
      source,
      "--skill",
      ...intent.names,
      "--agent",
      ...harnessIds,
      ...scopeFlag,
      "--yes",
    ];
  }
  if (intent.type === "remove") {
    return [
      "remove",
      ...intent.names,
      "--agent",
      ...harnessIds,
      ...scopeFlag,
      "--yes",
    ];
  }
  return ["update", ...intent.names, ...scopeFlag, "--yes"];
}

export function prepareMutationPlan(options: {
  readonly binding?: {
    readonly generation: number;
    readonly harness?: string;
    readonly harnessIds?: readonly string[];
    readonly targetId: string;
  };
  readonly clock: () => Date;
  readonly id?: () => string;
  readonly input: PrepareMutationInput;
}): Result<PreparedMutationPlan, MutationPreparationError> {
  if (options.binding === undefined) {
    return mutationPreparationFailure(
      "mutation_ineligible",
      "This Skills Process is not bound to a Target.",
    );
  }
  const { input } = options;
  if (
    input.freshness !== "fresh" ||
    typeof input.inventoryId !== "string" ||
    input.inventoryId.length === 0 ||
    input.inventoryId.length > 256
  ) {
    return mutationPreparationFailure(
      "stale_inventory",
      "A Fresh Inventory is required to prepare a mutation.",
    );
  }
  const parsedIntent = mutationIntentSchema.safeParse(input.intent);
  if (!parsedIntent.success) {
    return mutationPreparationFailure(
      "invalid_intent",
      "The mutation intent is not supported.",
    );
  }
  const resolvedHarnessIds: HarnessId[] = [];
  for (const value of
    options.binding.harnessIds ??
    (options.binding.harness === undefined ? [] : [options.binding.harness])) {
    const resolved = resolveLegacyHarnessAlias(value);
    if (!resolved.ok) {
      return mutationPreparationFailure(
        "mutation_ineligible",
        "The Target harness is not supported by the pinned Skills dialect.",
      );
    }
    resolvedHarnessIds.push(resolved.value);
  }
  const normalizedHarnessIds = normalizeHarnessIds(resolvedHarnessIds);
  if (!normalizedHarnessIds.ok) {
    return mutationPreparationFailure(
      "mutation_ineligible",
      "The Target harness set is not supported by the pinned Skills dialect.",
    );
  }
  const scopedHarness = validateHarnessScope(
    normalizedHarnessIds.value,
    parsedIntent.data.scope,
  );
  if (!scopedHarness.ok) {
    return mutationPreparationFailure(
      "mutation_ineligible",
      "The Target harness is not supported in the selected scope.",
    );
  }

  const matchingEntries = input.inventory.entries.filter(
    (entry) =>
      entry.scope === parsedIntent.data.scope &&
      scopedHarness.value.some((harnessId) =>
        isInventoryEntryAvailableToHarness(entry, harnessId),
      ),
  );
  const mutation: NormalizedMutation =
    parsedIntent.data.type === "update-all"
      ? {
          names: matchingEntries.map(({ name }) => name),
          scope: parsedIntent.data.scope,
          type: "update",
        }
      : parsedIntent.data;
  if (mutation.names.length === 0) {
    return mutationPreparationFailure(
      "mutation_ineligible",
      "No matching Skills are eligible for this mutation.",
    );
  }
  if (
    mutation.type !== "add" &&
    mutation.names.some(
      (name) => !matchingEntries.some((entry) => entry.name === name),
    )
  ) {
    return mutationPreparationFailure(
      "mutation_ineligible",
      "The selected Skills are not present in the Fresh Inventory.",
    );
  }

  const boundHarness = resolveBoundHarnessSubset(
    parsedIntent.data,
    scopedHarness.value,
  );
  if (!boundHarness.ok) return boundHarness;
  const boundHarnessIds = boundHarness.value;

  const args = mutationArguments(mutation, boundHarnessIds);
  const harnessEffect: CommandPlanHarnessEffect =
    mutation.type === "update"
      ? {
          kind: "cli-unscoped",
          targetHarnessIds: [...scopedHarness.value],
        }
      : { harnessIds: [...boundHarnessIds], kind: "bound" };
  const commandPlan: CommandPlan = {
    harness:
      boundHarnessIds.length === scopedHarness.value.length
        ? (options.binding.harness ?? scopedHarness.value.join(" "))
        : boundHarnessIds.join(" "),
    harnessEffect,
    ...(boundHarnessIds.length > 1
      ? { harnessIds: [...boundHarnessIds] }
      : {}),
    names: [...mutation.names],
    operation: mutation.type,
    preview: [`npx skills@${CLI_VERSION}`, ...args].join(" "),
    schemaVersion: 1,
    scope: mutation.scope,
    source: mutation.type === "add" ? commandPlanSource(mutation.source) : null,
    targetId: options.binding.targetId,
    timeoutMs:
      mutation.type === "remove" ? REMOVE_TIMEOUT_MS : WRITE_TIMEOUT_MS,
  };
  const id =
    options.id?.() ??
    createHash("sha256")
      .update(
        `${options.clock().toISOString()}\0${input.inventoryId}\0${commandPlan.preview}`,
      )
      .digest("hex");
  const expiresAt = new Date(
    options.clock().getTime() + PREPARED_MUTATION_TTL_MS,
  ).toISOString();
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        commandPlan,
        expiresAt,
        id,
        inventoryId: input.inventoryId,
        targetGeneration: options.binding.generation,
        targetId: options.binding.targetId,
      }),
    )
    .digest("hex");
  const prepared: PreparedMutation = {
    commandPlan,
    digest,
    expiresAt,
    id,
    inventoryId: input.inventoryId,
    targetGeneration: options.binding.generation,
    targetId: options.binding.targetId,
  };
  return { ok: true, value: { args, boundHarnessIds, mutation, prepared } };
}

/**
 * Resolves the add/remove harness subset against the scoped Target set.
 * Every requested harness must already belong to the Target; an intent
 * without a subset binds the whole scoped set. Update ignores subsets
 * because the pinned CLI cannot scope `update` by harness.
 */
function resolveBoundHarnessSubset(
  intent: MutationIntent,
  scopedHarnessIds: readonly HarnessId[],
): Result<readonly HarnessId[], MutationPreparationError> {
  if (intent.type === "update" || intent.type === "update-all") {
    return { ok: true, value: scopedHarnessIds };
  }
  if (intent.harnessIds === undefined) {
    return { ok: true, value: scopedHarnessIds };
  }
  const resolved: HarnessId[] = [];
  for (const requested of intent.harnessIds) {
    const alias = resolveLegacyHarnessAlias(requested);
    if (!alias.ok || !scopedHarnessIds.includes(alias.value)) {
      return mutationPreparationFailure(
        "mutation_ineligible",
        "The requested harness subset is not part of the Target harness set in the selected scope.",
      );
    }
    resolved.push(alias.value);
  }
  const normalized = normalizeHarnessIds(resolved);
  if (!normalized.ok) {
    return mutationPreparationFailure(
      "mutation_ineligible",
      "The requested harness subset is not supported by the pinned Skills dialect.",
    );
  }
  return { ok: true, value: normalized.value };
}

export function observedMutationEffects(
  mutation: NormalizedMutation,
  inventory: Inventory,
  harness: string | readonly string[],
): MutationOutcome["effects"] {
  const harnessIds = typeof harness === "string" ? [harness] : harness;
  const matches = (name: string) =>
    inventory.entries.find(
      (entry) => entry.name === name && entry.scope === mutation.scope,
    );
  if (mutation.type === "remove") {
    return {
      status: mutation.names.every(
        (name) => {
          const entry = matches(name);
          return (
            entry === undefined ||
            harnessIds.every(
              (harnessId) =>
                !isInventoryEntryAvailableToHarness(entry, harnessId),
            )
          );
        },
      )
        ? "verified"
        : "not-observed",
    };
  }
  if (mutation.type === "add") {
    const { source } = mutation;
    // Only a plain GitHub owner/repository add can be matched against the
    // CLI's declared source. Pinned archives and inspected descriptors are
    // recorded by the CLI in forms this dialect does not reproduce, so their
    // presence is observed but their content stays unverified.
    const exactGithub =
      source.sourceType === "github" && source.revision === undefined
        ? source.source
        : source.sourceType === "inspected" &&
            source.descriptor.family === "github" &&
            source.descriptor.ref === null &&
            !source.descriptor.source.includes(":") &&
            !source.descriptor.source.includes("#")
          ? source.descriptor.source
          : undefined;
    const observed = mutation.names.every((name) => {
      const entry = matches(name);
      const availableToHarnesses =
        entry !== undefined &&
        harnessIds.length > 0 &&
        harnessIds.every((harnessId) =>
          isInventoryEntryAvailableToHarness(entry, harnessId),
        );
      if (!availableToHarnesses || entry === undefined) return false;
      if (exactGithub !== undefined) {
        return (
          entry.declaredSource.sourceType === "github" &&
          entry.declaredSource.source === exactGithub
        );
      }
      if (source.sourceType === "github") {
        const declaredSourceMatches =
          entry.declaredSource.sourceType === "github" &&
          entry.declaredSource.source === source.source;
        const declaredSourceIsAbsent =
          entry.declaredSource.sourceType === null &&
          entry.declaredSource.source === null;
        return declaredSourceMatches || declaredSourceIsAbsent;
      }
      return true;
    });
    return {
      status: observed
        ? exactGithub !== undefined
          ? "verified"
          : "content-unverified"
        : "not-observed",
    };
  }
  if (
    mutation.names.some((name) => {
      const entry = matches(name);
      return (
        entry === undefined ||
        harnessIds.length === 0 ||
        harnessIds.some(
          (harnessId) =>
            !isInventoryEntryAvailableToHarness(entry, harnessId),
        )
      );
    })
  ) {
    return { status: "not-observed" };
  }
  return { status: "content-unverified" };
}
