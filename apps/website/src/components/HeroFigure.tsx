import { useState, type ReactElement } from "react";

import type { Copy } from "../content/copy.js";
import { tileLabel } from "../content/harnesses.js";
import {
  ILLUSTRATIVE_HARNESSES,
  ILLUSTRATIVE_SKILLS,
  ILLUSTRATIVE_TARGETS,
  targetById,
} from "../content/illustrative-inventory.js";
import { CheckIcon } from "./icons.js";

export interface HeroFigureProps {
  readonly copy: Copy["hero"]["figure"];
}

export function HeroFigure({ copy }: HeroFigureProps): ReactElement {
  const [selectedId, setSelectedId] = useState(ILLUSTRATIVE_TARGETS[0]?.id ?? "");
  const target = targetById(selectedId);
  const presentSkills = new Set(target.skills);
  const coveredHarnesses = new Set<string>(target.harnesses);

  return (
    <figure aria-label={copy.example} className="hero-figure">
      <div className="paper-panel">
        <div className="figure-titlebar">
          <span className="figure-titlebar__brand">
            <img alt="" height={22} src="./icon.png" width={22} />
            Skills Desktop
          </span>
          <span className="figure-example">{copy.example}</span>
        </div>
        <div className="target-pills">
          <div className="target-pills__controls">
            <p className="figure-label">{copy.targets}</p>
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
          </div>
          <div className="target-pills__context">
            <p className="path">{target.workspace}</p>
            <p className="meta">{copy.targetsHint}</p>
          </div>
        </div>
        <div className="figure-grid">
          <div className="figure-grid__column">
            <p className="figure-label">{copy.inventory}</p>
            <p className="path figure-command">{copy.inventoryPath}</p>
            <ul className="figure-list" aria-label={copy.inventory}>
              {ILLUSTRATIVE_SKILLS.map((skill) => {
                const present = presentSkills.has(skill.name);
                return (
                  <li
                    className={present ? "figure-row" : "figure-row figure-row--dim"}
                    data-present={present}
                    key={skill.name}
                  >
                    <span aria-hidden="true" className={present ? "presence presence--on" : "presence"}>
                      {present ? <CheckIcon /> : null}
                    </span>
                    <span className="path">{skill.name}</span>
                    <span className="visually-hidden">{present ? copy.present : copy.absent}</span>
                    <span className="scope-tag">
                      {skill.scope === "global" ? copy.scopeGlobal : copy.scopeProject}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="figure-grid__column figure-grid__coverage">
            <p className="figure-label">{copy.harnesses}</p>
            <p className="path figure-command">{copy.harnessesPath}</p>
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
                    <span className="figure-harness">
                      <span className="figure-harness__name">{harness.label}</span>
                      <span className="path" title={harness.path}>{harness.path}</span>
                    </span>
                    <span className="visually-hidden">{covered ? copy.covered : copy.uncovered}</span>
                    {covered ? <CheckIcon /> : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
        <div className="figure-footer">
          <span aria-atomic="true" className="path" role="status">
            <span className="visually-hidden">{copy.example}, {target.label}: </span>
            {copy.summary(target.skills.length, target.harnesses.length)}
          </span>
          <span className="fresh-badge">{copy.freshness}</span>
        </div>
      </div>
      <figcaption className="meta figure-caption text-balance">{copy.caption}</figcaption>
    </figure>
  );
}
