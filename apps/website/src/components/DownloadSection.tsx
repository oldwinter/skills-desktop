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

export function DownloadSection({ copy }: { readonly copy: Copy }): ReactElement {
  const section = copy.download;
  return (
    <section className="band band--deep" id={SECTION_IDS.download}>
      <div className="shell">
        <div className="split">
          <div>
            <p className="eyebrow eyebrow--mark">{section.eyebrow}</p>
            <h2 className="display-2 mt-5 text-balance">{section.title}</h2>
          </div>
          <div className="split__aside">
            <p className="prose-body">{section.body}</p>
            <p className="meta release-meta mt-4">
              <a className="path link-underline" href={PREVIEW_URL} rel="noreferrer" target="_blank">
                {section.latest(PREVIEW_VERSION)}
              </a>
              <a className="link-underline" href={RELEASES_URL} rel="noreferrer" target="_blank">
                {section.allReleases} <ExternalIcon />
              </a>
              <a className="link-underline" href={DOC_LINKS.previewGuide} rel="noreferrer" target="_blank">
                {section.guide} <ExternalIcon />
              </a>
            </p>
          </div>
        </div>

        <div className="download-grid">
          {DOWNLOAD_GROUPS.map((group) => {
            const platform = section.platforms[group.platform];
            return (
              <div className="card download-card" key={group.platform}>
                <h3 className="display-3">{platform.title}</h3>
                <p className="meta mt-1">{platform.requirement}</p>
                <ul className="download-list">
                  {group.assets.map((asset) => (
                    <li key={asset.fileName}>
                      <a className="download-link" href={assetUrl(asset.fileName)}>
                        <FileIcon />
                        <span className="download-link__name">
                          {section.assets[asset.labelKey] ?? asset.fileName}
                        </span>
                        {asset.recommended ? <span className="badge">{section.recommended}</span> : null}
                        <span className="meta tabular download-link__size">
                          {formatMegabytes(asset.bytes)}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="card verify-card">
          <span className="display-3">{section.verifyTitle}</span>
          <span className="meta">{section.verifyBody}</span>
          <code className="path">sha256sum -c {CHECKSUMS_FILE} --ignore-missing</code>
        </div>
      </div>
    </section>
  );
}
