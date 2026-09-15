import {
  HARNESS_REGISTRY,
  normalizeHarnessIds,
} from "@skills-desktop/skills-runtime";

/**
 * Renderer-safe projection of the pinned Harness Compatibility Registry.
 * Only display facts leave the registry; the renderer never learns CLI
 * arguments, shared-effect groups, or inventory tokens from this module.
 */
export interface HarnessOption {
  readonly id: string;
  readonly label: string;
  readonly globalScopeSupported: boolean;
}

export const HARNESS_OPTIONS: readonly HarnessOption[] = Object.freeze(
  HARNESS_REGISTRY.map((entry) =>
    Object.freeze({
      globalScopeSupported: entry.scopeSupport.global,
      id: entry.cliId,
      label: entry.displayAliases[0] ?? entry.cliId,
    }),
  ),
);

export type HarnessSelectionResult =
  | { readonly ok: true; readonly value: readonly string[] }
  | {
      readonly ok: false;
      readonly code: "empty_harness_set" | "unsupported_harness";
      readonly message: string;
    };

/** Deduplicates and orders a draft selection exactly as the contract expects. */
export function normalizeHarnessSelection(
  harnessIds: readonly string[],
): HarnessSelectionResult {
  const normalized = normalizeHarnessIds(harnessIds);
  if (normalized.ok) return { ok: true, value: normalized.value };
  return {
    code:
      normalized.error.code === "empty_harness_set"
        ? "empty_harness_set"
        : "unsupported_harness",
    message: normalized.error.message,
    ok: false,
  };
}

export function matchesHarnessQuery(
  option: HarnessOption,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return (
    option.id.toLowerCase().includes(needle) ||
    option.label.toLowerCase().includes(needle)
  );
}
