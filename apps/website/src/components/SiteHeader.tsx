import { useEffect, useId, useRef, useState, type ReactElement } from "react";

import type { Copy } from "../content/copy.js";
import { REPOSITORY_URL } from "../content/downloads.js";
import { GitHubIcon, MenuIcon } from "./icons.js";

export interface SiteHeaderProps {
  readonly copy: Copy;
  readonly onToggleLocale: () => void;
}

export const SECTION_IDS = {
  cli: "cli",
  collections: "collections",
  compare: "compare",
  download: "download",
  harnesses: "harnesses",
  inventory: "inventory",
} as const;

const SECTION_ORDER = [
  SECTION_IDS.harnesses,
  SECTION_IDS.inventory,
  SECTION_IDS.compare,
  SECTION_IDS.collections,
  SECTION_IDS.cli,
] as const;

export function SiteHeader({ copy, onToggleLocale }: SiteHeaderProps): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (menuRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [menuOpen]);

  const sectionLinks = SECTION_ORDER.map((id) => ({
    href: `#${id}`,
    label:
      id === SECTION_IDS.harnesses
        ? copy.nav.harnesses
        : id === SECTION_IDS.inventory
          ? copy.nav.inventory
          : id === SECTION_IDS.compare
            ? copy.nav.compare
            : id === SECTION_IDS.collections
              ? copy.nav.collections
              : copy.nav.cli,
  }));

  return (
    <header className="site-header">
      <nav className="shell site-nav" aria-label="Primary">
        <a className="brand" href="#top">
          <img alt="" className="brand__icon" height={26} src="./icon.png" width={26} />
          <span className="display-3">Skills Desktop</span>
        </a>
        <ul className="site-nav__links">
          {sectionLinks.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>
        <div className="site-nav__actions">
          <div className="site-nav__menu" ref={menuRef}>
            <button
              aria-controls={menuId}
              aria-expanded={menuOpen}
              aria-haspopup="true"
              aria-label={menuOpen ? copy.nav.menuClose : undefined}
              className="site-nav__menu-button"
              onClick={() => {
                setMenuOpen((open) => !open);
              }}
              type="button"
            >
              <MenuIcon />
              <span>{copy.nav.menu}</span>
            </button>
            {menuOpen ? (
              <ul aria-label={copy.nav.menu} className="site-nav__menu-panel" id={menuId}>
                {sectionLinks.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      onClick={() => {
                        setMenuOpen(false);
                      }}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <button
            aria-label={copy.nav.switchLocaleLabel}
            className="locale-switch"
            onClick={onToggleLocale}
            type="button"
          >
            {copy.nav.switchLocale}
          </button>
          <a
            aria-label={copy.nav.github}
            className="github-link"
            href={REPOSITORY_URL}
            rel="noreferrer"
            target="_blank"
          >
            <GitHubIcon />
            <span>{copy.nav.github}</span>
          </a>
          <a className="btn btn--primary btn--compact" href={`#${SECTION_IDS.download}`}>
            {copy.nav.download}
          </a>
        </div>
      </nav>
    </header>
  );
}
