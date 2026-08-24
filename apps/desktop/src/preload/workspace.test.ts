import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  once: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: {
    invoke: electron.invoke,
    on: electron.on,
    once: electron.once,
    removeListener: electron.removeListener,
  },
}));

const workspaceError = {
  error: {
    code: "internal_error",
    effects: "none",
    message: "The request could not be completed.",
    phase: "request",
    retryable: true,
  },
  ok: false,
} as const;

const aboutError = {
  error: {
    code: "internal_error",
    message: "The update request could not be completed.",
    retryable: true,
  },
  ok: false,
} as const;

const targetId = "00000000-0000-4000-8000-000000000001";
const secondTargetId = "00000000-0000-4000-8000-000000000002";
const targetDraft = {
  connectionReference: null,
  harness: "Codex",
  kind: "local",
  label: "This device",
  workspace: "/workspace",
} as const;
const mutationIntent = {
  names: ["find-skills"],
  scope: "project",
  source: {
    source: "vercel-labs/skills",
    sourceType: "github",
  },
  type: "add",
} as const;
const desktopEvent = {
  reason: "buffer_overflow",
  sequence: 1,
  sessionEpoch: "epoch-1",
  stateRevision: 1,
  type: "resync.required",
} as const;
const aboutSnapshot = {
  application: { architecture: "x64", platform: "linux", version: "0.1.0" },
  lastCheckAt: null,
  nextAutomaticCheckAt: null,
  policy: {
    message: "Update checks are unavailable for this build.",
    mode: "unavailable",
  },
  schemaVersion: 1,
  state: { kind: "unavailable" },
} as const;

async function loadBridge() {
  vi.resetModules();
  await import("./workspace.js");
  return electron.exposeInMainWorld.mock.calls.at(-1)?.[1] as {
    readonly about: {
      exportDiagnostics(): Promise<unknown>;
      getSnapshot(): Promise<unknown>;
      requestCheck(): Promise<unknown>;
      requestRestart(candidateId: string): Promise<unknown>;
      subscribe(listener: (snapshot: unknown) => void): () => void;
    };
    cancelInventory(operationId: string): Promise<unknown>;
    compareTargets(
      leftTargetId: string,
      rightTargetId: string,
    ): Promise<unknown>;
    createTarget(definition: typeof targetDraft): Promise<unknown>;
    deleteTarget(targetId: string): Promise<unknown>;
    getSnapshot(): Promise<unknown>;
    prepareMutation(
      targetId: string,
      intent: typeof mutationIntent,
    ): Promise<unknown>;
    prepareCollection(request: Record<string, unknown>): Promise<unknown>;
    prepareCollectionAcrossTargets(
      request: Record<string, unknown>,
    ): Promise<unknown>;
    prepareComparison(
      comparisonId: string,
      rowKey: string,
      destinationTargetId: string,
    ): Promise<unknown>;
    reconcileMutation(targetId: string): Promise<unknown>;
    refreshInventory(targetId: string): Promise<unknown>;
    requestCancellationReview(operationId: string): Promise<unknown>;
    requestCollectionReview(collectionPlanId: string): Promise<unknown>;
    requestHostTrustReview(targetId: string): Promise<unknown>;
    requestReview(preparedMutationId: string): Promise<unknown>;
    subscribe(listener: (event: unknown) => void): () => void;
    updateTarget(
      targetId: string,
      definition: typeof targetDraft,
    ): Promise<unknown>;
  };
}

describe("workspace preload authority", () => {
  beforeEach(() => {
    electron.exposeInMainWorld.mockClear();
    electron.invoke.mockReset();
    electron.invoke.mockImplementation(async (channel: string) =>
      channel.startsWith("about:") ? aboutError : workspaceError,
    );
    electron.on.mockClear();
    electron.once.mockReset();
    electron.once.mockImplementation(
      (_channel: string, listener: (event: unknown, value: unknown) => void) =>
        listener({}, "attachment-epoch"),
    );
    electron.removeListener.mockClear();
  });

  it("exposes only bounded About status, restart intent, and diagnostic export capabilities", async () => {
    const bridge = await loadBridge();

    expect(Object.keys(bridge.about).sort()).toEqual([
      "exportDiagnostics",
      "getSnapshot",
      "requestCheck",
      "requestRestart",
      "subscribe",
    ]);
    await bridge.about.requestCheck();
    expect(electron.invoke).toHaveBeenCalledWith(
      "about:update:check",
      "attachment-epoch",
      { type: "update.check", version: 1 },
    );
    await bridge.about.requestRestart("00000000-0000-4000-8000-000000000025");
    expect(electron.invoke).toHaveBeenCalledWith(
      "about:update:restart",
      "attachment-epoch",
      {
        candidateId: "00000000-0000-4000-8000-000000000025",
        type: "update.restart",
        version: 1,
      },
    );
    await bridge.about.exportDiagnostics();
    expect(electron.invoke).toHaveBeenCalledWith(
      "about:release-diagnostics:export",
      "attachment-epoch",
      { type: "release-diagnostics.export", version: 1 },
    );
  });

  it("routes every workspace capability through its fixed IPC channel", async () => {
    const bridge = await loadBridge();
    const collectionRequest = {
      collectionId: "starter",
      manifestDigest: `sha256:${"a".repeat(64)}`,
      releaseNumber: 1,
      scope: "project",
      selections: [{ mode: "add", name: "find-skills" }],
      targetId,
    };
    const collectionManyRequest = {
      collectionId: "starter",
      manifestDigest: `sha256:${"a".repeat(64)}`,
      releaseNumber: 1,
      targets: [
        {
          scope: "project",
          selections: [{ mode: "add", name: "find-skills" }],
          targetId,
        },
      ],
    };

    await bridge.cancelInventory("operation-1");
    await bridge.compareTargets(targetId, secondTargetId);
    await bridge.createTarget(targetDraft);
    await bridge.deleteTarget(targetId);
    await bridge.getSnapshot();
    await bridge.prepareMutation(targetId, mutationIntent);
    await bridge.prepareCollection(collectionRequest);
    await bridge.prepareCollectionAcrossTargets(collectionManyRequest);
    await bridge.prepareComparison(
      "comparison-1",
      "find-skills",
      secondTargetId,
    );
    await bridge.reconcileMutation(targetId);
    await bridge.refreshInventory(targetId);
    await bridge.requestCancellationReview("operation-1");
    await bridge.requestCollectionReview("collection-plan-1");
    await bridge.requestHostTrustReview(targetId);
    await bridge.requestReview("prepared-1");
    await bridge.updateTarget(targetId, targetDraft);

    expect(electron.invoke.mock.calls).toEqual([
      ["workspace:inventory:cancel", "attachment-epoch", "operation-1"],
      [
        "workspace:comparison:open",
        "attachment-epoch",
        targetId,
        secondTargetId,
      ],
      ["workspace:target:create", "attachment-epoch", targetDraft],
      ["workspace:target:delete", "attachment-epoch", targetId],
      ["workspace:snapshot:get", "attachment-epoch"],
      [
        "workspace:mutation:prepare",
        "attachment-epoch",
        targetId,
        mutationIntent,
      ],
      ["workspace:collection:prepare", "attachment-epoch", collectionRequest],
      [
        "workspace:collection:prepare-many",
        "attachment-epoch",
        collectionManyRequest,
      ],
      [
        "workspace:comparison:prepare",
        "attachment-epoch",
        "comparison-1",
        "find-skills",
        secondTargetId,
      ],
      ["workspace:mutation:reconcile", "attachment-epoch", targetId],
      ["workspace:inventory:refresh", "attachment-epoch", targetId],
      ["workspace:review:cancel-request", "attachment-epoch", "operation-1"],
      [
        "workspace:collection:review-request",
        "attachment-epoch",
        "collection-plan-1",
      ],
      ["workspace:host-trust:review", "attachment-epoch", targetId],
      ["workspace:review:request", "attachment-epoch", "prepared-1"],
      ["workspace:target:update", "attachment-epoch", targetId, targetDraft],
    ]);
  });

  it("keeps the attachment epoch private and fails closed when it is malformed", async () => {
    electron.once.mockImplementationOnce(
      (_channel: string, listener: (event: unknown, value: unknown) => void) =>
        listener({}, { exposed: true }),
    );
    const bridge = await loadBridge();

    expect(Object.keys(bridge)).not.toContain("attachmentEpoch");
    await expect(bridge.getSnapshot()).rejects.toThrow(
      "Invalid desktop attachment epoch.",
    );
    expect(electron.invoke).not.toHaveBeenCalled();
  });

  it("validates workspace results and removes event listeners on unsubscribe", async () => {
    const bridge = await loadBridge();
    const listener = vi.fn();
    const cleanup = bridge.subscribe(listener);
    const receive = electron.on.mock.calls[0]?.[1] as (
      event: unknown,
      value: unknown,
    ) => void;

    receive({}, desktopEvent);
    expect(listener).toHaveBeenCalledWith(desktopEvent);
    cleanup();
    expect(electron.removeListener).toHaveBeenCalledWith(
      "workspace:event",
      receive,
    );

    electron.invoke.mockResolvedValue({ ok: true });
    await expect(bridge.getSnapshot()).rejects.toThrow();
    expect(() => receive({}, { type: "unexpected" })).toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("validates About results and cleans up update snapshot subscriptions", async () => {
    const bridge = await loadBridge();
    electron.invoke.mockResolvedValue(aboutError);
    await expect(bridge.about.getSnapshot()).resolves.toEqual(aboutError);
    await expect(bridge.about.requestCheck()).resolves.toEqual(aboutError);
    await expect(bridge.about.requestRestart(targetId)).resolves.toEqual(
      aboutError,
    );
    await expect(bridge.about.exportDiagnostics()).resolves.toEqual(aboutError);

    const listener = vi.fn();
    const cleanup = bridge.about.subscribe(listener);
    const receive = electron.on.mock.calls[0]?.[1] as (
      event: unknown,
      value: unknown,
    ) => void;
    receive({}, aboutSnapshot);
    expect(listener).toHaveBeenCalledWith(aboutSnapshot);
    cleanup();
    expect(electron.removeListener).toHaveBeenCalledWith(
      "about:update:snapshot-changed",
      receive,
    );

    expect(() => receive({}, { schemaVersion: 999 })).toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
