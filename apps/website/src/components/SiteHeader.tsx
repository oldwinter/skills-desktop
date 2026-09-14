import type { ReactElement } from "react";

import type { Copy } from "../content/copy.js";
import { REPOSITORY_URL } from "../content/downloads.js";
import { GitHubIcon } from "./icons.js";

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

export function SiteHeader({ copy, onToggleLocale }: SiteHeaderProps): ReactElement {
  return (
    <header className="site-header">
      <nav className="shell site-nav" aria-label="Primary">
        <a className="brand" href="#top">
          <img alt="" className="brand__icon" height={26} src="./icon.png" width={26} />
          <span className="display-3">Skills Desktop</span>
        </a>
        <ul className="site-nav__links">
          <li>
            <a href={`#${SECTION_IDS.harnesses}`}>{copy.nav.harnesses}</a>
          </li>
          <li>
            <a href={`#${SECTION_IDS.inventory}`}>{copy.nav.inventory}</a>
          </li>
          <li>
            <a href={`#${SECTION_IDS.compare}`}>{copy.nav.compare}</a>
          </li>
          <li>
            <a href={`#${SECTION_IDS.collections}`}>{copy.nav.collections}</a>
          </li>
          <li>
            <a href={`#${SECTION_IDS.cli}`}>{copy.nav.cli}</a>
          </li>
        </ul>
        <div className="site-nav__actions">
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
