import type { ReactElement } from "react";

import type { Copy } from "../content/copy.js";
import {
  CHECKSUMS_FILE,
  DOWNLOAD_GROUPS,
  PREVIEW_URL,
  PREVIEW_VERSION,
  RELEASES_URL,
  assetUrl,
  formatMegabytes,
} from "../content/downloads.js";
import { DOC_LINKS } from "../content/links.js";
import { ExternalIcon, FileIcon } from "./icons.js";
import { SECTION_IDS } from "./SiteHeader.js";

const external = { rel: "noreferrer", target: "_blank" } as const;

export function DownloadSection({ copy }: { readonly copy: Copy }): ReactElement {
  const section = copy.download;
  return (
    <section className="end" id={SECTION_IDS.download}>
      <span aria-hidden="true" className="end__ghost" />
      <div className="end__in" data-reveal>
        <p className="eyebrow">
          <s aria-hidden="true" />
          {section.eyebrow}
        </p>
        <h2>{section.title}</h2>
        <p className="end__lede">{section.body}</p>
        <p className="meta end__meta">
          <a href={PREVIEW_URL} {...external}>
            {section.latest(PREVIEW_VERSION)}
          </a>
          <a href={RELEASES_URL} {...external}>
            {section.allReleases} <ExternalIcon />
          </a>
          <a href={DOC_LINKS.previewGuide} {...external}>
            {section.guide} <ExternalIcon />
          </a>
        </p>
      </div>

      <div className="dl" data-reveal>
        {DOWNLOAD_GROUPS.map((group) => {
          const platform = section.platforms[group.platform];
          return (
            <div className="dl__col" key={group.platform}>
              <header className="dl__head">
                <h3>{platform.title}</h3>
                <span>{platform.requirement}</span>
              </header>
              <ul className="dl__list">
                {group.assets.map((asset) => (
                  <li key={asset.fileName}>
                    <a className="dl__link" href={assetUrl(asset.fileName)}>
                      <FileIcon />
                      <span className="dl__name">
                        {section.assets[asset.labelKey] ?? asset.fileName}
                      </span>
                      {asset.recommended ? <span className="tag">{section.recommended}</span> : null}
                      <span className="dl__size">{formatMegabytes(asset.bytes)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="verify" data-reveal>
        <b>{section.verifyTitle}</b>
        <span>{section.verifyBody}</span>
        <code>
          <i>$</i>sha256sum -c {CHECKSUMS_FILE} --ignore-missing
        </code>
      </div>
    </section>
  );
}
