import { useEffect, useState, type ReactElement } from "react";

import { CliSection } from "./components/CliSection.js";
import { DownloadSection } from "./components/DownloadSection.js";
import { FeatureRow } from "./components/FeatureSection.js";
import { HarnessSection } from "./components/HarnessSection.js";
import { Hero } from "./components/Hero.js";
import { useRevealOnScroll } from "./components/motion.js";
import { SafetySection } from "./components/SafetySection.js";
import { SiteFooter } from "./components/SiteFooter.js";
import { SECTION_IDS, SiteHeader } from "./components/SiteHeader.js";
import { COPY } from "./content/copy.js";
import { htmlLangFor, otherLocale, type Locale } from "./content/locale.js";
import { SCREENSHOTS } from "./content/screenshots.js";

export interface AppProps {
  readonly initialLocale: Locale;
  readonly onLocaleChange?: (locale: Locale) => void;
}

export function App({ initialLocale, onLocaleChange }: AppProps): ReactElement {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const copy = COPY[locale];

  useEffect(() => {
    document.documentElement.lang = htmlLangFor(locale);
    document.title = copy.meta.title;
    document
      .querySelector<HTMLMetaElement>('meta[name="description"]')
      ?.setAttribute("content", copy.meta.description);
  }, [copy.meta.description, copy.meta.title, locale]);

  useRevealOnScroll(locale);

  const toggleLocale = () => {
    const next = otherLocale(locale);
    setLocale(next);
    onLocaleChange?.(next);
  };

  return (
    <div className="frame">
      <SiteHeader copy={copy} onToggleLocale={toggleLocale} />
      <main>
        <Hero copy={copy} />
        <div className="caps">
          <FeatureRow
            body={copy.inventory.body}
            bullets={copy.inventory.bullets}
            eyebrow={copy.inventory.eyebrow}
            id={SECTION_IDS.inventory}
            index={1}
            screenshot={SCREENSHOTS.inventory}
            screenshotAlt={copy.inventory.screenshotAlt}
            title={copy.inventory.title}
          />
          <FeatureRow
            body={copy.mutation.body}
            eyebrow={copy.mutation.eyebrow}
            index={2}
            screenshot={SCREENSHOTS.mutation}
            screenshotAlt={copy.mutation.screenshotAlt}
            title={copy.mutation.title}
          />
          <FeatureRow
            body={copy.compare.body}
            bullets={copy.compare.bullets}
            eyebrow={copy.compare.eyebrow}
            id={SECTION_IDS.compare}
            index={3}
            screenshot={SCREENSHOTS.comparison}
            screenshotAlt={copy.compare.screenshotAlt}
            title={copy.compare.title}
          />
          <FeatureRow
            body={copy.collections.body}
            bullets={copy.collections.bullets}
            eyebrow={copy.collections.eyebrow}
            id={SECTION_IDS.collections}
            index={4}
            screenshot={SCREENSHOTS.collections}
            screenshotAlt={copy.collections.screenshotAlt}
            title={copy.collections.title}
          />
        </div>
        <HarnessSection copy={copy} />
        <SafetySection copy={copy} />
        <CliSection copy={copy} />
        <DownloadSection copy={copy} />
      </main>
      <SiteFooter copy={copy} onToggleLocale={toggleLocale} />
    </div>
  );
}
