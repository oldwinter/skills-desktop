import type { Result } from "@skills-desktop/skills-runtime";

import {
  workspaceRequestSchema,
  type DesktopEvent,
  type PublicInventoryEntry,
  type PublicInventoryState,
  type RendererError,
  type TargetDefinition as PublicTargetDefinition,
  type WorkspaceRequestResult,
  type WorkspaceSnapshot,
} from "../../contracts/workspace.js";

import type { SkillsProcess } from "../adapters/local-skills-process.js";
import type {
  InventorySnapshot,
  RecoveryRecords,
} from "../persistence/recovery-records.js";

export type {
  DesktopEvent,
  PublicInventoryEntry,
  PublicInventoryState,
  WorkspaceSnapshot,
} from "../../contracts/workspace.js";

export type TargetOpenError = Omit<RendererError, "code"> & {
  readonly code: "target_not_found" | "target_unavailable";
};

export interface TargetDefinition {
  readonly generation: number;
  readonly harness: string;
  readonly id: string;
  readonly kind: "local" | "ssh";
  readonly label: string;
  readonly workspace: string;
  readonly workspaceLabel: string;
}

export interface EffectiveTargetBinding {
  readonly generation: number;
  readonly harness: string;
  readonly kind: TargetDefinition["kind"];
  readonly targetId: string;
  readonly workspace: string;
}

export interface TargetSession {
  readonly binding: EffectiveTargetBinding;
  readonly process: SkillsProcess;
  readonly target: TargetDefinition;
}

export interface SkillsTargets {
  readonly primaryTarget: TargetDefinition;
  open(targetId: string): Promise<Result<TargetSession, TargetOpenError>>;
}

export interface DesktopEndpoint {
  readonly endpointId: string;
  readonly role: "review" | "workspace";
  readonly sessionEpoch: string;
}

type RequestValue = { readonly operationId: string };
type RequestError = RendererError;

export interface DesktopSession {
  request(input: unknown): Promise<Result<RequestValue, RequestError>>;
  snapshot(): Promise<WorkspaceSnapshot>;
  teardown(): void;
}

export interface DesktopCapabilities {
  attach(
    endpoint: DesktopEndpoint,
    sink: (event: DesktopEvent) => void,
  ): DesktopSession;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface DesktopCapabilitiesOptions {
  readonly id: () => string;
  readonly recoveryRecords: RecoveryRecords;
  readonly scheduleEventDelivery?: (deliver: () => void) => void;
  readonly shutdownTimeoutMs?: number;
  readonly skillsTargets: SkillsTargets;
}

interface EndpointState extends DesktopEndpoint {
  closed: boolean;
  deliveryScheduled: boolean;
  pendingEvent: DesktopEvent | undefined;
  sequence: number;
  readonly sink: (event: DesktopEvent) => void;
}

interface ActiveObservation {
  readonly controller: AbortController;
  readonly id: string;
  readonly ownerEndpointId: string;
  readonly promise: Promise<Result<RequestValue, RequestError>>;
}

function publicError<Code extends RequestError["code"]>(
  code: Code,
  message: string,
  phase: string,
  retryable: boolean,
): Omit<RendererError, "code"> & { readonly code: Code } {
  return { code, effects: "none", message, phase, retryable };
}

function requestFailure(error: RequestError): Result<never, RequestError> {
  return { error, ok: false };
}

interface ProjectableInventoryEntry {
  readonly agents: readonly string[];
  readonly declaredSource: PublicInventoryEntry["declaredSource"];
  readonly name: string;
  readonly scope: PublicInventoryEntry["scope"];
}

function projectEntries(
  entries: readonly ProjectableInventoryEntry[],
): PublicInventoryEntry[] {
  return entries.map((entry) => ({
    agents: [...entry.agents],
    contentFingerprint: { status: "unknown" },
    declaredSource: { ...entry.declaredSource },
    name: entry.name,
    revision: { status: "unknown" },
    scope: entry.scope,
  }));
}

function staleAfterFailure(freshness: PublicInventoryState["freshness"]) {
  return freshness === "none" ? "none" : "stale";
}

function projectTarget(target: TargetDefinition): PublicTargetDefinition {
  return {
    generation: target.generation,
    harness: target.harness,
    id: target.id,
    kind: target.kind,
    label: target.label,
    workspaceLabel: target.workspaceLabel,
  };
}

export function createDesktopCapabilities(
  options: DesktopCapabilitiesOptions,
): DesktopCapabilities {
  const endpoints = new Map<string, EndpointState>();
  const scheduleEventDelivery = options.scheduleEventDelivery ?? queueMicrotask;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 3_000;
  const target = options.skillsTargets.primaryTarget;
  const publicTarget = projectTarget(target);
  let initialized = false;
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | undefined;
  let stateRevision = 0;
  let activeObservation: ActiveObservation | undefined;
  let inventoryState: PublicInventoryState = {
    activeOperationId: null,
    cliVersion: null,
    entries: [],
    freshness: "none",
    lastError: null,
    observedAt: null,
    persistenceWarning: null,
    phase: "ready",
  };

  const snapshotFor = (
    endpoint: EndpointState,
    eventSequence = endpoint.sequence,
  ): WorkspaceSnapshot => ({
    eventSequence,
    inventory: structuredClone(inventoryState),
    schemaVersion: 1,
    sessionEpoch: endpoint.sessionEpoch,
    stateRevision,
    target: publicTarget,
  });

  const enqueue = (endpoint: EndpointState, event: DesktopEvent) => {
    endpoint.pendingEvent =
      endpoint.pendingEvent === undefined
        ? event
        : {
            reason: "buffer_overflow",
            sequence: endpoint.sequence + 1,
            sessionEpoch: endpoint.sessionEpoch,
            stateRevision: event.stateRevision,
            type: "resync.required",
          };
    if (endpoint.deliveryScheduled) return;
    endpoint.deliveryScheduled = true;
    scheduleEventDelivery(() => {
      endpoint.deliveryScheduled = false;
      const pending = endpoint.pendingEvent;
      endpoint.pendingEvent = undefined;
      if (endpoint.closed || pending === undefined) return;
      endpoint.sequence = pending.sequence;
      endpoint.sink(pending);
    });
  };

  const publish = (next: PublicInventoryState) => {
    inventoryState = next;
    stateRevision += 1;
    for (const endpoint of endpoints.values()) {
      if (endpoint.closed || endpoint.role !== "workspace") continue;
      const sequence = endpoint.sequence + 1;
      enqueue(endpoint, {
        sequence,
        sessionEpoch: endpoint.sessionEpoch,
        snapshot: snapshotFor(endpoint, sequence),
        stateRevision,
        type: "snapshot.changed",
      });
    }
  };

  const finishWithError = (error: RequestError) => {
    publish({
      ...inventoryState,
      activeOperationId: null,
      freshness: staleAfterFailure(inventoryState.freshness),
      lastError: error,
      persistenceWarning: null,
      phase: error.code === "cancelled" ? "cancelled" : "error",
    });
    return requestFailure(error);
  };

  const runRefresh = async (
    operationId: string,
    controller: AbortController,
  ): Promise<Result<RequestValue, RequestError>> => {
    const opened = await options.skillsTargets.open(target.id);
    if (!opened.ok) return finishWithError(opened.error);

    const observed = await opened.value.process.observeInventory({
      signal: controller.signal,
    });
    if (!observed.ok) return finishWithError(observed.error as RequestError);

    const committed = await options.recoveryRecords.commit({
      generation: opened.value.binding.generation,
      inventory: observed.value,
      targetId: opened.value.binding.targetId,
      type: "inventory.replace",
    });

    publish({
      activeOperationId: null,
      cliVersion: observed.value.cliVersion,
      entries: projectEntries(observed.value.entries),
      freshness: "fresh",
      lastError: null,
      observedAt: observed.value.observedAt,
      persistenceWarning: committed.ok ? null : committed.error,
      phase: "ready",
    });

    if (!committed.ok) return requestFailure(committed.error);
    return { ok: true, value: { operationId } };
  };

  return {
    attach(endpoint, sink) {
      const endpointState: EndpointState = {
        ...endpoint,
        closed: false,
        deliveryScheduled: false,
        pendingEvent: undefined,
        sequence: 0,
        sink,
      };
      endpoints.set(endpoint.endpointId, endpointState);

      return {
        async request(input) {
          if (shuttingDown) {
            return requestFailure(
              publicError(
                "target_unavailable",
                "The application is shutting down.",
                "shutdown",
                false,
              ),
            );
          }
          if (endpointState.closed || endpointState.role !== "workspace") {
            return requestFailure(
              publicError(
                "unauthorized",
                "This window cannot make that request.",
                "authorize",
                false,
              ),
            );
          }

          const parsed = workspaceRequestSchema.safeParse(input);
          if (!parsed.success) {
            return requestFailure(
              publicError(
                "invalid_request",
                "The request is not supported.",
                "validate",
                false,
              ),
            );
          }

          if (parsed.data.type === "inventory.cancel") {
            if (activeObservation?.id === parsed.data.operationId) {
              activeObservation.controller.abort();
            }
            return {
              ok: true,
              value: { operationId: parsed.data.operationId },
            };
          }

          if (parsed.data.targetId !== target.id) {
            return requestFailure(
              publicError(
                "target_not_found",
                "Target was not found.",
                "open",
                false,
              ),
            );
          }

          if (activeObservation !== undefined) return activeObservation.promise;

          const operationId = options.id();
          const controller = new AbortController();
          publish({
            ...inventoryState,
            activeOperationId: operationId,
            lastError: null,
            persistenceWarning: null,
            phase: "loading",
          });
          const promise = runRefresh(operationId, controller).finally(() => {
            if (activeObservation?.id === operationId)
              activeObservation = undefined;
          });
          activeObservation = {
            controller,
            id: operationId,
            ownerEndpointId: endpoint.endpointId,
            promise,
          };
          return promise;
        },
        async snapshot() {
          return snapshotFor(endpointState);
        },
        teardown() {
          if (endpointState.closed) return;
          endpointState.closed = true;
          endpointState.pendingEvent = undefined;
          endpoints.delete(endpointState.endpointId);
          if (activeObservation?.ownerEndpointId === endpointState.endpointId) {
            activeObservation.controller.abort();
          }
        },
      };
    },
    async initialize() {
      if (initialized) return;
      initialized = true;
      const restored = await options.recoveryRecords.restore();
      const prior = restored.inventorySnapshots.find(
        (snapshot) =>
          snapshot.targetId === target.id &&
          snapshot.generation === target.generation,
      );
      if (prior !== undefined) {
        inventoryState = {
          activeOperationId: null,
          cliVersion: prior.cliVersion,
          entries: projectEntries(prior.entries),
          freshness: "stale",
          lastError: null,
          observedAt: prior.observedAt,
          persistenceWarning: null,
          phase: "ready",
        };
      } else if (restored.failures.length > 0) {
        inventoryState = {
          ...inventoryState,
          lastError: publicError(
            "process_failed",
            "Saved Inventory evidence could not be restored.",
            "restore",
            true,
          ),
          phase: "error",
        };
      }
    },
    shutdown() {
      if (shutdownPromise !== undefined) return shutdownPromise;
      shuttingDown = true;
      const observation = activeObservation;
      observation?.controller.abort();
      shutdownPromise = (async () => {
        if (observation !== undefined) {
          let timeout: NodeJS.Timeout | undefined;
          await Promise.race([
            observation.promise.then(
              () => undefined,
              () => undefined,
            ),
            new Promise<void>((resolve) => {
              timeout = setTimeout(resolve, shutdownTimeoutMs);
            }),
          ]);
          if (timeout !== undefined) clearTimeout(timeout);
        }
        for (const endpoint of endpoints.values())
          endpoint.pendingEvent = undefined;
      })();
      return shutdownPromise;
    },
  };
}
