// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  boundHarnessSubset,
  HarnessSubsetControl,
  harnessSubsetIntent,
} from "./HarnessSubsetControl.js";

afterEach(cleanup);

describe("Harness subset for add and remove", () => {
  it("never derives an empty subset and omits the field for the whole set", () => {
    expect(boundHarnessSubset(["amp", "codex"], [])).toEqual(["amp", "codex"]);
    expect(boundHarnessSubset(["amp", "codex"], ["amp"])).toEqual(["codex"]);
    // Stale exclusions from a previous Target cannot blank the set.
    expect(boundHarnessSubset(["codex"], ["codex"])).toEqual(["codex"]);
    expect(boundHarnessSubset(["amp", "codex"], ["amp", "codex"])).toEqual([
      "amp",
      "codex",
    ]);

    expect(harnessSubsetIntent(["amp", "codex"], [])).toEqual({});
    expect(harnessSubsetIntent(["amp", "codex"], ["cursor"])).toEqual({});
    expect(harnessSubsetIntent(["amp", "codex"], ["amp"])).toEqual({
      harnessIds: ["codex"],
    });
  });

  it("renders nothing for a single-harness Target", () => {
    const { container } = render(
      <HarnessSubsetControl
        excludedHarnessIds={[]}
        onChange={() => undefined}
        targetHarnessIds={["codex"]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("toggles exclusions and refuses to uncheck the last bound harness", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <HarnessSubsetControl
        excludedHarnessIds={[]}
        onChange={onChange}
        targetHarnessIds={["amp", "codex"]}
      />,
    );
    expect(
      screen.getByRole("group", { name: "Bind add and removal to" }),
    ).toBeInTheDocument();
    const amp = screen.getByRole("checkbox", { name: "Amp (amp)" });
    const codex = screen.getByRole("checkbox", { name: "Codex (codex)" });
    expect(amp).toBeChecked();
    expect(codex).toBeChecked();

    fireEvent.click(amp);
    expect(onChange).toHaveBeenLastCalledWith(["amp"]);

    rerender(
      <HarnessSubsetControl
        excludedHarnessIds={["amp"]}
        onChange={onChange}
        targetHarnessIds={["amp", "codex"]}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Amp (amp)" })).not.toBeChecked();
    const lastBound = screen.getByRole("checkbox", { name: "Codex (codex)" });
    expect(lastBound).toBeChecked();
    expect(lastBound).toBeDisabled();
    expect(lastBound).toHaveAttribute(
      "title",
      "At least one harness must stay bound.",
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Amp (amp)" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
