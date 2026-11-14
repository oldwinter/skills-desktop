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

const entry: PublicInventoryState["entries"][number] = {
  agents: ["Codex"],
  contentFingerprint: { status: "unknown" },
  declaredSource: { source: "example/skills", sourceType: "github" },
  name: "example-skill",
  revision: { status: "unknown" },
  scope: "project",
};

function targetStateFor(
  definition: WorkspaceSnapshot["target"],
  state: PublicInventoryState,
) {
  return {
    deletionBlocked: false,
    inventory: state,
    mutation: {
      activeOperationId: null,
      commandPlan: null,
      lastError: null,
      outcome: null,
      phase: "idle" as const,
      reconciliationDeadline: null,
    },
    target: definition,
  };
}

function renderNavigation(state: PublicInventoryState) {
  return render(
    <LocaleProvider locale="en">
      <WorkspaceNavigation
        inventory={state}
        onSelectTarget={vi.fn()}
        onViewChange={vi.fn()}
        target={target}
        targetStates={[targetStateFor(target, state)]}
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

  it("shows each Target's inventory state and Skill count in the switcher", () => {
    const staleTarget = {
      ...target,
      id: "00000000-0000-4000-8000-00000000000a",
      label: "Stale project",
      workspaceLabel: "stale-project",
    };
    const emptyTarget = {
      ...target,
      id: "00000000-0000-4000-8000-00000000000b",
      label: "Empty project",
      workspaceLabel: "empty-project",
    };
    render(
      <LocaleProvider locale="en">
        <WorkspaceNavigation
          inventory={{ ...inventory, entries: [entry], freshness: "fresh" }}
          onSelectTarget={vi.fn()}
          onViewChange={vi.fn()}
          target={target}
          targetStates={[
            targetStateFor(target, {
              ...inventory,
              entries: [entry],
              freshness: "fresh",
            }),
            targetStateFor(staleTarget, {
              ...inventory,
              entries: [entry, { ...entry, name: "second-skill" }],
              freshness: "stale",
            }),
            targetStateFor(emptyTarget, {
              ...inventory,
              entries: [],
              freshness: "none",
              phase: "error",
            }),
          ]}
          view="inventory"
        />
      </LocaleProvider>,
    );

    const fresh = screen.getByRole("button", {
      name: "This device, skills-desktop, Fresh evidence · 1 Skill",
    });
    expect(fresh).toHaveAttribute("data-inventory-state", "fresh");
    expect(within(fresh).getByText("Fresh · 1 Skill")).toBeVisible();

    const stale = screen.getByRole("button", {
      name: "Stale project, stale-project, Stale evidence · 2 Skills",
    });
    expect(stale).toHaveAttribute("data-inventory-state", "stale");
    expect(within(stale).getByText("Stale · 2 Skills")).toBeVisible();

    const empty = screen.getByRole("button", {
      name: "Empty project, empty-project, No evidence",
    });
    expect(empty).toHaveAttribute("data-inventory-state", "none");
    expect(within(empty).getByText("No evidence")).toBeVisible();
  });

  it("does not show a stale Skill count while a Target refresh is loading", () => {
    renderNavigation({
      ...inventory,
      entries: [entry],
      phase: "loading",
    });

    const row = screen.getByRole("button", {
      name: "This device, skills-desktop, Loading",
    });
    expect(row).toHaveAttribute("data-inventory-state", "loading");
    expect(within(row).getByText("Loading")).toBeVisible();
    expect(within(row).queryByText(/Skill/)).toBeNull();
  });

  it("keeps SSH availability in the switcher's accessible name", () => {
    const sshTarget = {
      ...target,
      connectionReference: "build-host",
      kind: "ssh" as const,
      label: "Build host",
      workspaceLabel: "build-host",
    };
    render(
      <LocaleProvider locale="en">
        <WorkspaceNavigation
          inventory={{ ...inventory, freshness: "none" }}
          onSelectTarget={vi.fn()}
          onViewChange={vi.fn()}
          target={sshTarget}
          targetStates={[
            targetStateFor(sshTarget, { ...inventory, freshness: "none" }),
          ]}
          view="inventory"
        />
      </LocaleProvider>,
    );

    expect(
      screen.getByRole("button", {
        name: "Build host, build-host, No evidence, SSH · Not available in V1",
      }),
    ).toBeInTheDocument();
  });
});
