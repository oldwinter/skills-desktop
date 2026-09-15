// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  PublicInventoryState,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";
import { LocaleProvider } from "../../i18n/LocaleProvider.js";
import { WorkspaceNavigation } from "./WorkspaceNavigation.js";

const target: WorkspaceSnapshot["target"] = {
  connectionReference: null,
  dialectId: "skills-1.5.23",
  executionBindingDigest: null,
  generation: 1,
  harnessIds: ["codex"],
  id: "00000000-0000-4000-8000-000000000001",
  kind: "local",
  label: "This device",
  registryDigest:
    "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de",
  registryVersion: 1,
  workspace: "/work/skills-desktop",
  workspaceLabel: "skills-desktop",
};

const inventory: PublicInventoryState = {
  activeOperationId: null,
  cliVersion: "1.5.23",
  entries: [],
  freshness: "fresh",
  lastError: null,
  observedAt: "2026-08-21T10:00:00.000Z",
  persistenceWarning: null,
  phase: "ready",
};

function renderNavigation(state: PublicInventoryState) {
  return render(
    <LocaleProvider locale="en">
      <WorkspaceNavigation
        inventory={state}
        onSelectTarget={vi.fn()}
        onViewChange={vi.fn()}
        target={target}
        targetStates={[
          {
            deletionBlocked: false,
            inventory: state,
            mutation: {
              activeOperationId: null,
              commandPlan: null,
              lastError: null,
              outcome: null,
              phase: "idle",
              reconciliationDeadline: null,
            },
            target,
          },
        ]}
        view="inventory"
      />
    </LocaleProvider>,
  );
}

afterEach(cleanup);

describe("WorkspaceNavigation rail (#179)", () => {
  it("keeps Target Definitions and the Target Session switcher under distinct labels", () => {
    renderNavigation(inventory);

    const primary = screen.getByRole("navigation", { name: "Primary" });
    expect(
      within(primary).getByRole("button", { name: "Targets" }),
    ).toBeInTheDocument();

    const session = screen.getByRole("region", { name: "Active Target" });
    expect(
      within(session).getByRole("heading", { level: 2 }),
    ).toHaveTextContent("Active Target");
    expect(
      within(session).getByRole("button", { name: /This device/ }),
    ).toBeInTheDocument();
    expect(within(session).queryByText("Targets")).toBeNull();
  });

  it("shows the observed CLI version and never a renderer-side pin", () => {
    const { unmount } = renderNavigation(inventory);
    expect(screen.getByText("skills 1.5.23")).toBeInTheDocument();
    unmount();

    renderNavigation({ ...inventory, cliVersion: null, freshness: "none" });
    expect(screen.getByText("skills version unobserved")).toBeInTheDocument();
    expect(screen.queryByText(/1\.5\.23/)).toBeNull();
  });
});
