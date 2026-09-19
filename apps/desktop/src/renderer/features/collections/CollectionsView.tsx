import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CircleHelp,
  FileDown,
  Laptop,
  LibraryBig,
  ListFilter,
  LoaderCircle,
  Package,
  PackagePlus,
  RotateCcw,
  Server,
  ShieldCheck,
} from "lucide-react";

import type { MessageKey } from "../../../contracts/i18n/translate.js";
import type {
  PackageOrigin,
  PublicCollectionsState,
  PublicImportedPackage,
  RendererError,
  WorkspaceBridge,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";
import { useTranslator } from "../../i18n/LocaleProvider.js";
import { UserFacingErrorCopy } from "../../UserFacingErrorCopy.js";

type Release = PublicCollectionsState["releases"][number];
type TargetState = NonNullable<WorkspaceSnapshot["targets"]>[number];

/**
 * ADR 0017: one selectable recipe surface over two immutable origins. An
 * Imported Package is never folded into the Official shape; the view keeps
 * both records and only shares the dimensioned assessment and plan path.
 */
type Recipe = {
  readonly assessments: Release["assessments"];
  readonly blockers: readonly string[];
  readonly description: string;
  readonly digest: string;
  readonly executable: boolean;
  readonly id: string;
  readonly imported: PublicImportedPackage | undefined;
  readonly official: Release | undefined;
  readonly origin: PackageOrigin;
  readonly releaseNumber: number;
  readonly title: string;
};
type Scope = "global" | "project";
type SelectionMode = "add" | "reapply";
type TargetInput = {
  readonly included: boolean;
  readonly scope: Scope;
  readonly selected: Readonly<Record<string, SelectionMode>>;
};

type EntryStatus = NonNullable<
  Release["assessments"]
>[number]["entries"][number]["status"];

const statusKey = (status: EntryStatus): MessageKey =>
  `collections.status.${status}`;

function recipeKey(recipe: Recipe) {
  return `${recipe.origin}:${recipe.id}:${recipe.releaseNumber}:${recipe.digest}`;
}

function recipesFor(collections: PublicCollectionsState | undefined): Recipe[] {
  if (collections === undefined) return [];
  return [
    ...collections.releases.map((release): Recipe => ({
      assessments: release.assessments,
      blockers: release.blockers,
      description: release.description,
      digest: release.manifestDigest,
      executable: release.executable,
      id: release.collectionId,
      imported: undefined,
      official: release,
      origin: "official",
      releaseNumber: release.releaseNumber,
      title: release.title,
    })),
    ...(collections.packages ?? []).map((pkg): Recipe => ({
      assessments: pkg.assessments,
      blockers: pkg.blockers,
      description: pkg.description,
      digest: pkg.documentDigest,
      executable: pkg.executable,
      id: pkg.packageId,
      imported: pkg,
      official: undefined,
      origin: "imported",
      releaseNumber: pkg.release,
      title: pkg.title,
    })),
  ];
}

function targetStatesFor(snapshot: WorkspaceSnapshot): TargetState[] {
  return (
    snapshot.targets ?? [
      {
        collections: snapshot.collections,
        deletionBlocked: false,
        inventory: snapshot.inventory,
        mutation: snapshot.mutation,
        target: snapshot.target,
      },
    ]
  );
}

function inputFor(
  targetId: string,
  activeTargetId: string,
  kind: TargetState["target"]["kind"],
): TargetInput {
  return {
    // V1 Local-only: SSH Targets stay visible but never included in Collections.
    included: kind !== "ssh" && targetId === activeTargetId,
    scope: "project",
    selected: {},
  };
}

export function CollectionsView({
  client,
  onOpenInventory,
  snapshot,
}: {
  readonly client: WorkspaceBridge;
  readonly onOpenInventory?: () => void;
  readonly snapshot: WorkspaceSnapshot;
}) {
  const { t, tc } = useTranslator();
  const collections = snapshot.collections;
  const recipes = useMemo(() => recipesFor(collections), [collections]);
  const targetStates = useMemo(() => targetStatesFor(snapshot), [snapshot]);
  const targetKey = targetStates
    .map(({ target }) => `${target.id}:${target.generation}`)
    .join("|");
  const [releaseSelection, setReleaseSelection] = useState(
    recipes[0] === undefined ? "" : recipeKey(recipes[0]),
  );
  const [importing, setImporting] = useState(false);
  const [inputs, setInputs] = useState<Record<string, TargetInput>>(() =>
    Object.fromEntries(
      targetStates.map(({ target }) => [
        target.id,
        inputFor(target.id, snapshot.target.id, target.kind),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RendererError>();
  const statusHeadingRef = useRef<HTMLHeadingElement>(null);

  const release =
    recipes.find((candidate) => recipeKey(candidate) === releaseSelection) ??
    recipes[0];

  useEffect(() => {
    setInputs(
      Object.fromEntries(
        targetStates.map(({ target }) => [
          target.id,
          inputFor(target.id, snapshot.target.id, target.kind),
        ]),
      ),
    );
    // targetKey captures the Target identity and generation changes that reset
    // inputs without resetting them for unrelated Snapshot updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releaseSelection, snapshot.target.id, targetKey]);

  useEffect(() => {
    if (
      collections !== undefined &&
      (collections.plan !== null || collections.execution !== null)
    ) {
      statusHeadingRef.current?.focus();
    }
  }, [collections]);

  const releaseFor = (targetState: TargetState) =>
    recipesFor(targetState.collections).find(
      (candidate) =>
        release !== undefined && recipeKey(candidate) === recipeKey(release),
    );

  const assessmentFor = (targetState: TargetState, scope: Scope) =>
    releaseFor(targetState)?.assessments.find(
      (candidate) =>
        candidate.scope === scope &&
        candidate.targetId === targetState.target.id &&
        candidate.targetGeneration === targetState.target.generation,
    );

  const selectionsFor = (targetState: TargetState, input: TargetInput) => {
    const assessment = assessmentFor(targetState, input.scope);
    return (assessment?.entries ?? []).flatMap((entry) => {
      const mode = input.selected[entry.name];
      return mode === undefined ? [] : [{ mode, name: entry.name }];
    });
  };

  const targetBlockers = (targetState: TargetState, input: TargetInput) => {
    const targetRelease = releaseFor(targetState);
    const assessment = assessmentFor(targetState, input.scope);
    const blockers: string[] = [];
    if (targetRelease === undefined || !targetRelease.executable) {
      blockers.push(
        t(
          release?.origin === "imported"
            ? "collections.blocker.noRecipe"
            : "collections.blocker.noRelease",
        ),
      );
    }
    if (assessment?.compatibility !== "compatible") {
      blockers.push(t("collections.blocker.incompatible"));
    }
    if (assessment?.inventoryFreshness !== "fresh") {
      blockers.push(t("collections.blocker.freshness"));
    }
    if (targetState.mutation.phase === "reconciliation-required") {
      blockers.push(t("collections.blocker.reconciliation"));
    }
    return blockers;
  };

  const selectedTargets = targetStates.flatMap((targetState) => {
    const input = inputs[targetState.target.id];
    if (input === undefined || !input.included) return [];
    if (targetState.target.kind === "ssh") return [];
    return [
      { input, selections: selectionsFor(targetState, input), targetState },
    ];
  });
  const canPrepare =
    !busy &&
    collections?.plan === null &&
    release !== undefined &&
    selectedTargets.length > 0 &&
    selectedTargets.every(
      ({ input, selections, targetState }) =>
        selections.length > 0 &&
        targetBlockers(targetState, input).length === 0,
    );

  const updateInput = (
    targetId: string,
    update: (current: TargetInput) => TargetInput,
  ) => {
    setInputs((current) => {
      const value = current[targetId];
      return value === undefined
        ? current
        : { ...current, [targetId]: update(value) };
    });
  };

  const prepare = async () => {
    if (release === undefined || !canPrepare) return;
    setBusy(true);
    try {
      const result = await client.prepareCollectionAcrossTargets({
        collectionId: release.id,
        manifestDigest: release.digest,
        origin: release.origin,
        releaseNumber: release.releaseNumber,
        targets: selectedTargets.map(({ input, selections, targetState }) => ({
          scope: input.scope,
          selections,
          targetId: targetState.target.id,
        })),
      });
      if (result.ok) setError(undefined);
      else setError(result.error);
    } finally {
      setBusy(false);
    }
  };

  const requestReview = async () => {
    if (collections?.plan === null || collections?.plan === undefined) return;
    setBusy(true);
    try {
      const result = await client.requestCollectionReview(collections.plan.id);
      if (result.ok) setError(undefined);
      else setError(result.error);
    } finally {
      setBusy(false);
    }
  };

  const reconcile = async (targetId: string) => {
    setBusy(true);
    try {
      const result = await client.reconcileMutation(targetId);
      if (result.ok) setError(undefined);
      else setError(result.error);
    } finally {
      setBusy(false);
    }
  };

  const refresh = async (targetId: string) => {
    setBusy(true);
    try {
      const result = await client.refreshInventory(targetId);
      if (result.ok) setError(undefined);
      else setError(result.error);
    } finally {
      setBusy(false);
    }
  };

  const importPackage = async () => {
    setImporting(true);
    try {
      const result = await client.importPackage();
      if (result.ok) setError(undefined);
      else setError(result.error);
    } finally {
      setImporting(false);
    }
  };

  const lastImport = collections?.lastImport ?? null;
  const importButton = (
    <button
      className="text-button"
      data-testid="collections-import"
      disabled={importing || busy}
      onClick={() => void importPackage()}
      type="button"
    >
      {importing ? (
        <LoaderCircle className="spin" aria-hidden="true" size={15} />
      ) : (
        <FileDown aria-hidden="true" size={15} />
      )}
      {t(importing ? "collections.importing" : "collections.import")}
    </button>
  );
  const importOutcome =
    lastImport === null ? null : (
      <div
        className={`state-banner ${
          lastImport.status === "conflict"
            ? "state-banner--warning"
            : "state-banner--loading"
        }`}
        data-testid="collections-import-outcome"
        role="status"
      >
        {lastImport.status === "conflict" ? (
          <AlertCircle aria-hidden="true" size={16} />
        ) : (
          <Package aria-hidden="true" size={16} />
        )}
        <span>
          {t(`collections.import.status.${lastImport.status}`, {
            packageId: lastImport.packageId ?? "",
            relatedRelease: lastImport.relatedRelease ?? 0,
            release: lastImport.release ?? 0,
          })}
          {lastImport.fileName === null ? "" : ` (${lastImport.fileName})`}
        </span>
      </div>
    );

  if (collections === undefined || recipes.length === 0) {
    return (
      <main className="collections-workspace" id="workspace-main" tabIndex={-1}>
        <section className="page-heading">
          <div>
            <h1>{t("collections.title")}</h1>
            <p>{t("collections.noneBundled")}</p>
          </div>
          {importButton}
        </section>
        {importOutcome}
        {error !== undefined ? (
          <div className="state-banner state-banner--danger" role="alert">
            <AlertCircle aria-hidden="true" size={16} />
            <UserFacingErrorCopy error={error} />
          </div>
        ) : null}
        <div className="empty-state" role="status">
          <CircleHelp aria-hidden="true" size={22} />
          <h2>{t("collections.empty.heading")}</h2>
          <p>{t("collections.empty.body")}</p>
          <p>{t("collections.empty.nextStep")}</p>
          {onOpenInventory !== undefined ? (
            <button
              className="text-button text-button--primary"
              onClick={onOpenInventory}
              type="button"
            >
              <ListFilter aria-hidden="true" size={15} />
              {t("common.openInventory")}
            </button>
          ) : null}
          <p className="empty-state__hint">{t("collections.import.hint")}</p>
        </div>
      </main>
    );
  }

  const execution = collections.execution;
  const plan = collections.plan;
  const officialRecipes = recipes.filter(({ origin }) => origin === "official");
  const importedRecipes = recipes.filter(({ origin }) => origin === "imported");
  const recipeOptions = (group: Recipe[]) =>
    group.map((candidate) => (
      <option key={recipeKey(candidate)} value={recipeKey(candidate)}>
        {t("collections.releaseOption", {
          release: candidate.releaseNumber,
          title: candidate.title,
        })}
      </option>
    ));

  return (
    <>
      <main className="collections-workspace" id="workspace-main" tabIndex={-1}>
        <section className="page-heading">
          <div>
            <h1>{t("collections.title")}</h1>
            <p>
              {tc("collections.bundled", officialRecipes.length)}
              {importedRecipes.length === 0
                ? ""
                : ` · ${tc("collections.imported", importedRecipes.length)}`}
            </p>
          </div>
          {importButton}
        </section>

        <div className="collection-controls">
          <label>
            <span>{t("collections.release")}</span>
            <select
              disabled={busy || plan !== null || execution?.phase === "running"}
              onChange={(event) =>
                setReleaseSelection(event.currentTarget.value)
              }
              value={release === undefined ? "" : recipeKey(release)}
            >
              {importedRecipes.length === 0 ? (
                recipeOptions(officialRecipes)
              ) : (
                <>
                  {officialRecipes.length === 0 ? null : (
                    <optgroup label={t("collections.originGroup.official")}>
                      {recipeOptions(officialRecipes)}
                    </optgroup>
                  )}
                  <optgroup label={t("collections.originGroup.imported")}>
                    {recipeOptions(importedRecipes)}
                  </optgroup>
                </>
              )}
            </select>
          </label>
          <button
            className="text-button text-button--primary"
            disabled={!canPrepare}
            onClick={() => void prepare()}
            type="button"
          >
            <PackagePlus aria-hidden="true" size={15} />
            {t("collections.preparePlan")}
          </button>
        </div>

        {importOutcome}
        {release?.blockers.map((blocker) => (
          <div
            className="state-banner state-banner--warning"
            key={blocker}
            role="status"
          >
            <AlertCircle aria-hidden="true" size={16} />
            <span>{blocker}</span>
          </div>
        ))}
        {error !== undefined ? (
          <div className="state-banner state-banner--danger" role="alert">
            <AlertCircle aria-hidden="true" size={16} />
            <UserFacingErrorCopy error={error} />
          </div>
        ) : null}

        {execution === null || execution === undefined ? null : (
          <section className="collection-execution" aria-live="polite">
            <header>
              {execution.phase === "running" ? (
                <LoaderCircle className="spin" aria-hidden="true" size={17} />
              ) : execution.phase === "completed" ? (
                <CheckCircle2 aria-hidden="true" size={17} />
              ) : (
                <AlertCircle aria-hidden="true" size={17} />
              )}
              <div>
                <h2 ref={statusHeadingRef} tabIndex={-1}>
                  {t(
                    execution.phase === "running"
                      ? "collections.run.running"
                      : execution.phase === "completed"
                        ? "collections.run.completed"
                        : "collections.run.stopped",
                  )}
                </h2>
                <p>{t("collections.run.semantics")}</p>
              </div>
            </header>
            <ol className="collection-progress-list">
              {execution.children.map((child) => (
                <li key={`${child.position}:${child.target.id}`}>
                  <div className="collection-progress-heading">
                    <strong>
                      {child.position}. {child.target.label}
                    </strong>
                    <span>{child.status}</span>
                  </div>
                  <ul>
                    {child.skills.map((skill) => (
                      <li key={`${skill.mode}:${skill.name}`}>
                        <span>
                          {skill.name} / {skill.mode}
                        </span>
                        <span>
                          {skill.status}
                          {skill.effects === null ? "" : ` / ${skill.effects}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {child.error === null ? null : (
                    <div className="collection-child-error">
                      <UserFacingErrorCopy error={child.error} />
                    </div>
                  )}
                  {child.status === "reconciliation-required" ? (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void reconcile(child.target.id)}
                      type="button"
                    >
                      <RotateCcw aria-hidden="true" size={15} />
                      {t("collections.run.reconcile", {
                        label: child.target.label,
                      })}
                    </button>
                  ) : execution.phase === "stopped" &&
                    child.status !== "pending" &&
                    child.status !== "running" ? (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void refresh(child.target.id)}
                      type="button"
                    >
                      <RotateCcw aria-hidden="true" size={15} />
                      {t("collections.run.refresh", {
                        label: child.target.label,
                      })}
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        )}

        <div className="collection-machine-list">
          {targetStates.map((targetState) => {
            const input =
              inputs[targetState.target.id] ??
              inputFor(
                targetState.target.id,
                snapshot.target.id,
                targetState.target.kind,
              );
            const assessment = assessmentFor(targetState, input.scope);
            const blockers = targetBlockers(targetState, input);
            const targetRelease = releaseFor(targetState);
            const included = input.included;
            const inventoryFreshness =
              assessment?.inventoryFreshness ?? targetState.inventory.freshness;
            const inventoryFreshnessLabel = t(
              inventoryFreshness === "fresh"
                ? "collections.inventory.fresh"
                : inventoryFreshness === "stale"
                  ? "collections.inventory.stale"
                  : "collections.inventory.none",
            );
            const locked =
              busy || plan !== null || execution?.phase === "running";
            const missingEntries = (assessment?.entries ?? []).filter(
              (entry) =>
                entry.status === "missing" &&
                entry.selectable &&
                entry.selectionModes.includes("add"),
            );
            const TargetIcon =
              targetState.target.kind === "ssh" ? Server : Laptop;
            return (
              <section
                className="collection-machine"
                key={targetState.target.id}
              >
                <header>
                  <div className="collection-machine-toggle">
                    <label className="collection-checkbox-hit-area">
                      <input
                        aria-label={t("collections.include", {
                          label: targetState.target.label,
                        })}
                        checked={
                          targetState.target.kind === "ssh" ? false : included
                        }
                        disabled={locked || targetState.target.kind === "ssh"}
                        onChange={(event) => {
                          if (targetState.target.kind === "ssh") return;
                          const included = event.currentTarget.checked;
                          updateInput(targetState.target.id, (current) => ({
                            ...current,
                            included,
                          }));
                        }}
                        title={
                          targetState.target.kind === "ssh"
                            ? t("collections.sshExcluded")
                            : undefined
                        }
                        type="checkbox"
                      />
                    </label>
                    <TargetIcon aria-hidden="true" size={17} />
                    <span>
                      <strong>{targetState.target.label}</strong>
                      <small>
                        {t(
                          targetState.target.kind === "ssh"
                            ? "common.ssh.notInV1"
                            : "common.local",
                        )}{" "}
                        / {targetState.target.harnessIds.join(", ")}
                      </small>
                      <small>{inventoryFreshnessLabel}</small>
                    </span>
                  </div>
                  <label className="collection-scope-select">
                    <span>{t("common.scope")}</span>
                    <select
                      disabled={locked || !included}
                      onChange={(event) => {
                        const scope = event.currentTarget.value as Scope;
                        updateInput(targetState.target.id, (current) => ({
                          ...current,
                          scope,
                          selected: {},
                        }));
                      }}
                      value={input.scope}
                    >
                      <option value="project">
                        {t("common.scope.project")}
                      </option>
                      <option value="global">{t("common.scope.global")}</option>
                    </select>
                  </label>
                </header>
                {blockers.length === 0 ? null : (
                  <ul className="collection-target-blockers">
                    {blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                )}
                <div className="collection-selection-actions">
                  <button
                    className="text-button"
                    aria-label={t("collections.selectMissingOn", {
                      label: targetState.target.label,
                    })}
                    disabled={
                      locked ||
                      !included ||
                      targetState.target.kind === "ssh" ||
                      blockers.length > 0 ||
                      missingEntries.every(
                        (entry) => input.selected[entry.name] === "add",
                      )
                    }
                    onClick={() =>
                      updateInput(targetState.target.id, (current) => {
                        const selected = { ...current.selected };
                        for (const entry of missingEntries) {
                          selected[entry.name] = "add";
                        }
                        return { ...current, selected };
                      })
                    }
                    type="button"
                  >
                    {t("collections.selectMissing")}
                  </button>
                  <button
                    className="text-button"
                    aria-label={t("collections.clearSelectionOn", {
                      label: targetState.target.label,
                    })}
                    disabled={
                      locked ||
                      !included ||
                      targetState.target.kind === "ssh" ||
                      Object.keys(input.selected).length === 0
                    }
                    onClick={() =>
                      updateInput(targetState.target.id, (current) => ({
                        ...current,
                        selected: {},
                      }))
                    }
                    type="button"
                  >
                    {t("collections.clearSelection")}
                  </button>
                </div>
                <div className="collection-table-wrap">
                  <table className="collection-table">
                    <caption className="sr-only">
                      {t("collections.assessmentCaption", {
                        label: targetState.target.label,
                      })}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("collections.table.include")}</th>
                        <th scope="col">{t("common.skill")}</th>
                        <th scope="col">{t("collections.table.assessment")}</th>
                        <th scope="col">{t("collections.table.action")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(assessment?.entries ?? []).map((entry) => {
                        const mode = entry.selectionModes[0];
                        const selectionLabel =
                          targetStates.length === 1
                            ? t("collections.select", { name: entry.name })
                            : t("collections.selectOn", {
                                label: targetState.target.label,
                                name: entry.name,
                              });
                        return (
                          <tr key={`${input.scope}:${entry.name}`}>
                            <td data-label={t("collections.table.include")}>
                              <label className="collection-checkbox-hit-area">
                                <input
                                  aria-label={selectionLabel}
                                  checked={
                                    input.selected[entry.name] !== undefined
                                  }
                                  disabled={
                                    locked ||
                                    !included ||
                                    !targetRelease?.executable ||
                                    !entry.selectable ||
                                    mode === undefined
                                  }
                                  onChange={(event) => {
                                    const checked = event.currentTarget.checked;
                                    updateInput(
                                      targetState.target.id,
                                      (current) => {
                                        const selected = {
                                          ...current.selected,
                                        };
                                        if (!checked)
                                          delete selected[entry.name];
                                        else if (mode !== undefined)
                                          selected[entry.name] = mode;
                                        return { ...current, selected };
                                      },
                                    );
                                  }}
                                  type="checkbox"
                                />
                              </label>
                            </td>
                            <td data-label={t("common.skill")}>
                              <strong>{entry.name}</strong>
                            </td>
                            <td data-label={t("collections.table.assessment")}>
                              <span
                                className={`collection-status collection-status--${entry.status}`}
                              >
                                {t(statusKey(entry.status))}
                              </span>
                            </td>
                            <td data-label={t("collections.table.action")}>
                              {t(
                                mode === undefined
                                  ? "collections.action.notSelectable"
                                  : mode === "add"
                                    ? "collections.action.add"
                                    : "collections.action.reapply",
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      </main>

      <aside
        className="inspector collection-inspector"
        aria-label={t(
          release?.origin === "imported"
            ? "collections.inspector.importedLabel"
            : "collections.inspector.label",
        )}
      >
        {release === undefined ? null : (
          <>
            <header className="inspector-heading">
              {release.origin === "imported" ? (
                <Package aria-hidden="true" size={18} />
              ) : (
                <LibraryBig aria-hidden="true" size={18} />
              )}
              <div>
                <p>{release.id}</p>
                <h2>{release.title}</h2>
              </div>
            </header>
            <p className="collection-description">{release.description}</p>
            <dl className="evidence-list" data-testid="collection-evidence">
              <div>
                <dt>{t("collections.inspector.origin")}</dt>
                <dd data-testid="collection-origin">
                  {t(
                    release.origin === "imported"
                      ? "collections.origin.imported"
                      : "collections.origin.official",
                  )}
                </dd>
              </div>
              {release.official !== undefined ? (
                <>
                  <div>
                    <dt>{t("collections.inspector.status")}</dt>
                    <dd>{release.official.status}</dd>
                  </div>
                  <div>
                    <dt>{t("collections.inspector.independentReview")}</dt>
                    <dd>{release.official.receipt.status}</dd>
                  </div>
                  <div>
                    <dt>{t("collections.inspector.pinnedSource")}</dt>
                    <dd>
                      <code>{release.official.source.repository}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>{t("collections.inspector.reviewedRevision")}</dt>
                    <dd>
                      <code>{release.official.source.reviewedRevision}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>{t("collections.inspector.manifestDigest")}</dt>
                    <dd>
                      <code>{release.official.manifestDigest}</code>
                    </dd>
                  </div>
                </>
              ) : null}
              {release.imported !== undefined ? (
                <>
                  <div>
                    <dt>{t("collections.inspector.independentReview")}</dt>
                    <dd>{t("collections.inspector.noOfficialReview")}</dd>
                  </div>
                  <div>
                    <dt>{t("collections.inspector.source")}</dt>
                    <dd>
                      <code>{release.imported.source.repository}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>{t("collections.inspector.reviewedRevision")}</dt>
                    <dd>
                      <code>
                        {release.imported.source.revision ??
                          t("collections.inspector.unpinned")}
                      </code>
                    </dd>
                  </div>
                  <div>
                    <dt>{t("collections.inspector.documentDigest")}</dt>
                    <dd>
                      <code>{release.imported.documentDigest}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>{t("collections.inspector.importedAt")}</dt>
                    <dd>
                      <time dateTime={release.imported.importedAt}>
                        {release.imported.importedAt}
                      </time>
                    </dd>
                  </div>
                  <div>
                    <dt>{t("collections.inspector.delta")}</dt>
                    <dd data-testid="collection-delta">
                      {release.imported.delta === null
                        ? t("collections.inspector.delta.none")
                        : t(
                            release.imported.delta.kind === "upgrade"
                              ? "collections.inspector.delta.upgrade"
                              : "collections.inspector.delta.downgrade",
                            {
                              fromRelease: release.imported.delta.fromRelease,
                              toRelease: release.imported.delta.toRelease,
                            },
                          )}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("collections.inspector.conflicts")}</dt>
                    <dd data-testid="collection-conflicts">
                      {release.imported.conflicts.length === 0 ? (
                        t("collections.inspector.conflicts.none")
                      ) : (
                        <ul>
                          {release.imported.conflicts.map((conflict) => (
                            <li key={conflict.documentDigest}>
                              {t("collections.inspector.conflict", {
                                digest: conflict.documentDigest,
                                release: conflict.release,
                              })}
                            </li>
                          ))}
                        </ul>
                      )}
                    </dd>
                  </div>
                </>
              ) : null}
              <div>
                <dt>{t("collections.inspector.targetsSelected")}</dt>
                <dd>{selectedTargets.length}</dd>
              </div>
            </dl>
            {plan === null ? null : (
              <section className="collection-plan-summary">
                <header>
                  <CheckCircle2 aria-hidden="true" size={16} />
                  <h3 ref={statusHeadingRef} tabIndex={-1}>
                    {t("collections.plan.heading")}
                  </h3>
                </header>
                <p>{t("collections.plan.semantics")}</p>
                <ol>
                  {plan.order.map((child) => (
                    <li key={`${child.position}:${child.targetId}`}>
                      {child.position}. {child.names.join(", ")} /{" "}
                      {"scope" in child
                        ? child.scope
                        : plan.schemaVersion === 1
                          ? plan.scope
                          : "project"}
                    </li>
                  ))}
                </ol>
                <code>{plan.reviewDigest}</code>
                <button
                  className="text-button text-button--primary"
                  disabled={busy}
                  onClick={() => void requestReview()}
                  type="button"
                >
                  <ShieldCheck aria-hidden="true" size={15} />
                  {t("common.openTrustedReview")}
                </button>
              </section>
            )}
          </>
        )}
      </aside>
    </>
  );
}
