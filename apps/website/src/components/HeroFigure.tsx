import { useState, type ReactElement } from "react";

import type { Copy } from "../content/copy.js";
import { tileLabel } from "../content/harnesses.js";
import {
  ILLUSTRATIVE_HARNESSES,
  ILLUSTRATIVE_SKILLS,
  ILLUSTRATIVE_TARGETS,
  targetById,
} from "../content/illustrative-inventory.js";

export interface HeroFigureProps {
  readonly copy: Copy["hero"]["figure"];
}

export function HeroFigure({ copy }: HeroFigureProps): ReactElement {
  const [selectedId, setSelectedId] = useState(ILLUSTRATIVE_TARGETS[0]?.id ?? "");
  const target = targetById(selectedId);
  const presentSkills = new Set(target.skills);
  const coveredHarnesses = new Set<string>(target.harnesses);

  return (
    <figure className="mt-12">
      <div className="paper-panel">
        <div className="figure-grid">
          <div className="figure-grid__column">
            <p className="eyebrow">{copy.inventory}</p>
            <p className="path mt-1">{copy.inventoryPath}</p>
            <ul className="figure-list" aria-label={copy.inventory}>
              {ILLUSTRATIVE_SKILLS.map((skill) => {
                const present = presentSkills.has(skill.name);
                return (
                  <li
                    className={present ? "figure-row" : "figure-row figure-row--dim"}
                    data-present={present}
                    key={skill.name}
                  >
                    <span className={present ? "dot dot--on" : "dot"} />
                    <span className="path">{skill.name}</span>
                    <span className="scope-tag">
                      {skill.scope === "global" ? copy.scopeGlobal : copy.scopeProject}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="target-pills">
            <p className="eyebrow">{copy.targets}</p>
            <div aria-label={copy.targets} className="pill-group" role="group">
              {ILLUSTRATIVE_TARGETS.map((candidate) => (
                <button
                  aria-pressed={candidate.id === target.id}
                  className="pill"
                  key={candidate.id}
                  onClick={() => setSelectedId(candidate.id)}
                  type="button"
                >
                  {candidate.label}
                </button>
              ))}
            </div>
            <p className="meta path" style={{ color: "var(--paper-ink-3)" }}>
              {target.workspace}
            </p>
            <p className="meta" style={{ color: "var(--paper-ink-3)" }}>
              {copy.targetsHint}
            </p>
          </div>

          <div className="figure-grid__column">
            <p className="eyebrow">{copy.harnesses}</p>
            <p className="path mt-1">{copy.harnessesPath}</p>
            <ul className="figure-list" aria-label={copy.harnesses}>
              {ILLUSTRATIVE_HARNESSES.map((harness) => {
                const covered = coveredHarnesses.has(harness.id);
                return (
                  <li
                    className={covered ? "figure-row" : "figure-row figure-row--dim"}
                    data-covered={covered}
                    key={harness.id}
                  >
                    <span aria-hidden="true" className="harness-tile harness-tile--paper">
                      {tileLabel(harness.label)}
                    </span>
                    <span className="path">{harness.path}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
        <div className="figure-footer">
          <span className="path">{copy.summary(target.skills.length, target.harnesses.length)}</span>
          <span className="fresh-badge">{copy.freshness}</span>
        </div>
      </div>
      <figcaption className="meta figure-caption text-balance">{copy.caption}</figcaption>
    </figure>
  );
}
