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

export function FeatureSection({
  copy,
  deep = false,
  id,
  reverse = false,
  screenshot,
}: FeatureSectionProps): ReactElement {
  const layout = ["split--media", reverse ? "split--reverse" : ""].filter(Boolean).join(" ");
  return (
    <section className={`band feature-band${deep ? " band--deep" : ""}`} id={id}>
      <div className="shell">
        <div className={layout}>
          <div className="split__text">
            <h2 className="display-2 text-balance">{copy.title}</h2>
            <p className="prose-body mt-5">{copy.body}</p>
          </div>
          <div className="split__media">
            <figure className="screenshot">
              <img alt={copy.screenshotAlt} height={800} loading="lazy" src={screenshot} width={1280} />
            </figure>
            <p className="media-label">{copy.eyebrow}</p>
          </div>
        </div>
        <BulletList bullets={copy.bullets} grid />
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

/** Mutation walkthrough with a larger, uncropped product view. */
export function WideSection({
  body,
  eyebrow,
  id,
  screenshot,
  screenshotAlt,
  title,
}: WideSectionProps): ReactElement {
  return (
    <section className="band mutation-band" id={id}>
      <div className="shell">
        <div className="split--media">
          <div className="split__text">
            <h2 className="display-2 text-balance">{title}</h2>
            <p className="prose-body mt-5">{body}</p>
          </div>
          <div className="split__media">
            <figure className="screenshot">
              <img alt={screenshotAlt} height={800} loading="lazy" src={screenshot} width={1280} />
            </figure>
            <p className="media-label">{eyebrow}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
