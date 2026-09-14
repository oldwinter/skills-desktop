import type { ReactElement } from "react";

import type { Copy } from "../content/copy.js";
import { BulletList } from "./FeatureSection.js";

export function SafetySection({ copy }: { readonly copy: Copy }): ReactElement {
  const section = copy.safety;
  return (
    <section className="band band--deep" id="safety">
      <div className="shell">
        <div className="split">
          <div>
            <p className="eyebrow eyebrow--mark">{section.eyebrow}</p>
            <h2 className="display-2 mt-5 text-balance">{section.title}</h2>
          </div>
          <p className="prose-body split__aside">{section.body}</p>
        </div>
        <BulletList bullets={section.bullets} grid />
      </div>
    </section>
  );
}
