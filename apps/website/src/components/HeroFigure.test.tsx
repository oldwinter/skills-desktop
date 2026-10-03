// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";

import { COPY } from "../content/copy.js";
import { ILLUSTRATIVE_TARGETS } from "../content/illustrative-inventory.js";
import { HeroFigure } from "./HeroFigure.js";

afterEach(cleanup);

describe("HeroFigure", () => {
  it.each(["en", "zh"] as const)("labels the %s demo as illustrative and announces selected evidence", (locale) => {
    const copy = COPY[locale].hero.figure;
    render(<HeroFigure copy={copy} />);

    expect(screen.getByRole("figure", { name: copy.example })).toBeInTheDocument();
    expect(screen.getByText(copy.example)).toBeVisible();
    const targets = screen.getByRole("group", { name: copy.targets });
    for (const target of ILLUSTRATIVE_TARGETS) {
      const button = within(targets).getByRole("button", { name: target.label });
      button.focus();
      fireEvent.click(button);
      expect(button).toHaveFocus();
      expect(button).toHaveAttribute("aria-pressed", "true");
      expect(within(targets).getAllByRole("button", { pressed: true })).toHaveLength(1);
      expect(screen.getByRole("status")).toHaveTextContent(target.label);
      expect(screen.getByRole("status")).toHaveTextContent(
        copy.summary(target.skills.length, target.harnesses.length),
      );
      expect(screen.getByRole("status")).toHaveAttribute("aria-atomic", "true");
      expect(screen.getAllByText(copy.present)).toHaveLength(target.skills.length);
      expect(screen.getAllByText(copy.covered)).toHaveLength(target.harnesses.length);
      expect(screen.getByText(target.workspace)).toBeVisible();
    }
    expect(screen.getAllByText(copy.absent)).not.toHaveLength(0);
    expect(screen.getAllByText(copy.uncovered)).not.toHaveLength(0);
  });
});
