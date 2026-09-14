import { useEffect, useState, type ReactElement } from "react";

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
  const [copied, setCopied] = useState(false);
  const active = CLI_EXAMPLES.find((example) => example.id === activeId) ?? CLI_EXAMPLES[0];

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  if (active === undefined) {
    throw new Error("CLI examples must not be empty.");
  }

  const argumentArray = formatArgumentArray(active.args);
  const preview = formatPreview(active.args);

  const copyArguments = async () => {
    try {
      await writeClipboard(argumentArray);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="band band--paper" id={SECTION_IDS.cli}>
      <div className="shell">
        <p className="eyebrow eyebrow--mark">{section.eyebrow}</p>
        <h2 className="display-2 mt-5 max-2xl text-balance">{section.title}</h2>
        <p className="prose-body mt-5 max-2xl">{section.body}</p>

        <div className="terminal">
          <div className="terminal__tabs" role="tablist" aria-label={section.eyebrow}>
            {CLI_EXAMPLES.map((example) => (
              <button
                aria-selected={example.id === active.id}
                className="terminal__tab"
                id={`cli-tab-${example.id}`}
                key={example.id}
                onClick={() => setActiveId(example.id)}
                role="tab"
                type="button"
              >
                {section.tabs[example.id]}
              </button>
            ))}
            <button className="terminal__copy" onClick={copyArguments} type="button">
              {copied ? section.copied : section.copy}
            </button>
          </div>
          <div
            aria-labelledby={`cli-tab-${active.id}`}
            className="terminal__body"
            role="tabpanel"
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
        <p className="meta mt-5">
          {section.footnote} <span className="path">skills@{PINNED_CLI_VERSION}</span>
        </p>
      </div>
    </section>
  );
}
