// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COPY } from "../content/copy.js";
import { SECTION_IDS, SiteHeader } from "./SiteHeader.js";

afterEach(cleanup);

describe("SiteHeader narrow menu", () => {
  it("opens five section anchors from the Menu button and closes on Escape", () => {
    render(<SiteHeader copy={COPY.en} onToggleLocale={vi.fn()} />);

    const menuButton = screen.getByRole("button", { name: COPY.en.nav.menu });
    expect(menuButton).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(menuButton);
    expect(menuButton).toHaveAttribute("aria-expanded", "true");
    expect(menuButton).toHaveAccessibleName(COPY.en.nav.menuClose);

    const panel = screen.getByRole("list", { name: COPY.en.nav.menu });
    expect(within(panel).getByRole("link", { name: COPY.en.nav.harnesses })).toHaveAttribute(
      "href",
      `#${SECTION_IDS.harnesses}`,
    );
    expect(within(panel).getByRole("link", { name: COPY.en.nav.inventory })).toHaveAttribute(
      "href",
      `#${SECTION_IDS.inventory}`,
    );
    expect(within(panel).getByRole("link", { name: COPY.en.nav.compare })).toHaveAttribute(
      "href",
      `#${SECTION_IDS.compare}`,
    );
    expect(within(panel).getByRole("link", { name: COPY.en.nav.collections })).toHaveAttribute(
      "href",
      `#${SECTION_IDS.collections}`,
    );
    expect(within(panel).getByRole("link", { name: COPY.en.nav.cli })).toHaveAttribute(
      "href",
      `#${SECTION_IDS.cli}`,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("list", { name: COPY.en.nav.menu })).not.toBeInTheDocument();
    expect(menuButton).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps language and Download outside the menu and closes after an anchor click", () => {
    render(<SiteHeader copy={COPY.zh} onToggleLocale={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: COPY.zh.nav.menu }));
    const panel = screen.getByRole("list", { name: COPY.zh.nav.menu });
    expect(within(panel).queryByRole("link", { name: COPY.zh.nav.download })).toBeNull();
    expect(within(panel).queryByRole("link", { name: COPY.zh.nav.github })).toBeNull();
    expect(screen.getByRole("button", { name: COPY.zh.nav.switchLocaleLabel })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: COPY.zh.nav.download })).toHaveAttribute(
      "href",
      `#${SECTION_IDS.download}`,
    );

    fireEvent.click(within(panel).getByRole("link", { name: COPY.zh.nav.compare }));
    expect(screen.queryByRole("list", { name: COPY.zh.nav.menu })).not.toBeInTheDocument();
  });
});
