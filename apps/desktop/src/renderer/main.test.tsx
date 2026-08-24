// @vitest-environment jsdom

import { StrictMode, type ReactElement } from "react";

import { beforeEach, describe, expect, it, vi } from "vitest";

const renderer = vi.hoisted(() => ({
  createRoot: vi.fn(),
  InventoryApp: vi.fn(),
}));

vi.mock("react-dom/client", () => ({ createRoot: renderer.createRoot }));
vi.mock("./features/inventory/InventoryApp.js", () => ({
  InventoryApp: renderer.InventoryApp,
}));

const client = { getSnapshot: vi.fn() };

async function loadEntrypoint() {
  vi.resetModules();
  await import("./main.js");
}

describe("workspace renderer entrypoint", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    renderer.createRoot.mockReset();
    renderer.InventoryApp.mockReset();
    renderer.createRoot.mockReturnValue({ render: vi.fn() });
    Object.assign(window, { skillsDesktop: client });
  });

  it("renders the InventoryApp in StrictMode with the desktop bridge", async () => {
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
    const app = strictMode.props.children as ReactElement<{
      client: typeof client;
    }>;
    expect(app.type).toBe(renderer.InventoryApp);
    expect(app.props.client).toBe(client);
  });

  it("fails closed when the bundled renderer has no root element", async () => {
    await expect(loadEntrypoint()).rejects.toThrow(
      "Renderer root is unavailable.",
    );
    expect(renderer.createRoot).not.toHaveBeenCalled();
  });
});
