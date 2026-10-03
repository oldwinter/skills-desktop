import type { ReactElement } from "react";

import type { Copy } from "../content/copy.js";
import { REPOSITORY_URL } from "../content/downloads.js";
import { HeroFigure } from "./HeroFigure.js";
import { DownloadIcon, GitHubIcon } from "./icons.js";
import { SECTION_IDS } from "./SiteHeader.js";

export function Hero({ copy }: { readonly copy: Copy }): ReactElement {
  const [firstLine, secondLine] = copy.hero.titleLines;
  return (
    <section className="hero" id="top">
      <div className="shell hero__inner">
        <div className="hero__copy">
          <h1 className="display-1">
            {firstLine}
            <br />
            <span>{secondLine}</span>
          </h1>
          <p className="lead">{copy.hero.lead}</p>
          <div className="hero__ctas">
            <a className="btn btn--primary" href={`#${SECTION_IDS.download}`}>
              <DownloadIcon />
              {copy.hero.download}
            </a>
            <a className="btn btn--secondary" href={REPOSITORY_URL} rel="noreferrer" target="_blank">
              <GitHubIcon />
              {copy.hero.viewSource}
            </a>
          </div>
          <p className="hero__boundary">{copy.hero.meta}</p>
          <p className="hero-meta">{copy.hero.eyebrow}</p>
          <p className="hero__definition">{copy.hero.definition}</p>
        </div>
        <HeroFigure copy={copy.hero.figure} />
      </div>
    </section>
  );
}
