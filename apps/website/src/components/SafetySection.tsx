import type { ReactElement } from "react";

import type { Copy } from "../content/copy.js";
import { BulletList } from "./FeatureSection.js";

export function SafetySection({ copy }: { readonly copy: Copy }): ReactElement {
  const section = copy.safety;
  return (
    <section className="fig fig--safety" data-reveal id="safety">
      <div className="fighd">
        <span>
          <i>FIG 3</i> {section.eyebrow}
        </span>
        <span className="r">Prepare → Command Plan → Trusted Review → execute</span>
      </div>
      <div className="fig__split">
        <h2>{section.title}</h2>
        <p>{section.body}</p>
      </div>
      <BulletList bullets={section.bullets} grid />
    </section>
  );
}
