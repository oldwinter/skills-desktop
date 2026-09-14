// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "../content/copy.js";
import { ILLUSTRATIVE_TARGETS, targetById } from "../content/illustrative-inventory.js";
import { HeroFigure } from "./HeroFigure.js";

const copy = COPY.en.hero.figure;

function wirePaths(): SVGPathElement[] {
  return Array.from(document.querySelectorAll<SVGPathElement>("path.wire__path"));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("HeroFigure wiring", () => {
  it("draws no wires while the figure has no layout box", () => {
    render(<HeroFigure copy={copy} />);
    expect(wirePaths()).toHaveLength(0);
  });

  describe("with a measurable layout", () => {
    beforeEach(() => {
      let offset = 0;
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
        this: Element,
      ) {
        // Rows stack 40px apart; the figure box is wide enough that every wire has a span.
        const top = this.classList.contains("wire") ? 0 : (offset += 40);
        const width = this.classList.contains("wire") ? 1200 : 240;
        return {
          bottom: top + 36,
          height: 36,
          left: 0,
          right: width,
          toJSON: () => ({}),
          top,
          width,
          x: 0,
          y: top,
        } as DOMRect;
      });
    });

    it("wires every present skill and covered harness to the selected Target", () => {
      render(<HeroFigure copy={copy} />);
      const [first, second] = ILLUSTRATIVE_TARGETS;
      if (first === undefined || second === undefined) throw new Error("fixture requires two targets");

      expect(wirePaths()).toHaveLength(first.skills.length + first.harnesses.length);
      for (const path of wirePaths()) {
        expect(path.getAttribute("d")).toMatch(/^M [\d.-]+ [\d.-]+ C .+/);
        expect(path.id).toContain(`wire-${first.id}-`);
      }

      const pills = screen.getByRole("group", { name: copy.targets });
      fireEvent.click(within(pills).getByRole("button", { name: second.label }));

      const target = targetById(second.id);
      const paths = wirePaths();
      expect(paths).toHaveLength(target.skills.length + target.harnesses.length);
      expect(paths.map((path) => path.id)).toEqual(
        expect.arrayContaining([
          ...target.skills.map((skill) => expect.stringContaining(`wire-${target.id}-skill-`)),
          ...target.harnesses.map((harness) =>
            expect.stringContaining(`wire-${target.id}-harness-${harness}`),
          ),
        ]),
      );
      for (const skill of target.skills) {
        expect(document.getElementById(`wire-${target.id}-skill-${skill}`)).not.toBeNull();
      }
    });

    it("auto-advances through Targets until one is chosen by hand", () => {
      vi.useFakeTimers();
      vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({ addEventListener: vi.fn(), matches: false, removeEventListener: vi.fn() })),
      );
      try {
        render(<HeroFigure copy={copy} />);
        const [first, second, third] = ILLUSTRATIVE_TARGETS;
        if (first === undefined || second === undefined || third === undefined) {
          throw new Error("fixture requires three targets");
        }
        const pills = screen.getByRole("group", { name: copy.targets });
        const pressed = (label: string) =>
          within(pills).getByRole("button", { name: label }).getAttribute("aria-pressed");

        expect(pressed(first.label)).toBe("true");
        act(() => {
          vi.advanceTimersByTime(4_300);
        });
        expect(pressed(second.label)).toBe("true");

        fireEvent.click(within(pills).getByRole("button", { name: third.label }));
        act(() => {
          vi.advanceTimersByTime(20_000);
        });
        expect(pressed(third.label)).toBe("true");
      } finally {
        vi.useRealTimers();
        vi.unstubAllGlobals();
      }
    });
  });
});
