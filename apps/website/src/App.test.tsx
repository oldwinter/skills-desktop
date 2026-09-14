// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.js";
import { COPY } from "./content/copy.js";
import { HARNESS_TOTAL } from "./content/harnesses.js";
import { ILLUSTRATIVE_TARGETS, targetById } from "./content/illustrative-inventory.js";

afterEach(cleanup);

describe("App", () => {
  it("renders the English landing page with document metadata", () => {
    render(<App initialLocale="en" />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "One inventory.Every harness.",
    );
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe(COPY.en.meta.title);
    expect(screen.getByText(COPY.en.harnesses.count(HARNESS_TOTAL))).toBeInTheDocument();
    expect(screen.getByText(COPY.en.harnesses.showAll(HARNESS_TOTAL))).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: COPY.en.inventory.screenshotAlt })).toHaveLength(1);
  });

  it("switches locale from the header and footer and reports the change", () => {
    const onLocaleChange = vi.fn();
    const description = document.createElement("meta");
    description.setAttribute("name", "description");
    document.head.append(description);

    render(<App initialLocale="en" onLocaleChange={onLocaleChange} />);

    fireEvent.click(screen.getByRole("button", { name: COPY.en.nav.switchLocaleLabel }));
    expect(onLocaleChange).toHaveBeenCalledWith("zh");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.title).toBe(COPY.zh.meta.title);
    expect(description.getAttribute("content")).toBe(COPY.zh.meta.description);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("一份清单。每个 harness。");

    const footer = screen.getByRole("contentinfo");
    fireEvent.click(within(footer).getByRole("button", { name: COPY.zh.nav.switchLocale }));
    expect(onLocaleChange).toHaveBeenLastCalledWith("en");
    expect(document.documentElement.lang).toBe("en");
    description.remove();
  });

  it("lights up the skills and harnesses of the selected Target in the hero figure", () => {
    render(<App initialLocale="en" />);
    const figure = COPY.en.hero.figure;
    const [first, second] = ILLUSTRATIVE_TARGETS;
    if (first === undefined || second === undefined) throw new Error("fixture requires two targets");

    const pills = screen.getByRole("group", { name: figure.targets });
    expect(within(pills).getByRole("button", { name: first.label })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByText(figure.summary(first.skills.length, first.harnesses.length)),
    ).toBeInTheDocument();

    fireEvent.click(within(pills).getByRole("button", { name: second.label }));

    const target = targetById(second.id);
    const inventory = screen.getByRole("list", { name: figure.inventory });
    const presentRows = within(inventory)
      .getAllByRole("listitem")
      .filter((row) => row.dataset.present === "true");
    expect(presentRows.map((row) => row.textContent)).toEqual(
      expect.arrayContaining(target.skills.map((skill) => expect.stringContaining(skill))),
    );
    expect(presentRows).toHaveLength(target.skills.length);

    const coverage = screen.getByRole("list", { name: figure.harnesses });
    const coveredRows = within(coverage)
      .getAllByRole("listitem")
      .filter((row) => row.dataset.covered === "true");
    expect(coveredRows).toHaveLength(target.harnesses.length);
    expect(screen.getByText(target.workspace)).toBeInTheDocument();
    expect(
      screen.getByText(figure.summary(target.skills.length, target.harnesses.length)),
    ).toBeInTheDocument();
  });

  it("marks project-only harnesses and links every download asset to the preview tag", () => {
    render(<App initialLocale="en" />);

    expect(screen.getAllByText(new RegExp(COPY.en.harnesses.projectOnly)).length).toBeGreaterThan(0);

    const download = screen.getByRole("link", { name: /Apple silicon/ });
    expect(download).toHaveAttribute(
      "href",
      expect.stringMatching(/releases\/download\/preview-v0\.1\.0-[a-f0-9]{40}\/skills-desktop-0\.1\.0-darwin-arm64\.dmg$/),
    );
    expect(screen.getAllByText(COPY.en.download.recommended)).toHaveLength(3);
  });
});
