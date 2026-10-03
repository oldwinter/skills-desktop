// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CLI_EXAMPLES, formatArgumentArray } from "../content/cli-examples.js";
import { COPY } from "../content/copy.js";
import { CliSection } from "./CliSection.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const copy = COPY.en;

function exampleFor(id: string) {
  const example = CLI_EXAMPLES.find((candidate) => candidate.id === id);
  if (example === undefined) throw new Error(`missing example ${id}`);
  return example;
}

describe("CliSection", () => {
  it("shows the verify example first and switches tabs", () => {
    render(<CliSection copy={copy} writeClipboard={vi.fn()} />);

    expect(screen.getByRole("tab", { name: copy.cli.tabs.verify })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("cli-argument-array")).toHaveTextContent(
      formatArgumentArray(exampleFor("verify").args),
    );

    fireEvent.click(screen.getByRole("tab", { name: copy.cli.tabs.add }));

    expect(screen.getByRole("tab", { name: copy.cli.tabs.add })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("cli-argument-array")).toHaveTextContent(
      formatArgumentArray(exampleFor("add").args),
    );
    expect(screen.getByText(copy.cli.comments.add)).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("$ npx --yes skills@1.5.23 add");
  });

  it("copies the current argument array and resets the label afterwards", async () => {
    vi.useFakeTimers();
    const writeClipboard = vi.fn().mockResolvedValue(undefined);
    render(<CliSection copy={copy} writeClipboard={writeClipboard} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: copy.cli.copy }));
    });

    expect(writeClipboard).toHaveBeenCalledWith(formatArgumentArray(exampleFor("verify").args));
    expect(screen.getByRole("button", { name: copy.cli.copied })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1700);
    });
    expect(screen.getByRole("button", { name: copy.cli.copy })).toBeInTheDocument();
  });

  it("stays quiet when the clipboard is unavailable", async () => {
    const writeClipboard = vi.fn().mockRejectedValue(new Error("denied"));
    render(<CliSection copy={copy} writeClipboard={writeClipboard} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: copy.cli.copy }));
    });

    expect(screen.getByRole("button", { name: copy.cli.copy })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.cli.copied })).not.toBeInTheDocument();
  });

  it("moves through tabs with arrow keys, Home and End using one tab stop", () => {
    render(<CliSection copy={copy} writeClipboard={vi.fn()} />);
    const verify = screen.getByRole("tab", { name: copy.cli.tabs.verify });
    const list = screen.getByRole("tab", { name: copy.cli.tabs.list });
    const update = screen.getByRole("tab", { name: copy.cli.tabs.update });
    verify.focus();

    fireEvent.keyDown(verify, { key: "ArrowRight" });
    expect(list).toHaveFocus();
    expect(list).toHaveAttribute("aria-selected", "true");
    expect(verify).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName(copy.cli.tabs.list);
    expect(list).toHaveAttribute("aria-controls", screen.getByRole("tabpanel").id);

    fireEvent.keyDown(list, { key: "End" });
    expect(update).toHaveFocus();
    fireEvent.keyDown(update, { key: "ArrowRight" });
    expect(verify).toHaveFocus();
    fireEvent.keyDown(verify, { key: "ArrowLeft" });
    expect(update).toHaveFocus();
    fireEvent.keyDown(update, { key: "Home" });
    expect(verify).toHaveFocus();
    expect(screen.getAllByRole("tab").filter((tab) => tab.tabIndex === 0)).toEqual([verify]);
    fireEvent.keyDown(verify, { key: "Tab" });
    expect(verify).toHaveAttribute("aria-selected", "true");
  });

  it("keeps copy outside the tablist and clears the old copied state on selection", async () => {
    const writeClipboard = vi.fn().mockResolvedValue(undefined);
    render(<CliSection copy={copy} writeClipboard={writeClipboard} />);
    const tablist = screen.getByRole("tablist");
    expect(tablist).not.toContainElement(screen.getByRole("button", { name: copy.cli.copy }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: copy.cli.copy }));
    });
    expect(screen.getByRole("button", { name: copy.cli.copied })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: copy.cli.tabs.add }));
    expect(screen.getByRole("button", { name: copy.cli.copy })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: copy.cli.copy }));
    });
    expect(writeClipboard).toHaveBeenLastCalledWith(formatArgumentArray(exampleFor("add").args));
  });

  it("falls back to the navigator clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<CliSection copy={copy} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: copy.cli.copy }));
    });

    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("does not label a new tab copied when an earlier clipboard request finishes", async () => {
    let completeCopy = () => {};
    const pending = new Promise<void>((resolve) => { completeCopy = resolve; });
    const writeClipboard = vi.fn().mockReturnValue(pending);
    render(<CliSection copy={copy} writeClipboard={writeClipboard} />);

    fireEvent.click(screen.getByRole("button", { name: copy.cli.copy }));
    fireEvent.click(screen.getByRole("tab", { name: copy.cli.tabs.list }));
    await act(async () => completeCopy());

    expect(screen.getByRole("button", { name: copy.cli.copy })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.cli.copied })).not.toBeInTheDocument();
    expect(writeClipboard).toHaveBeenCalledWith(formatArgumentArray(exampleFor("verify").args));
  });
});
