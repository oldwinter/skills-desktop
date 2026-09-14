import { useEffect, useState } from "react";

import type { DesktopBridge } from "../../../contracts/desktop.js";
import type {
  DesktopEvent,
  RendererError,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";

export type WorkspaceTargetState = NonNullable<
  WorkspaceSnapshot["targets"]
>[number];

export function overlaySelectedTarget(
  baseSnapshot: WorkspaceSnapshot,
  selectedTargetId: string | undefined,
): {
  readonly snapshot: WorkspaceSnapshot;
  readonly targetStates: readonly WorkspaceTargetState[];
} {
  const targetStates =
    baseSnapshot.targets ??
    [
      {
        collections: baseSnapshot.collections,
        deletionBlocked: true,
        inventory: baseSnapshot.inventory,
        mutation: baseSnapshot.mutation,
        prepareEligibility: baseSnapshot.prepareEligibility,
        target: baseSnapshot.target,
      },
    ];
  const selectedTargetState =
    targetStates.find(({ target }) => target.id === selectedTargetId) ??
    targetStates[0];
  if (selectedTargetState === undefined) {
    return { snapshot: baseSnapshot, targetStates };
  }
  return {
    snapshot: {
      ...baseSnapshot,
      collections:
        selectedTargetState.collections ?? baseSnapshot.collections,
      inventory: selectedTargetState.inventory,
      mutation: selectedTargetState.mutation,
      prepareEligibility: selectedTargetState.prepareEligibility,
      target: selectedTargetState.target,
    },
    targetStates,
  };
}

export function useWorkspaceSession(client: DesktopBridge): {
  readonly bootstrapAttempt: number;
  readonly bootstrapError: RendererError | undefined;
  readonly retryBootstrap: () => void;
  readonly selectedTargetId: string | undefined;
  readonly selectTarget: (targetId: string) => void;
  readonly snapshot: WorkspaceSnapshot | undefined;
  readonly targetStates: readonly WorkspaceTargetState[];
} {
  const [baseSnapshot, setBaseSnapshot] = useState<WorkspaceSnapshot>();
  const [bootstrapError, setBootstrapError] = useState<RendererError>();
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [selectedTargetId, setSelectedTargetId] = useState<string>();

  useEffect(() => {
    let active = true;
    const resynchronize = async () => {
      const result = await client.getSnapshot();
      if (!result.ok) {
        if (active) setBootstrapError(result.error);
        return undefined;
      }
      const next = result.value;
      if (active) setBootstrapError(undefined);
      if (active)
        setBaseSnapshot((current) =>
          current && current.stateRevision > next.stateRevision
            ? current
            : next,
        );
      return next;
    };
    const receive = (event: DesktopEvent) => {
      if (!active) return;
      if (event.type === "resync.required") {
        void resynchronize();
        return;
      }
      setBaseSnapshot((current) => {
        if (
          current !== undefined &&
          current.sessionEpoch === event.sessionEpoch &&
          event.sequence === current.eventSequence + 1
        ) {
          return event.snapshot;
        }
        void resynchronize();
        return current;
      });
    };
    const unsubscribe = client.subscribe(receive);
    void resynchronize().then((initial) => {
      const initialTarget = initial?.targets?.[0]?.target ?? initial?.target;
      if (active && initialTarget !== undefined) {
        setSelectedTargetId((current) => current ?? initialTarget.id);
      }
      if (
        active &&
        initial !== undefined &&
        initialTarget?.kind === "local" &&
        (initial.targets?.[0]?.inventory.phase ?? initial.inventory.phase) !==
          "loading" &&
        (initial.targets?.[0]?.inventory.freshness ??
          initial.inventory.freshness) !== "fresh"
      ) {
        void client.refreshInventory(initialTarget.id);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bootstrapAttempt, client]);

  const overlaid =
    baseSnapshot === undefined
      ? undefined
      : overlaySelectedTarget(baseSnapshot, selectedTargetId);

  return {
    bootstrapAttempt,
    bootstrapError,
    retryBootstrap: () => setBootstrapAttempt((attempt) => attempt + 1),
    selectedTargetId,
    selectTarget: setSelectedTargetId,
    snapshot: overlaid?.snapshot,
    targetStates: overlaid?.targetStates ?? [],
  };
}
