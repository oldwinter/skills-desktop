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
    <li className="harness-item">
      <span aria-hidden="true" className="harness-tile harness-tile--dark">
        {harness.initial}
      </span>
      <span className="harness-item__text">
        <span className="harness-item__name">{harness.name}</span>
        <span className="harness-item__id">
          --agent {harness.id}
          {harness.globalSupported ? null : <small> · {projectOnly}</small>}
        </span>
      </span>
    </li>
  );
}

export function HarnessSection({ copy }: { readonly copy: Copy }): ReactElement {
  const section = copy.harnesses;
  return (
    <section className="band" id={SECTION_IDS.harnesses}>
      <div className="shell">
        <div className="split">
          <div>
            <p className="eyebrow eyebrow--mark">{section.eyebrow}</p>
            <h2 className="display-2 mt-5 text-balance">{section.title}</h2>
          </div>
          <p className="prose-body split__aside">{section.body}</p>
        </div>
        <div className="card harness-card mt-12">
          <ul className="harness-grid" aria-label={section.eyebrow}>
            {FEATURED_HARNESSES.map((harness) => (
              <HarnessItem harness={harness} key={harness.id} projectOnly={section.projectOnly} />
            ))}
          </ul>
          <details className="details-toggle">
            <summary className="link-underline">
              <span className="details-toggle__all">{section.showAll(HARNESS_TOTAL)}</span>
              <span className="details-toggle__fewer">{section.showFewer}</span>
            </summary>
            <ul className="harness-grid">
              {REMAINING_HARNESSES.map((harness) => (
                <HarnessItem harness={harness} key={harness.id} projectOnly={section.projectOnly} />
              ))}
            </ul>
          </details>
          <div className="harness-footer">
            <p className="harness-footer__count">
              <span className="tabular">{section.count(HARNESS_TOTAL)}</span>
              <span className="meta"> · {HARNESS_REGISTRY_LABEL}</span>
            </p>
            <p className="meta">{section.footnote}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
