import type { ReactElement } from "react";

import type { Copy } from "../content/copy.js";
import { ISSUES_URL, RELEASES_URL, REPOSITORY, REPOSITORY_URL } from "../content/downloads.js";
import { DOC_LINKS } from "../content/links.js";
import { SECTION_IDS } from "./SiteHeader.js";

export interface SiteFooterProps {
  readonly copy: Copy;
  readonly onToggleLocale: () => void;
}

const external = { rel: "noreferrer", target: "_blank" } as const;

export function SiteFooter({ copy, onToggleLocale }: SiteFooterProps): ReactElement {
  const footer = copy.footer;
  return (
    <footer className="site-footer">
      <div className="shell">
        <div className="footer-grid">
          <div>
            <div className="brand">
              <img alt="" className="brand__icon" height={26} src="./icon.png" width={26} />
              <span className="display-3">Skills Desktop</span>
            </div>
            <p className="prose-body mt-4" style={{ fontSize: "0.875rem", maxWidth: "20rem" }}>
              {footer.tagline}
            </p>
          </div>
          <div className="footer-columns">
            <div>
              <p className="eyebrow">{footer.product}</p>
              <ul>
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
                  <a href={`#${SECTION_IDS.download}`}>{copy.nav.download}</a>
                </li>
              </ul>
            </div>
            <div>
              <p className="eyebrow">{footer.source}</p>
              <ul>
                <li>
                  <a href={REPOSITORY_URL} {...external}>
                    GitHub
                  </a>
                </li>
                <li>
                  <a href={RELEASES_URL} {...external}>
                    {footer.links.releases}
                  </a>
                </li>
                <li>
                  <a href={ISSUES_URL} {...external}>
                    {footer.links.issues}
                  </a>
                </li>
                <li>
                  <a href={DOC_LINKS.changelog} {...external}>
                    {footer.links.changelog}
                  </a>
                </li>
                <li>
                  <a href={DOC_LINKS.contributing} {...external}>
                    {footer.links.contributing}
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <p className="eyebrow">{footer.docs}</p>
              <ul>
                <li>
                  <a href={DOC_LINKS.userGuide} {...external}>
                    {footer.links.userGuide}
                  </a>
                </li>
                <li>
                  <a href={DOC_LINKS.previewGuide} {...external}>
                    {footer.links.preview}
                  </a>
                </li>
                <li>
                  <a href={DOC_LINKS.context} {...external}>
                    {footer.links.context}
                  </a>
                </li>
                <li>
                  <a href={DOC_LINKS.adrs} {...external}>
                    {footer.links.adrs}
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <p className="meta">
            {footer.license} ·{" "}
            <a className="link-underline" href={REPOSITORY_URL} {...external}>
              github.com/{REPOSITORY}
            </a>
          </p>
          <div className="release-meta">
            <p className="meta">
              {footer.builtBy}{" "}
              <a className="link-underline" href="https://github.com/oldwinter" {...external}>
                @oldwinter
              </a>
            </p>
            <button className="meta link-underline locale-switch" onClick={onToggleLocale} type="button">
              {copy.nav.switchLocale}
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
