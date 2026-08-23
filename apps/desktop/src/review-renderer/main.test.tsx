// @vitest-environment jsdom

import { StrictMode, type ReactElement } from "react";

import { beforeEach, describe, expect, it, vi } from "vitest";

const renderer = vi.hoisted(() => ({
  createRoot: vi.fn(),
  ReviewSurface: vi.fn(),
}));

vi.mock("react-dom/client", () => ({ createRoot: renderer.createRoot }));
vi.mock("./ReviewSurface.js", () => ({ ReviewSurface: renderer.ReviewSurface }));

const client = { getReview: vi.fn() };

async function loadEntrypoint() {
  vi.resetModules();
  await import("./main.js");
}

describe("review renderer entrypoint", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    renderer.createRoot.mockReset();
    renderer.ReviewSurface.mockReset();
    renderer.createRoot.mockReturnValue({ render: vi.fn() });
    Object.assign(window, { skillsReview: client });
  });

  it("renders the ReviewSurface in StrictMode with the review bridge", async () => {
    const root = document.createElement("div");
    root.id = "root";
    document.body.append(root);

    await loadEntrypoint();

    expect(renderer.createRoot).toHaveBeenCalledWith(root);
    const render = renderer.createRoot.mock.results[0]?.value.render as ReturnType<
      typeof vi.fn
    >;
    expect(render).toHaveBeenCalledTimes(1);
    const strictMode = render.mock.calls[0]?.[0] as ReactElement<{
      children: ReactElement<{ client: typeof client }>;
    }>;
    expect(strictMode.type).toBe(StrictMode);
    const surface = strictMode.props.children as ReactElement<{
      client: typeof client;
    }>;
    expect(surface.type).toBe(renderer.ReviewSurface);
    expect(surface.props.client).toBe(client);
  });

  it("fails closed when the bundled review renderer has no root element", async () => {
    await expect(loadEntrypoint()).rejects.toThrow("Review root is unavailable.");
    expect(renderer.createRoot).not.toHaveBeenCalled();
  });
});
