import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";

import {
  CLI_EXAMPLES,
  PINNED_CLI_VERSION,
  formatArgumentArray,
  formatPreview,
  type CliExampleId,
} from "../content/cli-examples.js";
import type { Copy } from "../content/copy.js";
import { SECTION_IDS } from "./SiteHeader.js";

export interface CliSectionProps {
  readonly copy: Copy;
  readonly writeClipboard?: (text: string) => Promise<void>;
}

const defaultWriteClipboard = (text: string) => navigator.clipboard.writeText(text);

export function CliSection({
  copy,
  writeClipboard = defaultWriteClipboard,
}: CliSectionProps): ReactElement {
  const section = copy.cli;
  const [activeId, setActiveId] = useState<CliExampleId>("verify");
  const [copiedId, setCopiedId] = useState<CliExampleId | null>(null);
  const copied = copiedId === activeId;
  const tabRefs = useRef(new Map<CliExampleId, HTMLButtonElement>());
  const active = CLI_EXAMPLES.find((example) => example.id === activeId) ?? CLI_EXAMPLES[0];

  useEffect(() => {
    if (copiedId === null) return;
    const timer = setTimeout(() => setCopiedId(null), 1600);
    return () => clearTimeout(timer);
  }, [copiedId]);

  if (active === undefined) {
    throw new Error("CLI examples must not be empty.");
  }

  const argumentArray = formatArgumentArray(active.args);
  const preview = formatPreview(active.args);

  const selectTab = (id: CliExampleId) => {
    setActiveId(id);
    setCopiedId(null);
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = CLI_EXAMPLES.findIndex((example) => example.id === activeId);
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = (index + 1) % CLI_EXAMPLES.length;
        break;
      case "ArrowLeft":
        nextIndex = (index - 1 + CLI_EXAMPLES.length) % CLI_EXAMPLES.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = CLI_EXAMPLES.length - 1;
        break;
      default:
        return;
    }
    const next = CLI_EXAMPLES[nextIndex];
    if (next === undefined) return;
    event.preventDefault();
    selectTab(next.id);
    tabRefs.current.get(next.id)?.focus();
  };

  const copyArguments = async () => {
    try {
      await writeClipboard(argumentArray);
      setCopiedId(activeId);
    } catch {
      setCopiedId(null);
    }
  };

  return (
    <section className="band band--paper" id={SECTION_IDS.cli}>
      <div className="shell cli-layout">
        <div className="cli-intro">
          <h2 className="display-2 text-balance">{section.title}</h2>
          <p className="prose-body mt-5">{section.body}</p>
          <p className="meta mt-5">
            {section.footnote} <span className="path">skills@{PINNED_CLI_VERSION}</span>
          </p>
        </div>

        <div className="terminal">
          <div className="terminal__header">
            <span>{section.eyebrow}</span>
            <button className="terminal__copy" onClick={copyArguments} type="button">
              {copied ? section.copied : section.copy}
            </button>
          </div>
          <div className="terminal__tabs" role="tablist" aria-label={section.eyebrow}>
            {CLI_EXAMPLES.map((example) => (
              <button
                aria-selected={example.id === active.id}
                aria-controls="cli-example-panel"
                className="terminal__tab"
                id={`cli-tab-${example.id}`}
                key={example.id}
                onClick={() => selectTab(example.id)}
                onKeyDown={onTabKeyDown}
                ref={(element) => {
                  if (element) tabRefs.current.set(example.id, element);
                  else tabRefs.current.delete(example.id);
                }}
                role="tab"
                tabIndex={example.id === active.id ? 0 : -1}
                type="button"
              >
                {section.tabs[example.id]}
              </button>
            ))}
          </div>
          <div
            aria-labelledby={`cli-tab-${active.id}`}
            className="terminal__body"
            id="cli-example-panel"
            role="tabpanel"
            tabIndex={0}
          >
            <pre>
              <code>
                <span className="terminal__comment">{section.comments[active.id]}</span>
                <span className="terminal__label">{section.argumentArray}</span>
                <span className="terminal__array" data-testid="cli-argument-array">
                  {argumentArray}
                </span>
                <span className="terminal__label">{section.preview}</span>
                <span className="terminal__line">
                  <span className="terminal__prompt">$ </span>
                  {preview}
                </span>
              </code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
