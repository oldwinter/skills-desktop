import type { ReactElement } from "react";

import type { Copy } from "../content/copy.js";
import { ISSUES_URL, RELEASES_URL, REPOSITORY, REPOSITORY_URL } from "../content/downloads.js";
import { DOC_LINKS } from "../content/links.js";
import { GitHubIcon } from "./icons.js";

export interface SiteFooterProps {
  readonly copy: Copy;
  readonly onToggleLocale: () => void;
}

const external = { rel: "noreferrer", target: "_blank" } as const;

export function SiteFooter({ copy, onToggleLocale }: SiteFooterProps): ReactElement {
  const footer = copy.footer;
  return (
    <footer className="foot">
      <p className="foot__tagline">
        <img alt="" height={15} src="./icon.png" width={15} />
        {footer.tagline}
      </p>
      <nav className="foot__links" aria-label="Footer">
        <a href={DOC_LINKS.userGuide} {...external}>
          {footer.links.userGuide}
        </a>
        <a href={DOC_LINKS.previewGuide} {...external}>
          {footer.links.preview}
        </a>
        <a href={DOC_LINKS.context} {...external}>
          {footer.links.context}
        </a>
        <a href={DOC_LINKS.adrs} {...external}>
          {footer.links.adrs}
        </a>
        <a href={DOC_LINKS.changelog} {...external}>
          {footer.links.changelog}
        </a>
        <a href={DOC_LINKS.contributing} {...external}>
          {footer.links.contributing}
        </a>
        <a href={RELEASES_URL} {...external}>
          {footer.links.releases}
        </a>
        <a href={ISSUES_URL} {...external}>
          {footer.links.issues}
        </a>
      </nav>
      <div className="foot__out">
        <span className="foot__fact">
          {footer.license} · {footer.builtBy}{" "}
          <a href="https://github.com/oldwinter" {...external}>
            @oldwinter
          </a>
        </span>
        <button className="foot__locale" onClick={onToggleLocale} type="button">
          {copy.nav.switchLocale}
        </button>
        <a aria-label={`github.com/${REPOSITORY}`} className="foot__ico" href={REPOSITORY_URL} {...external}>
          <GitHubIcon />
        </a>
      </div>
    </footer>
  );
}
