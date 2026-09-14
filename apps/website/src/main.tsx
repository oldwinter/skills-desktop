import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { LOCALE_STORAGE_KEY, resolveInitialLocale, type Locale } from "./content/locale.js";
import "./styles.css";

function readStoredLocale(): string | null {
  try {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage may be unavailable (private mode, blocked cookies); the toggle still works in-session.
  }
  const url = new URL(window.location.href);
  url.searchParams.set("lang", locale);
  window.history.replaceState(null, "", url);
}

export function mount(container: HTMLElement): void {
  const initialLocale = resolveInitialLocale({
    preferredLanguages: navigator.languages ?? [navigator.language],
    search: window.location.search,
    storedLocale: readStoredLocale(),
  });
  createRoot(container).render(
    <StrictMode>
      <App initialLocale={initialLocale} onLocaleChange={persistLocale} />
    </StrictMode>,
  );
}

const root = document.getElementById("root");
if (root !== null) {
  mount(root);
}
