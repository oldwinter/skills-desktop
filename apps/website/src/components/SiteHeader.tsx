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
      <nav className="nav" aria-label="Primary">
        <a className="lock" href="#top">
          <img alt="" className="lock__mark" height={26} src="./icon.png" width={26} />
          <b>Skills Desktop</b>
        </a>
        <span className="nav__space" />
        <ul className="nav__links">
          <li>
            <a className="lnk" href={`#${SECTION_IDS.harnesses}`}>
              {copy.nav.harnesses}
            </a>
          </li>
          <li>
            <a className="lnk" href={`#${SECTION_IDS.inventory}`}>
              {copy.nav.inventory}
            </a>
          </li>
          <li>
            <a className="lnk" href={`#${SECTION_IDS.compare}`}>
              {copy.nav.compare}
            </a>
          </li>
          <li>
            <a className="lnk" href={`#${SECTION_IDS.collections}`}>
              {copy.nav.collections}
            </a>
          </li>
          <li>
            <a className="lnk" href={`#${SECTION_IDS.cli}`}>
              {copy.nav.cli}
            </a>
          </li>
        </ul>
        <button
          aria-label={copy.nav.switchLocaleLabel}
          className="ico ico--text"
          onClick={onToggleLocale}
          type="button"
        >
          {copy.nav.switchLocale}
        </button>
        <a
          aria-label={copy.nav.github}
          className="ico"
          href={REPOSITORY_URL}
          rel="noreferrer"
          target="_blank"
        >
          <GitHubIcon />
        </a>
        <a className="btn" href={`#${SECTION_IDS.download}`}>
          {copy.nav.download}
        </a>
      </nav>
    </header>
  );
}
