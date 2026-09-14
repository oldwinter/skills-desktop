import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";

import type { Copy } from "../content/copy.js";
import { tileLabel } from "../content/harnesses.js";
import {
  ILLUSTRATIVE_HARNESSES,
  ILLUSTRATIVE_SKILLS,
  ILLUSTRATIVE_TARGETS,
  targetById,
} from "../content/illustrative-inventory.js";
import { prefersReducedMotion } from "./motion.js";

export interface HeroFigureProps {
  readonly copy: Copy["hero"]["figure"];
}

interface Wire {
  readonly id: string;
  readonly d: string;
  /** Wires fan out from the Target in two directions; the dot travels in reading order. */
  readonly side: "skill" | "harness";
}

const AUTO_ADVANCE_MS = 4200;

function curve(x1: number, y1: number, x2: number, y2: number): string {
  const bend = (x2 - x1) / 2;
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

function slug(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

export function HeroFigure({ copy }: HeroFigureProps): ReactElement {
  const [selectedId, setSelectedId] = useState(ILLUSTRATIVE_TARGETS[0]?.id ?? "");
  const [autoplay, setAutoplay] = useState(true);
  const [paused, setPaused] = useState(false);
  const [wires, setWires] = useState<readonly Wire[]>([]);
  const target = targetById(selectedId);
  const presentSkills = new Set(target.skills);
  const coveredHarnesses = new Set<string>(target.harnesses);

  const gridRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const anchors = useRef(new Map<string, HTMLElement>());
  const anchor = useCallback(
    (key: string) => (element: HTMLElement | null) => {
      if (element === null) anchors.current.delete(key);
      else anchors.current.set(key, element);
    },
    [],
  );

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (grid === null) return;

    const measure = () => {
      const box = grid.getBoundingClientRect();
      const pill = anchors.current.get(`target:${target.id}`);
      if (box.width === 0 || pill === undefined) {
        setWires([]);
        return;
      }
      const hub = pill.getBoundingClientRect();
      const hubY = hub.top + hub.height / 2 - box.top;
      const next: Wire[] = [];
      for (const skill of target.skills) {
        const row = anchors.current.get(`skill:${skill}`);
        if (row === undefined) continue;
        const rect = row.getBoundingClientRect();
        next.push({
          d: curve(
            rect.right - box.left,
            rect.top + rect.height / 2 - box.top,
            hub.left - box.left,
            hubY,
          ),
          id: `skill-${slug(skill)}`,
          side: "skill",
        });
      }
      for (const harness of target.harnesses) {
        const row = anchors.current.get(`harness:${harness}`);
        if (row === undefined) continue;
        const rect = row.getBoundingClientRect();
        next.push({
          d: curve(
            hub.right - box.left,
            hubY,
            rect.left - box.left,
            rect.top + rect.height / 2 - box.top,
          ),
          id: `harness-${slug(harness)}`,
          side: "harness",
        });
      }
      setWires(next);
    };

    measure();
    if (typeof document !== "undefined" && "fonts" in document) {
      void document.fonts.ready.then(measure);
    }
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [target]);

  // Draw each wire from its skill/harness end with a real path length; CSS `pathLength`
  // scaling is not reliable across engines, so the dash is measured here instead.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return;
    const reduced = prefersReducedMotion();
    svg.querySelectorAll<SVGPathElement>("path.wire__path").forEach((path, index) => {
      if (path.dataset.drawn !== undefined) return;
      path.dataset.drawn = "";
      if (
        reduced ||
        typeof path.getTotalLength !== "function" ||
        typeof path.animate !== "function"
      ) {
        return;
      }
      const length = path.getTotalLength();
      path.style.strokeDasharray = `${length}`;
      path.style.strokeDashoffset = `${length}`;
      const drawing = path.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], {
        delay: index * 45,
        duration: 800,
        easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
        fill: "forwards",
      });
      drawing.onfinish = () => {
        path.style.strokeDasharray = "";
        path.style.strokeDashoffset = "";
        drawing.cancel();
      };
    });
  }, [wires]);

  useEffect(() => {
    if (!autoplay || paused || prefersReducedMotion()) return;
    const timer = setInterval(() => {
      setSelectedId((current) => {
        const index = ILLUSTRATIVE_TARGETS.findIndex((candidate) => candidate.id === current);
        const next = ILLUSTRATIVE_TARGETS[(index + 1) % ILLUSTRATIVE_TARGETS.length];
        return next?.id ?? current;
      });
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [autoplay, paused]);

  const choose = (id: string) => {
    setAutoplay(false);
    setSelectedId(id);
  };

  return (
    <figure className="fig" data-reveal>
      <div className="fighd">
        <span>
          <i>FIG 1</i> {copy.label}
        </span>
        <span className="r">{copy.targetsHint}</span>
      </div>
      <div
        className="plate"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
        }}
        onFocus={() => setPaused(true)}
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
      >
        <div className="wire" data-target={target.id} ref={gridRef}>
          <svg aria-hidden="true" className="wire__svg" ref={svgRef}>
            {wires.map((wire, index) => {
              const pathId = `wire-${target.id}-${wire.id}`;
              return (
                <g key={pathId}>
                  <path className="wire__path" d={wire.d} id={pathId} />
                  <circle className="wire__dot" r={2.5}>
                    <animateMotion
                      begin={`${(wire.side === "skill" ? 0.6 : 1.4) + index * 0.12}s`}
                      dur="2.4s"
                      repeatCount="indefinite"
                    >
                      <mpath href={`#${pathId}`} />
                    </animateMotion>
                  </circle>
                </g>
              );
            })}
          </svg>

          <div className="wire__col wire__col--skills">
            <header className="wire__head">
              <span>{copy.inventory}</span>
              <code>{copy.inventoryPath}</code>
            </header>
            <ul className="wire__list" aria-label={copy.inventory}>
              {ILLUSTRATIVE_SKILLS.map((skill, index) => {
                const present = presentSkills.has(skill.name);
                return (
                  <li
                    className="wire__row"
                    data-present={present}
                    key={skill.name}
                    ref={anchor(`skill:${skill.name}`)}
                    style={{ "--i": index } as CSSProperties}
                  >
                    <i aria-hidden="true" className="wire__mark" />
                    <code className="wire__name">{skill.name}</code>
                    <span className="wire__scope">
                      {skill.scope === "global" ? copy.scopeGlobal : copy.scopeProject}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="wire__col wire__col--targets">
            <header className="wire__head">
              <span>{copy.targets}</span>
              <code>{target.workspace}</code>
            </header>
            <div aria-label={copy.targets} className="wire__targets" role="group">
              {ILLUSTRATIVE_TARGETS.map((candidate) => {
                const active = candidate.id === target.id;
                return (
                  <button
                    aria-pressed={active}
                    className="pill"
                    key={candidate.id}
                    onClick={() => choose(candidate.id)}
                    ref={anchor(`target:${candidate.id}`)}
                    type="button"
                  >
                    <i aria-hidden="true" className="pill__port pill__port--in" />
                    <span className="pill__label">{candidate.label}</span>
                    <span aria-hidden="true" className="pill__count">
                      {candidate.skills.length}·{candidate.harnesses.length}
                    </span>
                    <i aria-hidden="true" className="pill__port pill__port--out" />
                  </button>
                );
              })}
            </div>
            {autoplay ? (
              <span
                aria-hidden="true"
                className={paused ? "wire__auto wire__auto--paused" : "wire__auto"}
                key={`${target.id}-${paused}`}
              />
            ) : null}
          </div>

          <div className="wire__col wire__col--harnesses">
            <header className="wire__head">
              <span>{copy.harnesses}</span>
              <code>{copy.harnessesPath}</code>
            </header>
            <ul className="wire__list" aria-label={copy.harnesses}>
              {ILLUSTRATIVE_HARNESSES.map((harness, index) => {
                const covered = coveredHarnesses.has(harness.id);
                return (
                  <li
                    className="wire__row"
                    data-covered={covered}
                    key={harness.id}
                    ref={anchor(`harness:${harness.id}`)}
                    style={{ "--i": index } as CSSProperties}
                  >
                    <span aria-hidden="true" className="tile">
                      {tileLabel(harness.label)}
                    </span>
                    <code className="wire__name">{harness.path}</code>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="wire__foot">
          <code key={`${target.skills.length}-${target.harnesses.length}`} className="wire__sum">
            {copy.summary(target.skills.length, target.harnesses.length)}
          </code>
          <span className="fresh">
            <i aria-hidden="true" className="live" />
            {copy.freshness}
          </span>
        </div>
      </div>
      <p className="figcap">{copy.caption}</p>
    </figure>
  );
}
