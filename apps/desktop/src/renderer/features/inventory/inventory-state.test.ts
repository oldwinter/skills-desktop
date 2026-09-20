import { describe, expect, it } from "vitest";

import type { Translator } from "../../../contracts/i18n/translate.js";
import type {
  RendererError,
  TargetDefinition,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";
import {
  freshnessLabel,
  isTargetOffline,
  scopeFilterLabel,
  scopeLabel,
  statusLabel,
  statusTone,
  targetOptionLabel,
} from "./inventory-state.js";

const t: Translator["t"] = (key) => key;

const localTarget: TargetDefinition = {
  connectionReference: null,
  dialectId: "skills-1.5.23",
  executionBindingDigest: null,
  generation: 1,
  harnessIds: ["codex"],
  id: "00000000-0000-4000-8000-000000000001",
  kind: "local",
  label: "This device",
  registryDigest:
    "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de",
  registryVersion: 1,
  workspace: "/work/skills-desktop",
  workspaceLabel: "skills-desktop",
};

const sshTarget: TargetDefinition = {
  ...localTarget,
  connectionReference: "deploy@example.com",
  kind: "ssh",
  label: "Build host",
};

function error(code: RendererError["code"]): RendererError {
  return {
    code,
    effects: "none",
    message: "Transport failed.",
    phase: "inventory",
    retryable: true,
  };
}

function snapshot(
  overrides: {
    freshness?: WorkspaceSnapshot["inventory"]["freshness"];
    lastError?: RendererError | null;
    phase?: WorkspaceSnapshot["inventory"]["phase"];
    target?: TargetDefinition;
  } = {},
): WorkspaceSnapshot {
  return {
    eventSequence: 0,
    inventory: {
      activeOperationId: null,
      cliVersion: "1.5.23",
      entries: [],
      freshness: overrides.freshness ?? "fresh",
      lastError: overrides.lastError ?? null,
      observedAt: "2026-08-21T10:00:00.000Z",
      persistenceWarning: null,
      phase: overrides.phase ?? "ready",
    },
    mutation: {
      activeOperationId: null,
      commandPlan: null,
      lastError: null,
      outcome: null,
      phase: "idle",
      reconciliationDeadline: null,
    },
    schemaVersion: 2,
    sessionEpoch: "epoch-1",
    stateRevision: 0,
    target: overrides.target ?? localTarget,
  };
}

describe("freshnessLabel", () => {
  it("maps each freshness state to its message key", () => {
    expect(freshnessLabel(t, "fresh")).toBe("common.freshness.fresh");
    expect(freshnessLabel(t, "stale")).toBe("common.freshness.stale");
    expect(freshnessLabel(t, "none")).toBe("common.freshness.none");
  });
});

describe("isTargetOffline", () => {
  it("requires an ssh target and a transport-class error", () => {
    expect(
      isTargetOffline(
        snapshot({ lastError: error("transport_failed"), target: sshTarget }),
      ),
    ).toBe(true);
    expect(
      isTargetOffline(
        snapshot({ lastError: error("transport_lost"), target: sshTarget }),
      ),
    ).toBe(true);
    expect(
      isTargetOffline(
        snapshot({ lastError: error("remote_unreachable"), target: sshTarget }),
      ),
    ).toBe(false);
    expect(
      isTargetOffline(snapshot({ lastError: error("transport_failed") })),
    ).toBe(false);
    expect(isTargetOffline(snapshot({ target: sshTarget }))).toBe(false);
  });
});

describe("statusLabel", () => {
  it("prefers phase-specific keys over the freshness label", () => {
    expect(statusLabel(t, snapshot({ phase: "loading" }))).toBe(
      "status.refreshing",
    );
    expect(statusLabel(t, snapshot({ phase: "cancelled" }))).toBe(
      "status.refreshCancelled",
    );
    expect(
      statusLabel(
        t,
        snapshot({
          lastError: error("transport_failed"),
          phase: "error",
          target: sshTarget,
        }),
      ),
    ).toBe("status.offline");
    expect(
      statusLabel(
        t,
        snapshot({ freshness: "stale", lastError: error("process_failed"), phase: "error" }),
      ),
    ).toBe("status.staleAfterError");
    expect(
      statusLabel(
        t,
        snapshot({ lastError: error("process_failed"), phase: "error" }),
      ),
    ).toBe("status.refreshError");
    expect(statusLabel(t, snapshot({ freshness: "stale" }))).toBe(
      "common.freshness.stale",
    );
  });
});

describe("statusTone", () => {
  it("maps snapshot state to the display tone", () => {
    expect(
      statusTone(snapshot({ lastError: error("process_failed"), phase: "error" })),
    ).toBe("danger");
    expect(statusTone(snapshot({ phase: "cancelled" }))).toBe("warning");
    expect(statusTone(snapshot({ freshness: "stale" }))).toBe("warning");
    expect(statusTone(snapshot())).toBe("healthy");
    expect(statusTone(snapshot({ freshness: "none" }))).toBe("neutral");
  });
});

describe("scope and target labels", () => {
  it("maps scope values to their message keys", () => {
    expect(scopeLabel(t, "project")).toBe("common.scope.project");
    expect(scopeLabel(t, "global")).toBe("common.scope.global");
    expect(scopeFilterLabel(t, "project")).toBe("common.scope.projectScope");
    expect(scopeFilterLabel(t, "global")).toBe("common.scope.globalScope");
  });

  it("wraps ssh target labels in the transport key and passes locals through", () => {
    expect(targetOptionLabel(t, localTarget)).toBe("This device");
    expect(targetOptionLabel(t, sshTarget)).toBe("common.ssh.targetOption");
  });
});
