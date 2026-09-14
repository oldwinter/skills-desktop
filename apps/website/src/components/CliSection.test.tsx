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

  it("falls back to the navigator clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<CliSection copy={copy} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: copy.cli.copy }));
    });

    expect(writeText).toHaveBeenCalledTimes(1);
  });
});
