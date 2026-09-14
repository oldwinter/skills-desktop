// @vitest-environment jsdom

import { StrictMode, type ReactElement } from "react";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const renderer = vi.hoisted(() => ({
  App: vi.fn(),
  createRoot: vi.fn(),
}));

vi.mock("react-dom/client", () => ({ createRoot: renderer.createRoot }));
vi.mock("./App.js", () => ({ App: renderer.App }));
vi.mock("./styles.css", () => ({}));

async function loadEntrypoint() {
  vi.resetModules();
  return import("./main.js");
}

function renderedApp(): { initialLocale: string; onLocaleChange: (locale: string) => void } {
  const root = renderer.createRoot.mock.results[0]?.value as { render: ReturnType<typeof vi.fn> };
  const element = root.render.mock.calls[0]?.[0] as ReactElement<{ children: ReactElement }>;
  expect(element.type).toBe(StrictMode);
  const app = element.props.children;
  expect(app.type).toBe(renderer.App);
  return app.props as { initialLocale: string; onLocaleChange: (locale: string) => void };
}

describe("website entrypoint", () => {
  beforeEach(() => {
    renderer.createRoot.mockReset();
    renderer.createRoot.mockImplementation(() => ({ render: vi.fn() }));
    document.body.innerHTML = '<div id="root"></div>';
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts the app with the resolved locale and persists changes", async () => {
    window.localStorage.setItem("skills-desktop-website.locale", "zh");
    await loadEntrypoint();

    expect(renderer.createRoot).toHaveBeenCalledWith(document.getElementById("root"));
    const props = renderedApp();
    expect(props.initialLocale).toBe("zh");

    props.onLocaleChange("en");
    expect(window.localStorage.getItem("skills-desktop-website.locale")).toBe("en");
    expect(new URL(window.location.href).searchParams.get("lang")).toBe("en");
  });

  it("honours the lang query parameter over storage", async () => {
    window.localStorage.setItem("skills-desktop-website.locale", "en");
    window.history.replaceState(null, "", "/?lang=zh");
    await loadEntrypoint();

    expect(renderedApp().initialLocale).toBe("zh");
  });

  it("keeps working when storage is unavailable", async () => {
    const storage = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      await loadEntrypoint();
      const props = renderedApp();
      expect(props.initialLocale).toBe("en");
      expect(() => props.onLocaleChange("zh")).not.toThrow();
      expect(new URL(window.location.href).searchParams.get("lang")).toBe("zh");
    } finally {
      Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
    }
  });

  it("does nothing without a root element", async () => {
    document.body.innerHTML = "";
    await loadEntrypoint();
    expect(renderer.createRoot).not.toHaveBeenCalled();
  });
});
