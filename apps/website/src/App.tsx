import { useEffect, useState, type ReactElement } from "react";

import { CliSection } from "./components/CliSection.js";
import { DownloadSection } from "./components/DownloadSection.js";
import { FeatureSection, WideSection } from "./components/FeatureSection.js";
import { HarnessSection } from "./components/HarnessSection.js";
import { Hero } from "./components/Hero.js";
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

  const toggleLocale = () => {
    const next = otherLocale(locale);
    setLocale(next);
    onLocaleChange?.(next);
  };

  return (
    <>
      <SiteHeader copy={copy} onToggleLocale={toggleLocale} />
      <main>
        <Hero copy={copy} />
        <HarnessSection copy={copy} />
        <FeatureSection
          copy={copy.inventory}
          id={SECTION_IDS.inventory}
          screenshot={SCREENSHOTS.inventory}
        />
        <WideSection
          body={copy.mutation.body}
          eyebrow={copy.mutation.eyebrow}
          screenshot={SCREENSHOTS.mutation}
          screenshotAlt={copy.mutation.screenshotAlt}
          title={copy.mutation.title}
        />
        <FeatureSection
          copy={copy.compare}
          deep
          id={SECTION_IDS.compare}
          reverse
          screenshot={SCREENSHOTS.comparison}
        />
        <FeatureSection
          copy={copy.collections}
          id={SECTION_IDS.collections}
          screenshot={SCREENSHOTS.collections}
        />
        <SafetySection copy={copy} />
        <CliSection copy={copy} />
        <DownloadSection copy={copy} />
      </main>
      <SiteFooter copy={copy} onToggleLocale={toggleLocale} />
    </>
  );
}
