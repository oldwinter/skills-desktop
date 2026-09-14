import type { ReactElement } from "react";

import type { Bullet } from "../content/copy.js";

export function BulletList({
  bullets,
  grid = false,
}: {
  readonly bullets: readonly Bullet[];
  readonly grid?: boolean;
}): ReactElement {
  return (
    <ul className={grid ? "bullets bullets--grid" : "bullets"}>
      {bullets.map((bullet, index) => (
        <li className="bullet" data-reveal key={bullet.title} style={{ transitionDelay: `${index * 70}ms` }}>
          {grid ? <span className="bullet__index">{String(index + 1).padStart(2, "0")}</span> : null}
          <span className="bullet__title">{bullet.title}</span>
          <span className="bullet__body">{bullet.body}</span>
        </li>
      ))}
    </ul>
  );
}

export interface FeatureRowProps {
  readonly id?: string;
  readonly index: number;
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
  readonly bullets?: readonly Bullet[];
  readonly screenshot: string;
  readonly screenshotAlt: string;
}

/** One numbered row: index, copy and a real screenshot as the evidence panel. */
export function FeatureRow({
  body,
  bullets,
  eyebrow,
  id,
  index,
  screenshot,
  screenshotAlt,
  title,
}: FeatureRowProps): ReactElement {
  return (
    <section className="cap" data-reveal id={id}>
      <div className="cap__n" aria-hidden="true">
        <span>{String(index).padStart(2, "0")}</span>
      </div>
      <div className="cap__in">
        <p className="kicker">{eyebrow}</p>
        <h3>
          {title}
          <b aria-hidden="true" className="arw">
            →
          </b>
        </h3>
        <p>{body}</p>
        {bullets === undefined ? null : <BulletList bullets={bullets} />}
      </div>
      <figure className="cap__ev">
        <img alt={screenshotAlt} loading="lazy" src={screenshot} />
      </figure>
    </section>
  );
}
