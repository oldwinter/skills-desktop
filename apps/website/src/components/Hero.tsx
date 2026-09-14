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
      <div aria-hidden="true" className="hero__plane" />
      <div aria-hidden="true" className="hero__glow" />
      <div className="shell hero__inner">
        <p className="hero-meta eyebrow--mark rise">{copy.hero.eyebrow}</p>
        <h1 className="display-1 rise mt-7 text-balance">
          {firstLine}
          <br />
          {secondLine}
        </h1>
        <p className="lead rise mt-7 max-2xl" style={{ animationDelay: "80ms" }}>
          {copy.hero.lead}
        </p>
        <p className="prose-body rise mt-4 max-2xl" style={{ animationDelay: "110ms" }}>
          {copy.hero.definition}
        </p>
        <div className="hero__ctas rise mt-8" style={{ animationDelay: "140ms" }}>
          <a className="btn btn--primary" href={`#${SECTION_IDS.download}`}>
            <DownloadIcon />
            {copy.hero.download}
          </a>
          <a className="btn btn--secondary" href={REPOSITORY_URL} rel="noreferrer" target="_blank">
            <GitHubIcon />
            {copy.hero.viewSource}
          </a>
        </div>
        <p className="meta rise mt-4" style={{ animationDelay: "180ms" }}>
          {copy.hero.meta}
        </p>
        <HeroFigure copy={copy.hero.figure} />
      </div>
    </section>
  );
}
