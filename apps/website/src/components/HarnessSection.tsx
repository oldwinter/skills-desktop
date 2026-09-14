import type { ReactElement } from "react";

import type { Copy } from "../content/copy.js";
import {
  FEATURED_HARNESSES,
  HARNESS_REGISTRY_LABEL,
  HARNESS_TOTAL,
  REMAINING_HARNESSES,
  type HarnessCard,
} from "../content/harnesses.js";
import { SECTION_IDS } from "./SiteHeader.js";

function HarnessItem({
  harness,
  projectOnly,
}: {
  readonly harness: HarnessCard;
  readonly projectOnly: string;
}): ReactElement {
  return (
    <li className="herd__cell">
      <span aria-hidden="true" className="tile">
        {harness.initial}
      </span>
      <span className="herd__text">
        <span className="herd__name">{harness.name}</span>
        <code className="herd__id">
          --agent {harness.id}
          {harness.globalSupported ? null : <small> · {projectOnly}</small>}
        </code>
      </span>
    </li>
  );
}

export function HarnessSection({ copy }: { readonly copy: Copy }): ReactElement {
  const section = copy.harnesses;
  return (
    <section className="fig" data-reveal id={SECTION_IDS.harnesses}>
      <div className="fighd">
        <span>
          <i>FIG 2</i> {section.eyebrow}
        </span>
        <span className="r">{HARNESS_REGISTRY_LABEL}</span>
      </div>
      <div className="fig__split">
        <h2>{section.title}</h2>
        <p>{section.body}</p>
      </div>
      <div className="herd">
        <ul className="herd__grid" aria-label={section.eyebrow}>
          {FEATURED_HARNESSES.map((harness) => (
            <HarnessItem harness={harness} key={harness.id} projectOnly={section.projectOnly} />
          ))}
        </ul>
        <details className="herd__more">
          <summary>
            <span className="herd__more-all">{section.showAll(HARNESS_TOTAL)}</span>
            <span className="herd__more-fewer">{section.showFewer}</span>
            <b aria-hidden="true">+</b>
          </summary>
          <ul className="herd__grid">
            {REMAINING_HARNESSES.map((harness) => (
              <HarnessItem harness={harness} key={harness.id} projectOnly={section.projectOnly} />
            ))}
          </ul>
        </details>
        <div className="herd__foot">
          <span>{section.count(HARNESS_TOTAL)}</span>
          <span>{section.footnote}</span>
        </div>
      </div>
    </section>
  );
}
