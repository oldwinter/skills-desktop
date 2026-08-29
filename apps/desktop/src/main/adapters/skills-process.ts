import { createHash } from "node:crypto";

import {
  CLI_VERSION,
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
} from "@skills-desktop/skills-runtime";
import { isInventoryEntryAvailableToHarness } from "../../contracts/inventory-availability.js";

const PREPARED_MUTATION_TTL_MS = 10 * 60_000;
const REMOVE_TIMEOUT_MS = 2 * 60_000;
const WRITE_TIMEOUT_MS = 10 * 60_000;

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

export interface CommandPlan {
  readonly harness: string;
  readonly harnessIds?: string[];
  readonly names: readonly string[];
  readonly operation: "add" | "remove" | "update";
  readonly preview: string;
  readonly schemaVersion: 1;
  readonly scope: "global" | "project";
  readonly source: {
    readonly revision?: string;
    readonly source: string;
    readonly sourceType: "github";
  } | null;
  readonly targetId: string;
  readonly timeoutMs: number;
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
  observeInventory(input: {
    readonly signal: AbortSignal;
  }): Promise<Result<Inventory, ObservationError>>;
  prepareMutation(
    input: PrepareMutationInput,
  ): Promise<Result<PreparedMutation, MutationPreparationError>>;
}

export type NormalizedMutation = Exclude<
  MutationIntent,
  { readonly type: "update-all" }
>;

export interface PreparedMutationPlan {
  readonly args: readonly string[];
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
      intent.source.revision === undefined
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

  const args = mutationArguments(mutation, scopedHarness.value);
  const commandPlan: CommandPlan = {
    harness: options.binding.harness ?? scopedHarness.value.join(" "),
    ...(scopedHarness.value.length > 1
      ? { harnessIds: [...scopedHarness.value] }
      : {}),
    names: [...mutation.names],
    operation: mutation.type,
    preview: [`npx skills@${CLI_VERSION}`, ...args].join(" "),
    schemaVersion: 1,
    scope: mutation.scope,
    source: mutation.type === "add" ? { ...mutation.source } : null,
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
  return { ok: true, value: { args, mutation, prepared } };
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
    const observed = mutation.names.every((name) => {
      const entry = matches(name);
      const availableToHarnesses =
        entry !== undefined &&
        harnessIds.length > 0 &&
        harnessIds.every((harnessId) =>
          isInventoryEntryAvailableToHarness(entry, harnessId),
        );
      if (!availableToHarnesses || entry === undefined) return false;
      const declaredSourceMatches =
        entry.declaredSource.sourceType === mutation.source.sourceType &&
        entry.declaredSource.source === mutation.source.source;
      const declaredSourceIsAbsent =
        entry.declaredSource.sourceType === null &&
        entry.declaredSource.source === null;
      return (
        declaredSourceMatches ||
        (mutation.source.revision !== undefined && declaredSourceIsAbsent)
      );
    });
    return {
      status: observed
        ? mutation.source.revision === undefined
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
