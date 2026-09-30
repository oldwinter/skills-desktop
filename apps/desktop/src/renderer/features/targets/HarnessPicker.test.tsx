// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Locale } from "../../../contracts/preferences.js";
import { LocaleProvider } from "../../i18n/LocaleProvider.js";
import { HarnessPicker } from "./HarnessPicker.js";

afterEach(cleanup);

function renderPicker({
  disabled = false,
  locale = "en",
  onChange = vi.fn(),
}: {
  readonly disabled?: boolean;
  readonly locale?: Locale;
  readonly onChange?: (harnessIds: readonly string[]) => void;
} = {}) {
  return render(
    <LocaleProvider locale={locale}>
      <HarnessPicker
        disabled={disabled}
        onChange={onChange}
        value={["codex"]}
      />
    </LocaleProvider>,
  );
}

describe("HarnessPicker filter reset", () => {
  it("clears raw whitespace and no-match queries without changing selection", () => {
    const onChange = vi.fn();
    renderPicker({ onChange });
    const filter = screen.getByRole("searchbox", { name: "Filter harnesses" });

    expect(
      screen.queryByRole("button", { name: "Clear harness filter" }),
    ).not.toBeInTheDocument();
    fireEvent.change(filter, { target: { value: "   " } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(77);
    expect(
      screen.getByRole("button", { name: "Clear harness filter" }),
    ).toBeInTheDocument();

    fireEvent.change(filter, { target: { value: "no-such-harness" } });
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(
      screen.getByText("No harness matches “no-such-harness”."),
    ).toBeInTheDocument();

    const clear = screen.getByRole("button", { name: "Clear harness filter" });
    clear.focus();
    fireEvent.click(clear);

    expect(filter).toHaveValue("");
    expect(filter).toHaveFocus();
    expect(screen.getByRole("checkbox", { name: /^Codex/ })).toBeChecked();
    expect(screen.getAllByRole("checkbox")).toHaveLength(77);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores composed Escape and clears a plain Escape", () => {
    const onChange = vi.fn();
    renderPicker({ onChange });
    const filter = screen.getByRole("searchbox", { name: "Filter harnesses" });
    fireEvent.change(filter, { target: { value: "cod" } });

    fireEvent.keyDown(filter, { isComposing: true, key: "Escape" });
    expect(filter).toHaveValue("cod");

    fireEvent.keyDown(filter, { key: "Escape" });
    expect(filter).toHaveValue("");
    expect(filter).toHaveFocus();
    expect(screen.getByRole("checkbox", { name: /^Codex/ })).toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("blocks filter reset while the picker is disabled", () => {
    const onChange = vi.fn();
    const { rerender } = renderPicker({ onChange });
    const filter = screen.getByRole("searchbox", { name: "Filter harnesses" });
    fireEvent.change(filter, { target: { value: "cod" } });

    rerender(
      <LocaleProvider locale="en">
        <HarnessPicker disabled onChange={onChange} value={["codex"]} />
      </LocaleProvider>,
    );

    const clear = screen.getByRole("button", { name: "Clear harness filter" });
    expect(filter).toBeDisabled();
    expect(clear).toBeDisabled();
    fireEvent.click(clear);
    fireEvent.keyDown(filter, { key: "Escape" });
    expect(filter).toHaveValue("cod");
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    { clear: "Clear harness filter", filter: "Filter harnesses", locale: "en" },
    { clear: "清除 Harness 筛选", filter: "筛选 Harness", locale: "zh-CN" },
  ] as const)("localizes the clear control in $locale", ({ clear, filter, locale }) => {
    renderPicker({ locale });
    fireEvent.change(screen.getByRole("searchbox", { name: filter }), {
      target: { value: "cod" },
    });
    expect(screen.getByRole("button", { name: clear })).toBeInTheDocument();
  });
});
