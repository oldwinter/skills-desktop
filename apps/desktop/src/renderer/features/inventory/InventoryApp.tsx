import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  CircleHelp,
  Clock3,
  ExternalLink,
  FolderGit2,
  HardDrive,
  PackagePlus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldCheck,
  Square,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";

import type { DesktopBridge } from "../../../contracts/desktop.js";
import {
  menuCommandItem,
  type ApplicationMenu,
  type RendererMenuCommand,
} from "../../../contracts/menu.js";
import { describeHarnessEffect } from "../../../contracts/harness-effect.js";
import type { Translator } from "../../../contracts/i18n/translate.js";
import { isInventoryEntryAvailableToHarness } from "../../../contracts/inventory-availability.js";
import {
  isGithubOwnerRepository,
  type DesktopEvent,
  type PublicInventoryEntry,
  type PublicInventoryState,
  type RendererError,
  type WorkspaceSnapshot,
} from "../../../contracts/workspace.js";
import {
  LocaleProvider,
  useDocumentPreferences,
  useTranslator,
} from "../../i18n/LocaleProvider.js";
import { UserFacingErrorCopy } from "../../UserFacingErrorCopy.js";
import { AboutView } from "../about/AboutView.js";
import { PreferencesPanel } from "../preferences/PreferencesPanel.js";
import { ComparisonView } from "../comparison/ComparisonView.js";
import { CollectionsView } from "../collections/CollectionsView.js";
import { TargetsView } from "../targets/TargetsView.js";
import {
  HarnessSubsetControl,
  harnessSubsetIntent,
} from "./HarnessSubsetControl.js";
import {
  RecoveryView,
  recoveryItemCount,
  recoveryItemsFor,
} from "../recovery/RecoveryView.js";
import {
  WorkspaceNavigation,
  type WorkspaceView,
} from "../navigation/WorkspaceNavigation.js";
import {
  freshnessLabel,
  isTargetOffline,
  scopeFilterLabel,
  scopeLabel,
  sourceLabel,
  statusLabel,
  statusTone,
  targetOptionLabel,
} from "./inventory-state.js";

type ScopeFilter = "all" | "global" | "project";
type SelectedIdentity = Pick<PublicInventoryEntry, "name" | "scope">;
interface ReviewFocusIntent {
  closed: boolean;
  exhausted: boolean;
  reviewId: string | undefined;
}

// Windows may briefly reassign DOM focus after a native modal closes.
const REVIEW_FOCUS_INTERVAL_MS = 16;
const REVIEW_FOCUS_MAX_CHECKS = 60;
const REVIEW_FOCUS_STABLE_CHECKS = 12;

function inventorySubtitle(
  tc: Translator["tc"],
  count: number,
  filtered: boolean,
): string {
  return filtered
    ? tc("inventory.subtitle.matching", count)
    : tc("inventory.subtitle.total", count);
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement)
  );
}

function InventoryStatus({
  snapshot,
}: {
  readonly snapshot: WorkspaceSnapshot;
}) {
  const { t } = useTranslator();
  const { inventory } = snapshot;
  if (inventory.phase === "loading") {
    return (
      <div className="state-banner state-banner--loading" role="status">
        <RefreshCw aria-hidden="true" className="spin" size={16} />
        <span>{t("inventory.status.refreshing")}</span>
        <strong>
          {inventory.freshness === "none"
            ? t("inventory.status.noPriorEvidence")
            : t("inventory.status.retained", {
                freshness: freshnessLabel(t, inventory.freshness),
              })}
        </strong>
      </div>
    );
  }
  if (inventory.phase === "error" && inventory.lastError !== null) {
    const offline = isTargetOffline(snapshot);
    return (
      <div className="state-banner state-banner--danger" role="alert">
        {offline ? (
          <WifiOff aria-hidden="true" size={16} />
        ) : (
          <AlertCircle aria-hidden="true" size={16} />
        )}
        <UserFacingErrorCopy error={inventory.lastError} />
        {offline ? (
          <strong>{t("inventory.status.targetOffline")}</strong>
        ) : inventory.freshness === "stale" ? (
          <strong>{t("inventory.status.lastCompleteRetained")}</strong>
        ) : null}
      </div>
    );
  }
  if (inventory.phase === "cancelled") {
    return (
      <div className="state-banner state-banner--warning" role="status">
        <Square aria-hidden="true" size={15} />
        <span>{t("inventory.status.refreshCancelled")}</span>
        <strong>{freshnessLabel(t, inventory.freshness)}</strong>
      </div>
    );
  }
  if (inventory.freshness === "stale") {
    return (
      <div className="state-banner state-banner--warning" role="status">
        <Clock3 aria-hidden="true" size={16} />
        {inventory.lastError !== null ? (
          <UserFacingErrorCopy error={inventory.lastError} />
        ) : (
          <span>{t("inventory.status.staleRestored")}</span>
        )}
      </div>
    );
  }
  if (inventory.persistenceWarning !== null) {
    return (
      <div className="state-banner state-banner--warning" role="status">
        <AlertCircle aria-hidden="true" size={16} />
        <UserFacingErrorCopy error={inventory.persistenceWarning} />
      </div>
    );
  }
  return null;
}

function EmptyInventory({
  filtered,
  onClearFilters,
}: {
  readonly filtered: boolean;
  readonly onClearFilters: () => void;
}) {
  const { t } = useTranslator();
  return (
    <div className="empty-state" role="status">
      <CircleHelp aria-hidden="true" size={22} />
      <h2>
        {t(filtered ? "inventory.empty.noMatching" : "inventory.empty.noSkills")}
      </h2>
      <p>
        {t(
          filtered
            ? "inventory.empty.changeFilter"
            : "inventory.empty.installHint",
        )}
      </p>
      {filtered ? (
        <button
          className="text-button"
          onClick={onClearFilters}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={15} />
          {t("inventory.empty.clearFilters")}
        </button>
      ) : null}
    </div>
  );
}

function MissingInventoryEvidence({
  phase,
}: {
  readonly phase: PublicInventoryState["phase"];
}) {
  const { t } = useTranslator();
  const copy =
    phase === "loading"
      ? {
          heading: t("inventory.missing.waiting"),
          message: t("inventory.missing.waitingBody"),
        }
      : phase === "error"
        ? {
            heading: t("inventory.missing.unavailable"),
            message: t("inventory.missing.unavailableBody"),
          }
        : {
            heading: t("inventory.missing.none"),
            message: t("inventory.missing.noneBody"),
          };
  return (
    <div className="empty-state" role="status">
      <CircleHelp aria-hidden="true" size={22} />
      <h2>{copy.heading}</h2>
      <p>{copy.message}</p>
    </div>
  );
}

/**
 * Hosts the workspace under the main-owned locale so every view, including
 * the boot and error states, renders in the resolved language.
 */
export function InventoryApp({ client }: { readonly client: DesktopBridge }) {
  const [preferences, setPreferences] =
    useState<WorkspaceSnapshot["preferences"]>();
  useDocumentPreferences(preferences);
  return (
    <LocaleProvider locale={preferences?.locale}>
      <InventoryWorkspace client={client} onPreferences={setPreferences} />
    </LocaleProvider>
  );
}

function InventoryWorkspace({
  client,
  onPreferences,
}: {
  readonly client: DesktopBridge;
  readonly onPreferences: (
    preferences: WorkspaceSnapshot["preferences"],
  ) => void;
}) {
  const { locale, t, tc } = useTranslator();
  const [baseSnapshot, setBaseSnapshot] = useState<WorkspaceSnapshot>();
  const [bootstrapError, setBootstrapError] = useState<RendererError>();
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [selectedIdentity, setSelectedIdentity] = useState<SelectedIdentity>();
  const [preparedMutationContext, setPreparedMutationContext] = useState<{
    readonly generation: number;
    readonly operationId: string;
    readonly targetId: string;
  }>();
  const [actionError, setActionError] = useState<RendererError>();
  const [addName, setAddName] = useState("");
  const [addSource, setAddSource] = useState("");
  const [addSourceError, setAddSourceError] = useState<string>();
  const [addScope, setAddScope] = useState<"global" | "project">("project");
  const [excludedHarnessIds, setExcludedHarnessIds] = useState<
    readonly string[]
  >([]);
  const [skillsShHandoff, setSkillsShHandoff] = useState<{
    readonly recordId: string;
    readonly status: "opened" | "opening";
  }>();
  const [view, setView] = useState<WorkspaceView>("inventory");
  const [selectedTargetId, setSelectedTargetId] = useState<string>();
  const [applicationMenu, setApplicationMenu] = useState<ApplicationMenu>();
  const menuFocusPendingRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mutationOutcomeRef = useRef<HTMLParagraphElement>(null);
  const reviewReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const targetStates =
    baseSnapshot?.targets ??
    (baseSnapshot === undefined
      ? []
      : [
          {
            deletionBlocked: true,
            inventory: baseSnapshot.inventory,
            mutation: baseSnapshot.mutation,
            target: baseSnapshot.target,
          },
        ]);
  const selectedTargetState =
    targetStates.find(({ target }) => target.id === selectedTargetId) ??
    targetStates[0];
  const snapshot =
    baseSnapshot === undefined || selectedTargetState === undefined
      ? baseSnapshot
      : {
          ...baseSnapshot,
          collections:
            selectedTargetState.collections ?? baseSnapshot.collections,
          inventory: selectedTargetState.inventory,
          mutation: selectedTargetState.mutation,
          target: selectedTargetState.target,
        };
  const mutationPhaseRef = useRef(snapshot?.mutation.phase);
  mutationPhaseRef.current = snapshot?.mutation.phase;
  const cancelReviewFocusRestoreRef = useRef<() => void>(() => undefined);
  const scheduleReviewFocusRestoreRef = useRef<() => void>(() => undefined);
  const reviewFocusIntentRef = useRef<ReviewFocusIntent | null>(null);
  const lastClosedReviewIdRef = useRef<string | undefined>(undefined);
  const inventory = snapshot?.inventory;
  const preparedMutationId = preparedMutationContext?.operationId;
  const snapshotPreferences = baseSnapshot?.preferences;

  useEffect(() => {
    onPreferences(snapshotPreferences);
  }, [onPreferences, snapshotPreferences]);

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

  useEffect(() => {
    let pendingRestore: number | undefined;
    let restoreGeneration = 0;
    const cancelScheduledRestore = () => {
      restoreGeneration += 1;
      if (pendingRestore !== undefined) {
        window.clearTimeout(pendingRestore);
        pendingRestore = undefined;
      }
    };
    const cancelReviewFocusRestore = () => {
      cancelScheduledRestore();
      reviewReturnFocusRef.current = null;
      reviewFocusIntentRef.current = null;
      lastClosedReviewIdRef.current = undefined;
    };
    const scheduleReviewFocusRestore = () => {
      const intent = reviewFocusIntentRef.current;
      if (intent === null || !intent.closed) return;
      cancelScheduledRestore();
      intent.exhausted = false;
      const generation = restoreGeneration;
      let expectedTarget: HTMLElement | null = null;
      let focusChecks = 0;
      let stableChecks = 0;
      const scheduleNextCheck = () => {
        if (focusChecks >= REVIEW_FOCUS_MAX_CHECKS) {
          intent.exhausted = true;
          return;
        }
        pendingRestore = window.setTimeout(
          restoreFocus,
          REVIEW_FOCUS_INTERVAL_MS,
        );
      };
      const restoreFocus = () => {
        pendingRestore = undefined;
        if (generation !== restoreGeneration) return;
        if (reviewFocusIntentRef.current !== intent || !intent.closed) return;
        const opener = reviewReturnFocusRef.current;
        if (opener === null) return;

        focusChecks += 1;
        const workspaceFocused =
          document.hasFocus() && mutationPhaseRef.current !== "reviewing";
        if (!workspaceFocused) {
          scheduleNextCheck();
          return;
        }
        const target =
          opener.isConnected && !opener.disabled
            ? opener
            : (mutationOutcomeRef.current ??
              document.querySelector<HTMLButtonElement>(
                'button[data-nav-view="inventory"]',
              ));
        if (target === null) {
          if (focusChecks >= REVIEW_FOCUS_MAX_CHECKS) intent.exhausted = true;
          else scheduleNextCheck();
          return;
        }

        if (target !== expectedTarget) {
          expectedTarget = target;
          stableChecks = 0;
        }
        if (document.activeElement === target) {
          stableChecks += 1;
        } else {
          target.focus({ preventScroll: true });
          stableChecks = 0;
        }
        if (stableChecks >= REVIEW_FOCUS_STABLE_CHECKS) {
          reviewReturnFocusRef.current = null;
          reviewFocusIntentRef.current = null;
          lastClosedReviewIdRef.current = undefined;
          return;
        }
        if (focusChecks >= REVIEW_FOCUS_MAX_CHECKS) {
          intent.exhausted = true;
          return;
        }
        scheduleNextCheck();
      };
      scheduleNextCheck();
    };
    const handleWindowFocus = () => {
      scheduleReviewFocusRestore();
    };
    const handleWorkspaceInput = () => {
      if (reviewReturnFocusRef.current !== null) cancelReviewFocusRestore();
    };
    cancelReviewFocusRestoreRef.current = cancelReviewFocusRestore;
    scheduleReviewFocusRestoreRef.current = scheduleReviewFocusRestore;
    window.addEventListener("click", handleWorkspaceInput, true);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("keydown", handleWorkspaceInput, true);
    window.addEventListener("pointerdown", handleWorkspaceInput, true);
    return () => {
      window.removeEventListener("click", handleWorkspaceInput, true);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("keydown", handleWorkspaceInput, true);
      window.removeEventListener("pointerdown", handleWorkspaceInput, true);
      cancelReviewFocusRestore();
      cancelReviewFocusRestoreRef.current = () => undefined;
      scheduleReviewFocusRestoreRef.current = () => undefined;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = client.subscribeReviewWindowClosed(({ reviewId }) => {
      const intent = reviewFocusIntentRef.current;
      if (intent === null) return;
      if (intent.reviewId === undefined) {
        lastClosedReviewIdRef.current = reviewId;
        return;
      }
      if (intent.reviewId !== reviewId) return;
      intent.closed = true;
      scheduleReviewFocusRestoreRef.current();
    });
    return unsubscribe;
  }, [client]);

  useEffect(() => {
    let active = true;
    void client.menu.getMenu().then((result) => {
      if (active && result.ok) setApplicationMenu(result.value);
    });
    return () => {
      active = false;
    };
  }, [client]);

  // ADR 0023: menu activations arrive as closed commands. The renderer
  // resolves workspace state (active Target, current route) and issues the
  // same request its own control would; main never fabricates one.
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  useEffect(() => {
    const navigate = (next: WorkspaceView) => {
      menuFocusPendingRef.current = true;
      setView(next);
    };
    const handlers: Record<RendererMenuCommand, () => void> = {
      "inventory.refresh": () => {
        const current = snapshotRef.current;
        if (current === undefined || current.inventory.phase === "loading") {
          return;
        }
        void client.refreshInventory(current.target.id);
      },
      "navigate.about": () => navigate("about"),
      "navigate.collections": () => navigate("collections"),
      "navigate.comparison": () => navigate("comparison"),
      "navigate.inventory": () => navigate("inventory"),
      "navigate.recovery": () => navigate("recovery"),
      "navigate.targets": () => navigate("targets"),
      "update.check": () => {
        navigate("about");
        void client.about.requestCheck();
      },
    };
    return client.menu.subscribeMenuCommand(({ command }) => {
      handlers[command]();
    });
  }, [client]);

  useEffect(() => {
    if (!menuFocusPendingRef.current) return;
    menuFocusPendingRef.current = false;
    document
      .querySelector<HTMLElement>("#workspace-main")
      ?.focus({ preventScroll: true });
  }, [view]);

  useEffect(() => {
    if (view !== "inventory") return;
    const focusInventorySearch = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.key !== "/" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isTextEditingTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener("keydown", focusInventorySearch);
    return () => window.removeEventListener("keydown", focusInventorySearch);
  }, [view]);

  useEffect(() => {
    const intent = reviewFocusIntentRef.current;
    if (
      intent?.closed &&
      intent.exhausted &&
      snapshot?.mutation.phase !== "reviewing"
    ) {
      scheduleReviewFocusRestoreRef.current();
    }
  }, [snapshot?.mutation.phase]);

  const filteredEntries = useMemo(() => {
    if (inventory === undefined) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return inventory.entries.filter((entry) => {
      const matchesScope = scope === "all" || entry.scope === scope;
      const searchable = [
        entry.name,
        entry.declaredSource.source,
        entry.declaredSource.sourceType,
        ...entry.agents,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return (
        matchesScope &&
        (normalizedQuery === "" || searchable.includes(normalizedQuery))
      );
    });
  }, [inventory, query, scope]);

  const clearInventoryFilters = () => {
    setQuery("");
    setScope("all");
    searchInputRef.current?.focus();
  };

  const selected = useMemo(() => {
    if (selectedIdentity !== undefined) {
      return filteredEntries.find(
        (entry) =>
          entry.name === selectedIdentity.name &&
          entry.scope === selectedIdentity.scope,
      );
    }
    return filteredEntries[0];
  }, [filteredEntries, selectedIdentity]);

  if (snapshot === undefined) {
    if (bootstrapError !== undefined) {
      return (
        <main className="boot-state boot-state--error" id="workspace-main" role="alert" tabIndex={-1}>
          <AlertCircle aria-hidden="true" size={24} />
          <UserFacingErrorCopy error={bootstrapError} />
          <button
            aria-label={t("inventory.boot.retry")}
            className="icon-button"
            onClick={() => setBootstrapAttempt((attempt) => attempt + 1)}
            title={t("inventory.boot.retry")}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={17} />
          </button>
        </main>
      );
    }
    return (
      <main className="boot-state" aria-busy="true" id="workspace-main" tabIndex={-1}>
        <Boxes aria-hidden="true" size={24} />
        <span>{t("inventory.boot.opening")}</span>
      </main>
    );
  }

  const isFiltered = query.trim() !== "" || scope !== "all";
  const activeOperationId = snapshot.inventory.activeOperationId;
  const sshUnavailable = snapshot.target.kind === "ssh";
  const mutationBlocked =
    sshUnavailable ||
    snapshot.inventory.freshness !== "fresh" ||
    snapshot.mutation.phase === "reconciliation-required" ||
    snapshot.mutation.phase === "running";
  const mutationBlockedReason = sshUnavailable
    ? t("inventory.blocked.ssh")
    : snapshot.inventory.freshness !== "fresh"
      ? t("inventory.blocked.refresh")
      : snapshot.mutation.phase === "reconciliation-required"
        ? t("inventory.blocked.reconcile")
        : snapshot.mutation.phase === "running"
          ? t("inventory.blocked.running")
          : undefined;
  const mutationBlockedDescribedBy = sshUnavailable
    ? "inventory-ssh-unavailable-reason"
    : mutationBlocked
      ? [
          "inventory-mutation-blocked-reason",
          snapshot.inventory.freshness !== "fresh"
            ? "inventory-refresh-cta"
            : snapshot.mutation.phase === "reconciliation-required"
              ? "inventory-reconcile-cta"
              : undefined,
        ]
          .filter((id): id is string => id !== undefined)
          .join(" ")
      : undefined;
  const showRefreshMutationCta =
    !sshUnavailable && snapshot.inventory.freshness !== "fresh";
  const showReconcileMutationCta =
    !sshUnavailable &&
    snapshot.inventory.freshness === "fresh" &&
    snapshot.mutation.phase === "reconciliation-required";
  const selectedHandoff =
    selected === undefined
      ? undefined
      : snapshot.skillsShHandoffs?.find(
          ({ sourceEntry }) =>
            sourceEntry.name === selected.name &&
            sourceEntry.scope === selected.scope,
        );
  const openOnSkillsSh = async () => {
    if (selectedHandoff === undefined) return;
    setSkillsShHandoff({ recordId: selectedHandoff.id, status: "opening" });
    const result = await client.handoffSkillsSh(selectedHandoff.id);
    if (result.ok) {
      setActionError(undefined);
      setSkillsShHandoff({ recordId: selectedHandoff.id, status: "opened" });
    } else {
      setSkillsShHandoff(undefined);
      setActionError(result.error);
    }
  };
  const prepareSelected = async (type: "remove" | "update") => {
    if (sshUnavailable || selected === undefined) return;
    const result = await client.prepareMutation(snapshot.target.id, {
      ...(type === "remove"
        ? harnessSubsetIntent(snapshot.target.harnessIds, excludedHarnessIds)
        : {}),
      names: [selected.name],
      scope: selected.scope,
      type,
    });
    if (result.ok) {
      setActionError(undefined);
      cancelReviewFocusRestoreRef.current();
      setPreparedMutationContext({
        generation: snapshot.target.generation,
        operationId: result.value.operationId,
        targetId: snapshot.target.id,
      });
    } else setActionError(result.error);
  };
  const prepareUpdateAll = async () => {
    if (sshUnavailable || scope === "all") return;
    const result = await client.prepareMutation(snapshot.target.id, {
      scope,
      type: "update-all",
    });
    if (result.ok) {
      setActionError(undefined);
      cancelReviewFocusRestoreRef.current();
      setPreparedMutationContext({
        generation: snapshot.target.generation,
        operationId: result.value.operationId,
        targetId: snapshot.target.id,
      });
    } else setActionError(result.error);
  };
  const prepareAdd = async () => {
    if (sshUnavailable) return;
    const source = addSource.trim();
    if (!isGithubOwnerRepository(source)) {
      setAddSourceError(t("error.githubSource"));
      setActionError(undefined);
      return;
    }
    setAddSourceError(undefined);
    const result = await client.prepareMutation(snapshot.target.id, {
      ...harnessSubsetIntent(snapshot.target.harnessIds, excludedHarnessIds),
      names: [addName],
      scope: addScope,
      source: { source, sourceType: "github" },
      type: "add",
    });
    if (result.ok) {
      setActionError(undefined);
      cancelReviewFocusRestoreRef.current();
      setPreparedMutationContext({
        generation: snapshot.target.generation,
        operationId: result.value.operationId,
        targetId: snapshot.target.id,
      });
    } else setActionError(result.error);
  };
  const requestReview = async (returnFocus: HTMLButtonElement) => {
    if (
      preparedMutationContext === undefined ||
      preparedMutationContext.targetId !== snapshot.target.id ||
      preparedMutationContext.generation !== snapshot.target.generation
    ) {
      return;
    }
    cancelReviewFocusRestoreRef.current();
    reviewReturnFocusRef.current = returnFocus;
    const intent: ReviewFocusIntent = {
      closed: false,
      exhausted: false,
      reviewId: undefined,
    };
    reviewFocusIntentRef.current = intent;
    const result = await client.requestReview(preparedMutationContext.operationId);
    if (reviewFocusIntentRef.current !== intent) return;
    if (result.ok) setActionError(undefined);
    else {
      cancelReviewFocusRestoreRef.current();
      setActionError(result.error);
      return;
    }
    intent.reviewId = result.value.operationId;
    const lastClosedReviewId = lastClosedReviewIdRef.current;
    lastClosedReviewIdRef.current = undefined;
    if (lastClosedReviewId === intent.reviewId) {
      intent.closed = true;
      scheduleReviewFocusRestoreRef.current();
    }
  };
  const reconcileMutation = async () => {
    const result = await client.reconcileMutation(snapshot.target.id);
    if (result.ok) setActionError(undefined);
    else setActionError(result.error);
  };
  const requestCancellationReview = async (operationId: string) => {
    const result = await client.requestCancellationReview(operationId);
    if (result.ok) setActionError(undefined);
    else setActionError(result.error);
  };
  const clearTargetScopedState = (targetId: string) => {
    setSelectedTargetId(targetId);
    setSelectedIdentity(undefined);
    setPreparedMutationContext(undefined);
    setActionError(undefined);
  };
  const selectTarget = (targetId: string) => {
    clearTargetScopedState(targetId);
    setView("inventory");
  };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-main">
        {t("app.skipToWorkspace")}
      </a>
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark">
            <Boxes aria-hidden="true" size={17} />
          </span>
          <span>{t("app.name")}</span>
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
            {statusLabel(t, snapshot)}
          </span>
        </div>
      </header>

      <div className="workspace-layout">
        <WorkspaceNavigation
          applicationMenu={applicationMenu}
          inventory={snapshot.inventory}
          onSelectTarget={selectTarget}
          onViewChange={setView}
          recoveryCount={recoveryItemCount(
            recoveryItemsFor(snapshot, targetStates),
          )}
          target={snapshot.target}
          targetStates={targetStates}
          view={view}
        />

        {view === "inventory" ? (
          <>
            <main
              className="inventory-workspace"
              id="workspace-main"
              tabIndex={-1}
              aria-busy={snapshot.inventory.phase === "loading"}
            >
              <section className="page-heading">
                <div>
                  <h1>{t("inventory.title")}</h1>
                  <p>
                    {inventorySubtitle(tc, filteredEntries.length, isFiltered)}
                  </p>
                  {targetStates.length > 1 ? (
                    <label className="inventory-target-chooser">
                      {t("common.target")}
                      <select
                      onChange={(event) => {
                          selectTarget(event.currentTarget.value);
                        }}
                        value={snapshot.target.id}
                      >
                        {targetStates.map((state) => (
                          <option key={state.target.id} value={state.target.id}>
                            {targetOptionLabel(t, state.target)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <p
                      aria-label={t("inventory.targetSummary")}
                      className="mobile-target-summary"
                    >
                      {snapshot.target.kind === "ssh" ? (
                        <Server aria-hidden="true" size={14} />
                      ) : (
                        <HardDrive aria-hidden="true" size={14} />
                      )}
                      {snapshot.target.label} / {snapshot.target.workspaceLabel}{" "}
                      / {snapshot.target.harnessIds.join(", ")}
                    </p>
                  )}
                </div>
                {snapshot.inventory.phase === "loading" &&
                activeOperationId !== null ? (
                  <button
                    aria-label={t("inventory.cancelRefresh")}
                    className="icon-button"
                    onClick={() =>
                      void client.cancelInventory(activeOperationId)
                    }
                    title={t("inventory.cancelRefresh")}
                    type="button"
                  >
                    <Square aria-hidden="true" size={16} />
                  </button>
                ) : (
                  <button
                    aria-keyshortcuts={
                      menuCommandItem(applicationMenu, "inventory.refresh")
                        ?.ariaKeyShortcuts
                    }
                    aria-label={t("inventory.refreshInventory")}
                    className="icon-button"
                    onClick={() =>
                      void client.refreshInventory(snapshot.target.id)
                    }
                    title={t("inventory.refreshInventory")}
                    type="button"
                  >
                    <RefreshCw aria-hidden="true" size={17} />
                  </button>
                )}
              </section>

              <InventoryStatus snapshot={snapshot} />
              {sshUnavailable ? (
                <div
                  className="state-banner state-banner--warning"
                  id="inventory-ssh-unavailable-reason"
                  role="status"
                >
                  <Server aria-hidden="true" size={16} />
                  <span>{t("inventory.ssh.banner")}</span>
                  <strong>{t("common.ssh.badge")}</strong>
                </div>
              ) : null}
              {mutationBlockedReason && !sshUnavailable ? (
                <div
                  className="state-banner state-banner--warning"
                  id="inventory-mutation-blocked-reason"
                  role="status"
                >
                  <CircleHelp aria-hidden="true" size={16} />
                  <span>{mutationBlockedReason}</span>
                  {showRefreshMutationCta ? (
                    <button
                      className="text-button text-button--primary"
                      id="inventory-refresh-cta"
                      onClick={() =>
                        void client.refreshInventory(snapshot.target.id)
                      }
                      type="button"
                    >
                      <RefreshCw aria-hidden="true" size={15} />
                      {t("common.refresh")}
                    </button>
                  ) : null}
                  {showReconcileMutationCta ? (
                    <button
                      className="text-button text-button--primary"
                      id="inventory-reconcile-cta"
                      onClick={() => void reconcileMutation()}
                      type="button"
                    >
                      <RefreshCw aria-hidden="true" size={15} />
                      {t("common.reconcile")}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {snapshot.inventory.lastError?.code === "host_trust_required" ||
              snapshot.inventory.lastError?.code === "host_key_changed" ? (
                <div
                  className="state-banner state-banner--warning"
                  role="status"
                >
                  <ShieldCheck aria-hidden="true" size={16} />
                  <span>{t("inventory.hostTrust.banner")}</span>
                </div>
              ) : null}
              {snapshot.mutation.phase === "reconciliation-required" ? (
                <div className="state-banner state-banner--danger" role="alert">
                  <AlertCircle aria-hidden="true" size={16} />
                  {snapshot.mutation.lastError !== null ? (
                    <UserFacingErrorCopy error={snapshot.mutation.lastError} />
                  ) : (
                    <span>{t("inventory.reconciliationRequired")}</span>
                  )}
                  {showReconcileMutationCta ? null : (
                    <button
                      className="text-button text-button--primary"
                      onClick={() => void reconcileMutation()}
                      type="button"
                    >
                      <RefreshCw aria-hidden="true" size={15} />
                      {t("common.reconcile")}
                    </button>
                  )}
                </div>
              ) : snapshot.mutation.phase === "running" ? (
                <div
                  className="state-banner state-banner--loading"
                  role="status"
                >
                  <RefreshCw aria-hidden="true" className="spin" size={16} />
                  <span>{t("inventory.applyingMutation")}</span>
                  {snapshot.mutation.activeOperationId !== null ? (
                    <button
                      className="text-button"
                      onClick={() =>
                        void requestCancellationReview(
                          snapshot.mutation.activeOperationId!,
                        )
                      }
                      type="button"
                    >
                      <ShieldCheck aria-hidden="true" size={15} />
                      {t("inventory.reviewCancellation")}
                    </button>
                  ) : null}
                </div>
              ) : snapshot.mutation.lastError !== null ? (
                <div className="state-banner state-banner--danger" role="alert">
                  <AlertCircle aria-hidden="true" size={16} />
                  <UserFacingErrorCopy error={snapshot.mutation.lastError} />
                </div>
              ) : null}
              {actionError !== undefined ? (
                <div className="state-banner state-banner--danger" role="alert">
                  <AlertCircle aria-hidden="true" size={16} />
                  <UserFacingErrorCopy error={actionError} />
                </div>
              ) : null}

              <div className="inventory-toolbar">
                <div className="search-control">
                  <Search aria-hidden="true" size={16} />
                  <span className="sr-only">{t("inventory.search")}</span>
                  <input
                    aria-label={t("inventory.search")}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && query !== "") {
                        event.preventDefault();
                        setQuery("");
                      }
                    }}
                    placeholder={t("inventory.searchPlaceholder")}
                    ref={searchInputRef}
                    type="search"
                    value={query}
                  />
                  {query !== "" ? (
                    <button
                      aria-label={t("inventory.clearSearch")}
                      className="search-clear"
                      onClick={() => setQuery("")}
                      title={t("inventory.clearSearch")}
                      type="button"
                    >
                      <X aria-hidden="true" size={15} />
                    </button>
                  ) : null}
                </div>
                <span aria-live="polite" className="inventory-result-count">
                  {t("inventory.shown", { count: filteredEntries.length })}
                </span>
                <div
                  className="segmented-control"
                  aria-label={t("inventory.scopeFilter")}
                  role="group"
                >
                  {(["all", "project", "global"] as const).map((value) => (
                    <button
                      aria-pressed={scope === value}
                      key={value}
                      onClick={() => setScope(value)}
                      type="button"
                    >
                      {value === "all"
                        ? t("inventory.scopeFilter.all")
                        : scopeFilterLabel(t, value)}
                    </button>
                  ))}
                </div>
                <button
                  aria-describedby={
                    scope === "all" ? undefined : mutationBlockedDescribedBy
                  }
                  className="text-button"
                  disabled={scope === "all" || mutationBlocked}
                  onClick={() => void prepareUpdateAll()}
                  title={
                    scope === "all"
                      ? t("inventory.updateScope.chooseFirst")
                      : mutationBlockedReason
                  }
                  type="button"
                >
                  <RefreshCw aria-hidden="true" size={15} />
                  {t("inventory.updateScope")}
                </button>
              </div>

              <div className="inventory-table-wrap">
                {filteredEntries.length === 0 ? (
                  snapshot.inventory.freshness === "none" ? (
                    <MissingInventoryEvidence
                      phase={snapshot.inventory.phase}
                    />
                  ) : (
                    <EmptyInventory
                      filtered={isFiltered}
                      onClearFilters={clearInventoryFilters}
                    />
                  )
                ) : (
                  <table className="inventory-table">
                    <caption className="sr-only">
                      {t("inventory.table.caption")}
                    </caption>
                    <thead>
                      <tr>
                        <th>{t("common.skill")}</th>
                        <th>{t("common.scope")}</th>
                        <th>{t("common.harness")}</th>
                        <th>{t("inventory.table.declaredSource")}</th>
                        <th>{t("inventory.table.evidence")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEntries.map((entry) => {
                        const selectedRow =
                          selected?.name === entry.name &&
                          selected.scope === entry.scope;
                        return (
                          <tr
                            className={selectedRow ? "is-selected" : undefined}
                            key={`${entry.scope}:${entry.name}`}
                          >
                            <td data-label={t("common.skill")}>
                              <button
                                className="skill-button"
                                onClick={() =>
                                  setSelectedIdentity({
                                    name: entry.name,
                                    scope: entry.scope,
                                  })
                                }
                                type="button"
                              >
                                <FolderGit2 aria-hidden="true" size={16} />
                                <span>{entry.name}</span>
                              </button>
                            </td>
                            <td data-label={t("common.scope")}>
                              <span className="scope-badge">
                                {scopeLabel(t, entry.scope)}
                              </span>
                            </td>
                            <td data-label={t("common.harness")}>
                              {snapshot.target.harnessIds.every((harnessId) =>
                                isInventoryEntryAvailableToHarness(
                                  entry,
                                  harnessId,
                                ),
                              )
                                ? snapshot.target.harnessIds.join(", ")
                                : t("inventory.table.notLinked")}
                            </td>
                            <td data-label={t("inventory.table.declaredSource")}>
                              <code className="wrapping-value">
                                {sourceLabel(t, entry)}
                              </code>
                            </td>
                            <td data-label={t("inventory.table.evidence")}>
                              {entry.revision.status === "known" ? (
                                <code className="wrapping-value">
                                  {entry.revision.value}
                                </code>
                              ) : (
                                <span className="unknown-label">
                                  <CircleHelp aria-hidden="true" size={14} />
                                  {t("inventory.table.unknownRevision")}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </main>

            <aside
              className="inspector"
              aria-label={t("inventory.inspector.label")}
            >
              {selected === undefined ? (
                <div className="inspector-empty">
                  <CircleHelp aria-hidden="true" size={22} />
                  {(inventory?.entries.length ?? 0) === 0 ? (
                    <>
                      <h2>{t("inventory.inspector.noSkills")}</h2>
                      <p>{t("inventory.inspector.noSkillsBody")}</p>
                    </>
                  ) : filteredEntries.length === 0 ? (
                    <>
                      <h2>{t("inventory.inspector.noneSelected")}</h2>
                      <p>{t("inventory.inspector.noneInFilter")}</p>
                    </>
                  ) : (
                    <>
                      <h2>{t("inventory.inspector.noneSelected")}</h2>
                      <p>{t("inventory.inspector.selectHint")}</p>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <header className="inspector-heading">
                    <FolderGit2 aria-hidden="true" size={18} />
                    <div>
                      <p>{t("inventory.inspector.heading")}</p>
                      <h2>{selected.name}</h2>
                    </div>
                  </header>
                  <dl
                    aria-label={t("inventory.inspector.detailsLabel")}
                    className="evidence-list"
                    tabIndex={0}
                  >
                    <div>
                      <dt>{t("common.scope")}</dt>
                      <dd>{scopeLabel(t, selected.scope)}</dd>
                    </div>
                    <div>
                      <dt>{t("common.harness")}</dt>
                      <dd>
                        {selected.agents.join(", ") ||
                          t("inventory.inspector.noneReported")}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("inventory.inspector.sourceType")}</dt>
                      <dd>
                        {selected.declaredSource.sourceType ??
                          t("common.unknown")}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("inventory.table.declaredSource")}</dt>
                      <dd>
                        <code className="wrapping-value">
                          {sourceLabel(t, selected)}
                        </code>
                      </dd>
                    </div>
                    <div>
                      <dt>{t("inventory.inspector.revision")}</dt>
                      <dd>
                        {selected.revision.status === "known" ? (
                          <code className="wrapping-value">
                            {selected.revision.kind} / {selected.revision.value}
                          </code>
                        ) : (
                          <span className="unknown-label">
                            <CircleHelp aria-hidden="true" size={14} />
                            {t("inventory.inspector.revisionUnknown")}
                          </span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("inventory.inspector.contentFingerprint")}</dt>
                      <dd>
                        {selected.contentFingerprint.status === "known" ? (
                          <code className="wrapping-value">
                            {selected.contentFingerprint.kind} /{" "}
                            {selected.contentFingerprint.value}
                          </code>
                        ) : (
                          <span className="unknown-label">
                            <CircleHelp aria-hidden="true" size={14} />
                            {t("common.unknown")}
                          </span>
                        )}
                      </dd>
                    </div>
                  </dl>
                  <div className="inspector-actions">
                    <button
                      aria-describedby={mutationBlockedDescribedBy}
                      className="text-button"
                      disabled={mutationBlocked}
                      onClick={() => void prepareSelected("update")}
                      title={mutationBlockedReason}
                      type="button"
                    >
                      <RefreshCw aria-hidden="true" size={15} />
                      {t("inventory.prepareUpdate")}
                    </button>
                    <button
                      aria-describedby={mutationBlockedDescribedBy}
                      className="text-button text-button--danger"
                      disabled={mutationBlocked}
                      onClick={() => void prepareSelected("remove")}
                      title={mutationBlockedReason}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={15} />
                      {t("inventory.prepareRemoval")}
                    </button>
                  </div>
                  {selectedHandoff !== undefined ? (
                    <div className="skills-sh-handoff">
                      <button
                        className="text-button"
                        disabled={
                          skillsShHandoff?.recordId === selectedHandoff.id &&
                          skillsShHandoff.status === "opening"
                        }
                        onClick={() => void openOnSkillsSh()}
                        type="button"
                      >
                        <ExternalLink aria-hidden="true" size={15} />
                        {t("inventory.skillsSh.open")}
                      </button>
                      <p className="skills-sh-handoff__hint">
                        {t("inventory.skillsSh.hint", {
                          path: `${selectedHandoff.owner}/${selectedHandoff.repository}${
                            selectedHandoff.skill !== null
                              ? `/${selectedHandoff.skill}`
                              : ""
                          }`,
                        })}
                      </p>
                      {skillsShHandoff?.recordId === selectedHandoff.id &&
                      skillsShHandoff.status === "opened" ? (
                        <p className="skills-sh-handoff__status" role="status">
                          {t("inventory.skillsSh.opened")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}

              <HarnessSubsetControl
                disabled={mutationBlocked}
                excludedHarnessIds={excludedHarnessIds}
                onChange={setExcludedHarnessIds}
                targetHarnessIds={snapshot.target.harnessIds}
              />

              <form
                className="add-skill-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void prepareAdd();
                }}
              >
                <h2>{t("inventory.add.heading")}</h2>
                <label>
                  <span>{t("inventory.add.githubSource")}</span>
                  <input
                    aria-errormessage={
                      addSourceError !== undefined
                        ? "add-skill-github-source-error"
                        : undefined
                    }
                    aria-invalid={addSourceError !== undefined}
                    onChange={(event) => {
                      setAddSource(event.currentTarget.value);
                      setAddSourceError(undefined);
                    }}
                    placeholder={t("inventory.add.githubPlaceholder")}
                    required
                    value={addSource}
                  />
                </label>
                {addSourceError !== undefined ? (
                  <p
                    className="field-error"
                    id="add-skill-github-source-error"
                    role="alert"
                  >
                    {addSourceError}
                  </p>
                ) : null}
                <label>
                  <span>{t("inventory.add.exactName")}</span>
                  <input
                    onChange={(event) => setAddName(event.currentTarget.value)}
                    required
                    value={addName}
                  />
                </label>
                <div
                  className="segmented-control segmented-control--compact"
                  aria-label={t("inventory.add.scopeLabel")}
                  role="group"
                >
                  {(["project", "global"] as const).map((value) => (
                    <button
                      aria-pressed={addScope === value}
                      key={value}
                      onClick={() => setAddScope(value)}
                      type="button"
                    >
                      {scopeFilterLabel(t, value)}
                    </button>
                  ))}
                </div>
                <button
                  aria-describedby={mutationBlockedDescribedBy}
                  className="text-button"
                  disabled={mutationBlocked}
                  title={mutationBlockedReason}
                  type="submit"
                >
                  <PackagePlus aria-hidden="true" size={15} />
                  {t("inventory.add.prepare")}
                </button>
              </form>

              {snapshot.mutation.commandPlan !== null ? (
                <section
                  className="command-plan"
                  aria-labelledby="command-plan-heading"
                >
                  <header>
                    <ShieldCheck aria-hidden="true" size={17} />
                    <h2 id="command-plan-heading">{t("inventory.plan.heading")}</h2>
                  </header>
                  <dl>
                    <div>
                      <dt>{t("inventory.plan.operation")}</dt>
                      <dd>{snapshot.mutation.commandPlan.operation}</dd>
                    </div>
                    <div>
                      <dt>{t("common.scope")}</dt>
                      <dd>{scopeLabel(t, snapshot.mutation.commandPlan.scope)}</dd>
                    </div>
                    <div>
                      <dt>{t("common.skills")}</dt>
                      <dd>{snapshot.mutation.commandPlan.names.join(", ")}</dd>
                    </div>
                    <div>
                      <dt>{t("inventory.plan.harnessEffect")}</dt>
                      <dd>
                        {
                          describeHarnessEffect(
                            snapshot.mutation.commandPlan,
                            locale,
                          ).summary
                        }
                      </dd>
                    </div>
                  </dl>
                  <code className="command-preview wrapping-value">
                    {snapshot.mutation.commandPlan.preview}
                  </code>
                  {snapshot.mutation.outcome === null ? (
                    <button
                      className="text-button text-button--primary"
                      disabled={
                        preparedMutationId === undefined ||
                        snapshot.mutation.phase !== "planned"
                      }
                      onClick={(event) =>
                        void requestReview(event.currentTarget)
                      }
                      type="button"
                    >
                      <ShieldCheck aria-hidden="true" size={15} />
                      {t("common.openTrustedReview")}
                    </button>
                  ) : (
                    <p
                      className="mutation-outcome"
                      ref={mutationOutcomeRef}
                      role="status"
                      tabIndex={-1}
                    >
                      {snapshot.mutation.outcome.process.disposition} /{" "}
                      {snapshot.mutation.outcome.effects.status}
                    </p>
                  )}
                </section>
              ) : null}
            </aside>
          </>
        ) : view === "comparison" ? (
          <ComparisonView
            client={client}
            onPrepared={(preparedId, destinationTargetId) => {
              const destination = targetStates.find(
                ({ target }) => target.id === destinationTargetId,
              );
              if (destination === undefined) return;
              setPreparedMutationContext({
                generation: destination.target.generation,
                operationId: preparedId,
                targetId: destinationTargetId,
              });
              setSelectedTargetId(destinationTargetId);
              setView("inventory");
            }}
            snapshot={snapshot}
            targets={targetStates}
          />
        ) : view === "collections" ? (
          <CollectionsView client={client} snapshot={snapshot} />
        ) : view === "about" ? (
          <AboutView client={client.about}>
            <PreferencesPanel
              onUpdate={(patch) => client.updatePreferences(patch)}
              preferences={snapshot.preferences}
            />
          </AboutView>
        ) : view === "recovery" ? (
          <RecoveryView
            client={client}
            onSelectTarget={clearTargetScopedState}
            snapshot={snapshot}
            targets={targetStates}
          />
        ) : (
          <TargetsView
            client={client}
            onSelected={clearTargetScopedState}
            targets={targetStates}
          />
        )}
      </div>
    </div>
  );
}
