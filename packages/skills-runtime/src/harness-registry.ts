import {
  CLI_PACKAGE,
  CLI_VERSION,
  INVENTORY_SCHEMA_VERSION,
  type InventoryScope,
} from "./inventory.js";
import type { PublicError, Result } from "./result.js";

export const SKILLS_DIALECT_ID = "skills-1.5.23" as const;
export const HARNESS_REGISTRY_VERSION = 1 as const;

type SharedEffectGroup =
  | "global:config-agents"
  | "global:home-agents"
  | "global:zencoder"
  | "project:agents"
  | "project:qoder"
  | "project:trae"
  | "project:zencoder";

type HarnessDefinition = readonly [
  id: string,
  displayAlias: string,
  projectSharedEffectGroup?: SharedEffectGroup | null,
  globalSharedEffectGroup?: SharedEffectGroup | null,
  globalSupported?: boolean,
];

const definitions = [
  ["aider-desk", "AiderDesk"],
  ["amp", "Amp", "project:agents", "global:config-agents"],
  ["antigravity", "Antigravity", "project:agents"],
  ["antigravity-cli", "Antigravity CLI", "project:agents"],
  ["astrbot", "AstrBot"],
  ["autohand-code", "Autohand Code CLI"],
  ["augment", "Augment"],
  ["bob", "IBM Bob"],
  ["claude-code", "Claude Code"],
  ["openclaw", "OpenClaw"],
  ["cline", "Cline", "project:agents"],
  ["codearts-agent", "CodeArts Agent"],
  ["codebuddy", "CodeBuddy"],
  ["codemaker", "Codemaker"],
  ["codestudio", "Code Studio"],
  ["codex", "Codex", "project:agents"],
  ["command-code", "Command Code"],
  ["continue", "Continue"],
  ["cortex", "Cortex Code"],
  ["crush", "Crush"],
  ["cursor", "Cursor", "project:agents"],
  ["deepagents", "Deep Agents", "project:agents"],
  ["devin", "Devin for Terminal"],
  ["dexto", "Dexto", "project:agents", "global:home-agents"],
  ["droid", "Droid"],
  ["eve", "Eve", null, null, false],
  ["firebender", "Firebender", "project:agents"],
  ["forgecode", "ForgeCode"],
  ["gemini-cli", "Gemini CLI", "project:agents"],
  ["github-copilot", "GitHub Copilot", "project:agents"],
  ["goose", "Goose"],
  ["grok", "Grok Build"],
  ["hermes-agent", "Hermes Agent"],
  ["inference-sh", "inference.sh"],
  ["jazz", "Jazz"],
  ["junie", "Junie"],
  ["iflow-cli", "iFlow CLI"],
  ["kilo", "Kilo Code"],
  ["kimchi", "Kimchi"],
  ["kimi-code-cli", "Kimi Code CLI", "project:agents", "global:home-agents"],
  ["kiro-cli", "Kiro CLI"],
  ["kode", "Kode"],
  ["lingma", "Lingma"],
  ["loaf", "Loaf", "project:agents", "global:home-agents"],
  ["mcpjam", "MCPJam"],
  ["minimax-code", "MiniMax Code"],
  ["mistral-vibe", "Mistral Vibe"],
  ["moxby", "Moxby"],
  ["mux", "Mux"],
  ["opencode", "OpenCode", "project:agents"],
  ["openhands", "OpenHands"],
  ["ona", "Ona"],
  ["pi", "Pi"],
  ["posit-assistant", "Posit Assistant"],
  ["qoder", "Qoder", "project:qoder"],
  ["qoder-cn", "Qoder CN", "project:qoder"],
  ["qwen-code", "Qwen Code"],
  ["replit", "Replit", "project:agents", "global:config-agents"],
  ["reasonix", "Reasonix"],
  ["rovodev", "Rovo Dev"],
  ["roo", "Roo Code"],
  ["tabnine-cli", "Tabnine CLI"],
  ["terramind", "Terramind"],
  ["tinycloud", "Tinycloud"],
  ["trae", "Trae", "project:trae"],
  ["trae-cn", "Trae CN", "project:trae"],
  ["warp", "Warp", "project:agents", "global:home-agents"],
  ["windsurf", "Windsurf"],
  ["zed", "Zed", "project:agents", "global:home-agents"],
  ["zcode", "ZCode"],
  ["zencoder", "Zencoder", "project:zencoder", "global:zencoder"],
  ["zenflow", "Zenflow", "project:zencoder", "global:zencoder"],
  ["neovate", "Neovate"],
  ["pochi", "Pochi"],
  ["promptscript", "PromptScript", "project:agents", null, false],
  ["adal", "AdaL"],
  ["universal", "Universal", "project:agents", "global:config-agents"],
] as const satisfies readonly HarnessDefinition[];

export type HarnessId = (typeof definitions)[number][0];

export const HARNESS_IDS: readonly HarnessId[] = Object.freeze(
  definitions.map(([id]) => id),
);

export interface HarnessRegistryEntry {
  readonly cliId: HarnessId;
  readonly displayAliases: readonly string[];
  readonly displayMessageKey: `harness.${HarnessId}`;
  readonly emptyAgentListCoverage: "absent" | "direct";
  readonly inventoryTokens: readonly string[];
  readonly sharedEffectGroups: Readonly<
    Record<InventoryScope, SharedEffectGroup | null>
  >;
  readonly scopeSupport: Readonly<Record<InventoryScope, boolean>>;
}

export const HARNESS_REGISTRY: readonly HarnessRegistryEntry[] = Object.freeze(
  definitions.map(
    ([
      cliId,
      displayAlias,
      projectSharedEffectGroup = null,
      globalSharedEffectGroup = null,
      globalSupported = true,
    ]) =>
      Object.freeze({
        cliId,
        displayAliases: Object.freeze([displayAlias]),
        displayMessageKey: `harness.${cliId}` as const,
        emptyAgentListCoverage:
          cliId === "codex" ? ("direct" as const) : ("absent" as const),
        inventoryTokens: Object.freeze([displayAlias]),
        sharedEffectGroups: Object.freeze({
          global: globalSharedEffectGroup,
          project: projectSharedEffectGroup,
        }),
        scopeSupport: Object.freeze({
          global: globalSupported,
          project: true,
        }),
      }),
  ),
);

export type HarnessCoverage = "absent" | "direct" | "shared" | "unknown";

const registryById = new Map(
  HARNESS_REGISTRY.map((entry) => [entry.cliId, entry]),
);
export const LEGACY_HARNESS_ID_BY_EXACT_INPUT: Readonly<
  Record<string, HarnessId>
> = Object.freeze(
  Object.fromEntries(
    HARNESS_REGISTRY.flatMap((entry) => [
      [entry.cliId, entry.cliId] as const,
      ...entry.displayAliases.map((alias) => [alias, entry.cliId] as const),
    ]),
  ),
);
export const HARNESS_SCOPE_SUPPORT_BY_ID: Readonly<
  Record<HarnessId, Readonly<Record<InventoryScope, boolean>>>
> = Object.freeze(
  Object.fromEntries(
    HARNESS_REGISTRY.map((entry) => [
      entry.cliId,
      entry.scopeSupport,
    ]),
  ) as Record<HarnessId, Readonly<Record<InventoryScope, boolean>>>,
);
const registryByInventoryToken = new Map(
  HARNESS_REGISTRY.flatMap((entry) =>
    entry.inventoryTokens.map((token) => [token, entry] as const),
  ),
);

export type HarnessRegistryError = PublicError<
  "empty_harness_set" | "unsupported_harness" | "unsupported_harness_scope"
> & {
  readonly unsupportedHarnessIds?: readonly string[];
};

const harnessIds = new Set<string>(HARNESS_IDS);

function failure(
  code: HarnessRegistryError["code"],
  message: string,
  unsupportedHarnessIds?: readonly string[],
): Result<never, HarnessRegistryError> {
  return {
    error: {
      code,
      effects: "none",
      message,
      phase: "prepare",
      retryable: false,
      ...(unsupportedHarnessIds === undefined ? {} : { unsupportedHarnessIds }),
    },
    ok: false,
  };
}

export function parseHarnessId(
  value: string,
): Result<HarnessId, HarnessRegistryError> {
  return harnessIds.has(value)
    ? { ok: true, value: value as HarnessId }
    : failure(
        "unsupported_harness",
        "Harness is not supported by skills@1.5.23.",
        [value],
      );
}

export function normalizeHarnessIds(
  values: readonly string[],
): Result<readonly HarnessId[], HarnessRegistryError> {
  if (values.length === 0) {
    return failure("empty_harness_set", "At least one harness is required.");
  }

  const selected = new Set<HarnessId>();
  for (const value of values) {
    const parsed = parseHarnessId(value);
    if (!parsed.ok) return parsed;
    selected.add(parsed.value);
  }

  return {
    ok: true,
    value: HARNESS_IDS.filter((id) => selected.has(id)),
  };
}

export function resolveLegacyHarnessAlias(
  value: string,
): Result<HarnessId, HarnessRegistryError> {
  const resolved = LEGACY_HARNESS_ID_BY_EXACT_INPUT[value];
  return resolved === undefined
    ? failure(
        "unsupported_harness",
        "Legacy harness alias is not supported by skills@1.5.23.",
        [value],
      )
    : { ok: true, value: resolved };
}

export function getHarnessRegistryEntry(
  harnessId: HarnessId,
): HarnessRegistryEntry {
  const entry = registryById.get(harnessId);
  if (entry === undefined) {
    throw new Error("Harness registry invariant violated.");
  }
  return entry;
}

export function validateHarnessScope(
  values: readonly string[],
  scope: InventoryScope,
): Result<readonly HarnessId[], HarnessRegistryError> {
  const normalized = normalizeHarnessIds(values);
  if (!normalized.ok) return normalized;
  const unsupportedHarnessIds = normalized.value.filter(
    (id) => !getHarnessRegistryEntry(id).scopeSupport[scope],
  );
  if (unsupportedHarnessIds.length > 0) {
    return failure(
      "unsupported_harness_scope",
      "The selected harness set is not supported in this scope.",
      unsupportedHarnessIds,
    );
  }
  return normalized;
}

export function interpretHarnessCoverage(input: {
  readonly harnessId: HarnessId;
  readonly inventoryTokens: readonly string[];
  readonly scope: InventoryScope;
}): HarnessCoverage {
  const selected = getHarnessRegistryEntry(input.harnessId);
  if (!selected.scopeSupport[input.scope]) return "unknown";

  if (input.inventoryTokens.length === 0) {
    return selected.emptyAgentListCoverage;
  }

  const evidence = input.inventoryTokens.map((token) =>
    registryByInventoryToken.get(token),
  );
  if (evidence.some((entry) => entry === undefined)) return "unknown";
  const knownEvidence = evidence.filter(
    (entry): entry is HarnessRegistryEntry => entry !== undefined,
  );
  if (knownEvidence.some((entry) => entry.cliId === input.harnessId)) {
    return "direct";
  }

  const selectedSharedGroup = selected.sharedEffectGroups[input.scope];
  return selectedSharedGroup !== null &&
    knownEvidence.some(
      (entry) => entry.sharedEffectGroups[input.scope] === selectedSharedGroup,
    )
    ? "shared"
    : "absent";
}

export function canonicalHarnessRegistryJson(): string {
  return JSON.stringify({
    dialectId: SKILLS_DIALECT_ID,
    registryVersion: HARNESS_REGISTRY_VERSION,
    entries: HARNESS_REGISTRY,
  });
}

export const HARNESS_REGISTRY_DIGEST =
  "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de" as const;

export const SKILLS_DIALECT = {
  cliVersion: CLI_VERSION,
  harnessRegistryDigest: HARNESS_REGISTRY_DIGEST,
  harnessRegistryVersion: HARNESS_REGISTRY_VERSION,
  id: SKILLS_DIALECT_ID,
  inventorySchemaVersion: INVENTORY_SCHEMA_VERSION,
  package: CLI_PACKAGE,
  sourceListingDialectVersion: 1,
} as const;
