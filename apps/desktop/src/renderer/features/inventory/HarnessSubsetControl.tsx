import { describeHarnessOption } from "../../../contracts/harness-options.js";

/**
 * Harnesses an add or remove mutation binds to, derived from the Target's
 * harness set minus the user's exclusions. Never empty: the Target set is
 * the floor, so a stale exclusion list can only narrow, not blank, the set.
 */
export function boundHarnessSubset(
  targetHarnessIds: readonly string[],
  excludedHarnessIds: readonly string[],
): readonly string[] {
  const bound = targetHarnessIds.filter(
    (harnessId) => !excludedHarnessIds.includes(harnessId),
  );
  return bound.length === 0 ? targetHarnessIds : bound;
}

/**
 * The `harnessIds` intent field for add/remove: omitted when the whole
 * Target set is bound so unchanged intents stay byte-identical to before.
 */
export function harnessSubsetIntent(
  targetHarnessIds: readonly string[],
  excludedHarnessIds: readonly string[],
): { readonly harnessIds: string[] } | Record<never, never> {
  const bound = boundHarnessSubset(targetHarnessIds, excludedHarnessIds);
  return bound.length === targetHarnessIds.length
    ? {}
    : { harnessIds: [...bound] };
}

export function HarnessSubsetControl({
  disabled = false,
  excludedHarnessIds,
  onChange,
  targetHarnessIds,
}: {
  readonly disabled?: boolean;
  readonly excludedHarnessIds: readonly string[];
  readonly onChange: (excludedHarnessIds: readonly string[]) => void;
  readonly targetHarnessIds: readonly string[];
}) {
  if (targetHarnessIds.length < 2) return null;
  const bound = boundHarnessSubset(targetHarnessIds, excludedHarnessIds);
  return (
    <fieldset className="harness-subset" disabled={disabled}>
      <legend>Bind add and removal to</legend>
      <p className="harness-subset__hint" id="harness-subset-hint">
        Add and removal only touch the checked harnesses. Update always runs
        without a harness limit.
      </p>
      <ul aria-describedby="harness-subset-hint" className="harness-subset__list">
        {targetHarnessIds.map((harnessId) => {
          const checked = bound.includes(harnessId);
          const last = checked && bound.length === 1;
          return (
            <li key={harnessId}>
              <label>
                <input
                  checked={checked}
                  disabled={disabled || last}
                  onChange={(event) => {
                    const next = event.currentTarget.checked
                      ? excludedHarnessIds.filter((id) => id !== harnessId)
                      : [...excludedHarnessIds, harnessId];
                    onChange(next);
                  }}
                  title={
                    last ? "At least one harness must stay bound." : undefined
                  }
                  type="checkbox"
                />
                <span>{describeHarnessOption(harnessId)}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
