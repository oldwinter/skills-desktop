import { useRef, type ReactElement } from "react";

import { PINNED_CLI_VERSION } from "../content/cli-examples.js";
import type { Copy } from "../content/copy.js";
import { DOWNLOAD_GROUPS, REPOSITORY_URL } from "../content/downloads.js";
import { HARNESS_TOTAL } from "../content/harnesses.js";
import { HeroFigure } from "./HeroFigure.js";
import { DownloadIcon, GitHubIcon } from "./icons.js";
import { useCountUp, useInView } from "./motion.js";
import { SECTION_IDS } from "./SiteHeader.js";

function Stat({
  label,
  live = false,
  value,
}: {
  readonly label: string;
  readonly live?: boolean;
  readonly value: string | number;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const counted = useCountUp(typeof value === "number" ? value : 0, inView);
  return (
    <div className="stat" ref={ref}>
      <b>{typeof value === "number" ? counted : value}</b>
      <span>
        {live ? <i aria-hidden="true" className="live" /> : null}
        {label}
      </span>
    </div>
  );
}

export function Hero({ copy }: { readonly copy: Copy }): ReactElement {
  const [firstLine, secondLine] = copy.hero.titleLines;
  return (
    <>
      <header className="hero" id="top">
        <div aria-hidden="true" className="hero__grid" />
        <div aria-hidden="true" className="hero__glow" />
        <div className="hero__in">
          <p className="eyebrow rise">
            <s aria-hidden="true" />
            {copy.hero.eyebrow}
          </p>
          <h1 className="rise" style={{ animationDelay: "60ms" }}>
            {firstLine}
            <br />
            <em>{secondLine}</em>
          </h1>
          <p className="lede rise" style={{ animationDelay: "140ms" }}>
            {copy.hero.lead}
          </p>
          <p className="lede lede--sub rise" style={{ animationDelay: "180ms" }}>
            {copy.hero.definition}
          </p>
          <div className="go rise" style={{ animationDelay: "240ms" }}>
            <a className="btn btn--solid" href={`#${SECTION_IDS.download}`}>
              <DownloadIcon />
              {copy.hero.download}
            </a>
            <a className="btn" href={REPOSITORY_URL} rel="noreferrer" target="_blank">
              <GitHubIcon />
              {copy.hero.viewSource}
            </a>
          </div>
          <p className="meta rise" style={{ animationDelay: "300ms" }}>
            {copy.hero.meta}
          </p>
        </div>
      </header>

      <div className="strip" data-reveal>
        <Stat label={copy.hero.stats.harnesses} value={HARNESS_TOTAL} />
        <Stat label={copy.hero.stats.cli} live value={`skills@${PINNED_CLI_VERSION}`} />
        <Stat label={copy.hero.stats.platforms} value={DOWNLOAD_GROUPS.length} />
        <Stat label={copy.hero.stats.telemetry} value={0} />
      </div>

      <HeroFigure copy={copy.hero.figure} />
    </>
  );
}
