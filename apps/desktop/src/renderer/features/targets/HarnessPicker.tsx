import { useId, useState } from "react";
import { X } from "lucide-react";

import {
  HARNESS_OPTIONS,
  matchesHarnessQuery,
  normalizeHarnessSelection,
} from "../../../contracts/harness-options.js";

export function HarnessPicker({
  disabled = false,
  onChange,
  value,
}: {
  readonly disabled?: boolean;
  readonly onChange: (harnessIds: readonly string[]) => void;
  readonly value: readonly string[];
}) {
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string>();
  const noticeId = useId();
  const selected = new Set(value);
  const visible = HARNESS_OPTIONS.filter((option) =>
    matchesHarnessQuery(option, query),
  );
  const selectedOptions = HARNESS_OPTIONS.filter((option) =>
    selected.has(option.id),
  );

  const apply = (next: readonly string[]) => {
    const normalized = normalizeHarnessSelection(next);
    if (!normalized.ok) {
      setNotice(normalized.message);
      return;
    }
    setNotice(undefined);
    onChange(normalized.value);
  };

  const toggle = (harnessId: string, checked: boolean) => {
    apply(
      checked
        ? [...value, harnessId]
        : value.filter((candidate) => candidate !== harnessId),
    );
  };

  return (
    <fieldset
      aria-describedby={notice === undefined ? undefined : noticeId}
      className="harness-picker"
      disabled={disabled}
    >
      <legend>Harness</legend>
      <p className="harness-picker-summary" data-testid="harness-selection">
        {selectedOptions.length === 1
          ? "1 harness selected"
          : `${selectedOptions.length} harnesses selected`}
      </p>
      {selectedOptions.length > 0 ? (
        <ul aria-label="Selected harnesses" className="harness-chip-list">
          {selectedOptions.map((option) => (
            <li className="harness-chip" key={option.id}>
              <span>{option.label}</span>
              <code>{option.id}</code>
              <button
                aria-label={`Remove ${option.label}`}
                className="harness-chip-remove"
                disabled={disabled}
                onClick={() => toggle(option.id, false)}
                type="button"
              >
                <X aria-hidden="true" size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="harness-picker-filter">
        <span>Filter harnesses</span>
        <input
          autoComplete="off"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search by name or CLI id"
          type="search"
          value={query}
        />
      </label>
      <div
        aria-label="Available harnesses"
        className="harness-option-list"
        role="group"
      >
        {visible.length === 0 ? (
          <p className="harness-picker-empty">
            No harness matches “{query.trim()}”.
          </p>
        ) : (
          visible.map((option) => (
            <label className="harness-option" key={option.id}>
              <input
                checked={selected.has(option.id)}
                disabled={disabled}
                onChange={(event) =>
                  toggle(option.id, event.currentTarget.checked)
                }
                type="checkbox"
                value={option.id}
              />
              <span className="harness-option-label">
                <span>{option.label}</span>
                <code>{option.id}</code>
              </span>
              {option.globalScopeSupported ? null : (
                <span className="harness-option-note">project only</span>
              )}
            </label>
          ))
        )}
      </div>
      {notice === undefined ? null : (
        <p className="harness-picker-notice" id={noticeId} role="alert">
          {notice}
        </p>
      )}
    </fieldset>
  );
}
