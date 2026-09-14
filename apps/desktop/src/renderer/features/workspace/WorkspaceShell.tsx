import { useState } from "react";
import { AlertCircle, Boxes, CheckCircle2, Clock3, HardDrive, RefreshCw, Server } from "lucide-react";

import type { DesktopBridge } from "../../../contracts/desktop.js";
import { UserFacingErrorCopy } from "../../UserFacingErrorCopy.js";
import { AboutView } from "../about/AboutView.js";
import { ComparisonView } from "../comparison/ComparisonView.js";
import { CollectionsView } from "../collections/CollectionsView.js";
import { InventoryView } from "../inventory/InventoryView.js";
import { TargetsView } from "../targets/TargetsView.js";
import { statusLabel, statusTone } from "../inventory/inventory-state.js";
import {
  WorkspaceNavigation,
  type WorkspaceView,
} from "../navigation/WorkspaceNavigation.js";
import { useReviewFocusRestore } from "./useReviewFocusRestore.js";
import { useWorkspaceSession } from "./useWorkspaceSession.js";

export function WorkspaceShell({
  client,
}: {
  readonly client: DesktopBridge;
}) {
  const session = useWorkspaceSession(client);
  const reviewFocus = useReviewFocusRestore(
    client,
    session.snapshot?.mutation.phase,
  );
  const [view, setView] = useState<WorkspaceView>("inventory");
  const [preparedMutationContext, setPreparedMutationContext] = useState<{
    readonly generation: number;
    readonly operationId: string;
    readonly targetId: string;
  }>();

  const clearTargetScopedState = (targetId: string) => {
    session.selectTarget(targetId);
    setPreparedMutationContext(undefined);
  };
  const selectTarget = (targetId: string) => {
    clearTargetScopedState(targetId);
    setView("inventory");
  };

  if (session.snapshot === undefined) {
    if (session.bootstrapError !== undefined) {
      return (
        <main className="boot-state boot-state--error" role="alert">
          <AlertCircle aria-hidden="true" size={24} />
          <UserFacingErrorCopy error={session.bootstrapError} />
          <button
            aria-label="Retry opening inventory"
            className="icon-button"
            onClick={session.retryBootstrap}
            title="Retry opening inventory"
            type="button"
          >
            <RefreshCw aria-hidden="true" size={17} />
          </button>
        </main>
      );
    }
    return (
      <main className="boot-state" aria-busy="true">
        <Boxes aria-hidden="true" size={24} />
        <span>Opening local inventory</span>
      </main>
    );
  }

  const snapshot = session.snapshot;
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark">
            <Boxes aria-hidden="true" size={17} />
          </span>
          <span>Skills Desktop</span>
        </div>
        <div className="header-target">
          {snapshot.target.kind === "ssh" ? (
            <Server aria-hidden="true" size={15} />
          ) : (
            <HardDrive aria-hidden="true" size={15} />
          )}
          <span>{snapshot.target.label}</span>
          <span aria-hidden="true">/</span>
          <code>{snapshot.target.workspaceLabel}</code>
        </div>
        <div className="header-status">
          <span className={`status-pill status-pill--${statusTone(snapshot)}`}>
            {snapshot.inventory.freshness === "fresh" ? (
              <CheckCircle2 aria-hidden="true" size={14} />
            ) : (
              <Clock3 aria-hidden="true" size={14} />
            )}
            {statusLabel(snapshot)}
          </span>
        </div>
      </header>

      <div className="workspace-layout">
        <WorkspaceNavigation
          inventory={snapshot.inventory}
          onSelectTarget={selectTarget}
          onViewChange={setView}
          target={snapshot.target}
          targetStates={session.targetStates}
          view={view}
        />

        {view === "inventory" ? (
          <InventoryView
            client={client}
            onPreparedMutation={setPreparedMutationContext}
            onSelectTarget={selectTarget}
            preparedMutationContext={preparedMutationContext}
            reviewFocus={reviewFocus}
            snapshot={snapshot}
            targetStates={session.targetStates}
          />
        ) : view === "comparison" ? (
          <ComparisonView
            client={client}
            onPrepared={(preparedId, destinationTargetId) => {
              const destination = session.targetStates.find(
                ({ target }) => target.id === destinationTargetId,
              );
              if (destination === undefined) return;
              setPreparedMutationContext({
                generation: destination.target.generation,
                operationId: preparedId,
                targetId: destinationTargetId,
              });
              session.selectTarget(destinationTargetId);
              setView("inventory");
            }}
            snapshot={snapshot}
            targets={session.targetStates}
          />
        ) : view === "collections" ? (
          <CollectionsView client={client} snapshot={snapshot} />
        ) : view === "about" ? (
          <AboutView client={client.about} />
        ) : (
          <TargetsView
            client={client}
            onSelected={clearTargetScopedState}
            targets={session.targetStates}
          />
        )}
      </div>
    </div>
  );
}
