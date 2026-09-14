import type { ReactElement } from "react";

import type { Bullet, FeatureCopy } from "../content/copy.js";

export function BulletList({
  bullets,
  grid = false,
}: {
  readonly bullets: readonly Bullet[];
  readonly grid?: boolean;
}): ReactElement {
  return (
    <ul className={grid ? "bullets bullets--grid" : "bullets"}>
      {bullets.map((bullet) => (
        <li className="bullet" key={bullet.title}>
          <span>
            <span className="bullet__title">{bullet.title}</span>
            <span className="bullet__body">{bullet.body}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface FeatureSectionProps {
  readonly id: string;
  readonly copy: FeatureCopy;
  readonly screenshot: string;
  readonly reverse?: boolean;
  readonly deep?: boolean;
}

/** Two-column feature band: text plus bullets on one side, a real screenshot on the other. */
export function FeatureSection({
  copy,
  deep = false,
  id,
  reverse = false,
  screenshot,
}: FeatureSectionProps): ReactElement {
  const layout = ["split--media", reverse ? "split--reverse" : ""].filter(Boolean).join(" ");
  return (
    <section className={deep ? "band band--deep" : "band"} id={id}>
      <div className="shell">
        <div className={layout}>
          <div className="split__text">
            <p className="eyebrow eyebrow--mark">{copy.eyebrow}</p>
            <h2 className="display-2 mt-5 text-balance">{copy.title}</h2>
            <p className="prose-body mt-5">{copy.body}</p>
            <BulletList bullets={copy.bullets} />
          </div>
          <div className="split__media">
            <figure className="screenshot">
              <img alt={copy.screenshotAlt} loading="lazy" src={screenshot} />
            </figure>
          </div>
        </div>
      </div>
    </section>
  );
}

export interface WideSectionProps {
  readonly id?: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
  readonly screenshot: string;
  readonly screenshotAlt: string;
}

/** Heading and body side by side, then one wide screenshot underneath. */
export function WideSection({
  body,
  eyebrow,
  id,
  screenshot,
  screenshotAlt,
  title,
}: WideSectionProps): ReactElement {
  return (
    <section className="band" id={id}>
      <div className="shell">
        <div className="split">
          <div>
            <p className="eyebrow eyebrow--mark">{eyebrow}</p>
            <h2 className="display-2 mt-5 text-balance">{title}</h2>
          </div>
          <p className="prose-body split__aside">{body}</p>
        </div>
        <figure className="screenshot mt-12">
          <img alt={screenshotAlt} loading="lazy" src={screenshot} />
        </figure>
      </div>
    </section>
  );
}
