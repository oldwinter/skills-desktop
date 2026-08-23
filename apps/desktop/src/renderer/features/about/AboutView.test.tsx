// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AboutBridge,
  AboutUpdateSnapshot,
} from "../../../contracts/about.js";
import { AboutView } from "./AboutView.js";

const linuxSnapshot: AboutUpdateSnapshot = {
  application: {
    architecture: "x64",
    platform: "linux",
    version: "0.1.0",
  },
  lastCheckAt: null,
  nextAutomaticCheckAt: null,
  policy: {
    message:
      "Download a newer package from GitHub Releases and install it manually.",
    mode: "manual",
    releasePageUrl: "https://github.com/oldwinter/skills-desktop/releases",
  },
  schemaVersion: 1,
  state: { kind: "manual" },
};

function clientFor(snapshot: AboutUpdateSnapshot): AboutBridge {
  return {
    async exportDiagnostics() {
      return { ok: true, value: { status: "saved" } };
    },
    async getSnapshot() {
      return { ok: true, value: snapshot };
    },
    async requestCheck() {
      return { ok: true, value: snapshot };
    },
    async requestRestart() {
      return { ok: true, value: snapshot };
    },
    subscribe() {
      return () => undefined;
    },
  };
}

afterEach(cleanup);

describe("About surface", () => {
  it("shows Linux manual-upgrade guidance without in-app updater authority", async () => {
    render(<AboutView client={clientFor(linuxSnapshot)} />);

    expect(
      await screen.findByRole("heading", { name: "About" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Version 0.1.0")).toBeInTheDocument();
    expect(screen.getByText("linux / x64")).toBeInTheDocument();
    expect(screen.getByText("Never checked")).toBeInTheDocument();
    expect(screen.getByText("Not scheduled")).toBeInTheDocument();
    expect(screen.getByText("Manual upgrade")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Download a newer package from GitHub Releases and install it manually.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Check for updates" }),
    ).not.toBeInTheDocument();
  });

  it("shows unsigned-preview manual-upgrade guidance with verify docs", async () => {
    const unsignedSnapshot: AboutUpdateSnapshot = {
      ...linuxSnapshot,
      application: {
        architecture: "arm64",
        platform: "darwin",
        version: "0.1.0",
      },
      policy: {
        message:
          "This unsigned-preview build is not signed or notarized. Download a newer package from GitHub Releases, verify it per docs/unsigned-developer-preview.md, then install it manually.",
        mode: "manual",
        releasePageUrl: "https://github.com/oldwinter/skills-desktop/releases",
      },
    };
    render(<AboutView client={clientFor(unsignedSnapshot)} />);

    expect(
      await screen.findByRole("heading", { name: "Manual upgrade" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This unsigned-preview build is not signed or notarized. Download a newer package from GitHub Releases, verify it per docs/unsigned-developer-preview.md, then install it manually.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Check for updates" }),
    ).not.toBeInTheDocument();
  });

  it("requests one explicit check and renders the returned checking state", async () => {
    const checkingSnapshot: AboutUpdateSnapshot = {
      application: {
        architecture: "arm64",
        platform: "darwin",
        version: "0.1.0",
      },
      lastCheckAt: "2026-08-22T06:00:00.000Z",
      nextAutomaticCheckAt: "2026-08-23T06:00:00.000Z",
      policy: { channel: "stable", mode: "automatic" },
      schemaVersion: 1,
      state: { kind: "checking", requestedBy: "user" },
    };
    const requestCheck = vi.fn(async () => ({
      ok: true as const,
      value: checkingSnapshot,
    }));
    const client: AboutBridge = {
      async exportDiagnostics() {
        return { ok: true, value: { status: "saved" } };
      },
      async getSnapshot() {
        return {
          ok: true,
          value: {
            ...checkingSnapshot,
            lastCheckAt: null,
            state: { kind: "idle" },
          },
        };
      },
      requestCheck,
      async requestRestart() {
        return { ok: true, value: checkingSnapshot };
      },
      subscribe() {
        return () => undefined;
      },
    };
    render(<AboutView client={client} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Check for updates" }),
    );

    await waitFor(() => expect(requestCheck).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Checking for updates")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Check for updates" }),
    ).toBeDisabled();
    expect(
      screen.getByText("2026-08-22T06:00:00.000Z"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("2026-08-23T06:00:00.000Z"),
    ).toBeInTheDocument();
  });

  it("renders updater events as status only without install or restart commands", async () => {
    const idleSnapshot: AboutUpdateSnapshot = {
      application: {
        architecture: "x64",
        platform: "win32",
        version: "0.1.0",
      },
      lastCheckAt: null,
      nextAutomaticCheckAt: "2026-08-23T06:00:00.000Z",
      policy: { channel: "stable", mode: "automatic" },
      schemaVersion: 1,
      state: { kind: "idle" },
    };
    let publish: ((snapshot: AboutUpdateSnapshot) => void) | undefined;
    const client: AboutBridge = {
      async exportDiagnostics() {
        return { ok: true, value: { status: "saved" } };
      },
      async getSnapshot() {
        return { ok: true, value: idleSnapshot };
      },
      async requestCheck() {
        return { ok: true, value: idleSnapshot };
      },
      async requestRestart() {
        return { ok: true, value: idleSnapshot };
      },
      subscribe(listener) {
        publish = listener;
        return () => undefined;
      },
    };
    render(<AboutView client={client} />);
    await screen.findByText("Ready to check");

    act(() => publish?.({ ...idleSnapshot, state: { kind: "update-available" } }));
    expect(screen.getByText("Update available")).toBeInTheDocument();
    expect(screen.getByText("正在下载更新")).toBeInTheDocument();

    act(() => publish?.({ ...idleSnapshot, state: { kind: "update-downloaded" } }));
    expect(screen.getByText("Update ready for next launch")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /install|restart/i })).toBeNull();

    act(() =>
      publish?.({
        ...idleSnapshot,
        state: {
          error: {
            code: "check_failed",
            message: "The update check could not be completed.",
            retryable: true,
          },
          kind: "error",
        },
      }),
    );
    const updateAlert = screen.getByRole("alert");
    expect(updateAlert).toHaveTextContent("更新检查未能完成。请稍后重试。");
  });

  it("does not let the initial fetch overwrite a newer pushed snapshot", async () => {
    let resolveInitial:
      | ((
          result: Awaited<ReturnType<AboutBridge["getSnapshot"]>>,
        ) => void)
      | undefined;
    let publish: ((snapshot: AboutUpdateSnapshot) => void) | undefined;
    const initialSnapshot: AboutUpdateSnapshot = {
      application: {
        architecture: "x64",
        platform: "win32",
        version: "0.1.0",
      },
      lastCheckAt: null,
      nextAutomaticCheckAt: "2026-08-23T06:00:00.000Z",
      policy: { channel: "stable", mode: "automatic" },
      schemaVersion: 1,
      state: { kind: "idle" },
    };
    const client: AboutBridge = {
      async exportDiagnostics() {
        return { ok: true, value: { status: "saved" } };
      },
      getSnapshot: () =>
        new Promise((resolve) => {
          resolveInitial = resolve;
        }),
      async requestCheck() {
        return { ok: true, value: initialSnapshot };
      },
      async requestRestart() {
        return { ok: true, value: initialSnapshot };
      },
      subscribe(listener) {
        publish = listener;
        return () => undefined;
      },
    };
    render(<AboutView client={client} />);

    act(() =>
      publish?.({
        ...initialSnapshot,
        lastCheckAt: "2026-08-22T06:00:00.000Z",
        state: { kind: "checking", requestedBy: "automatic" },
      }),
    );
    expect(await screen.findByText("Checking for updates")).toBeInTheDocument();

    await act(async () => {
      resolveInitial?.({
        error: {
          code: "internal_error",
          message: "The update request could not be completed.",
          retryable: true,
        },
        ok: false,
      });
    });

    expect(screen.getByText("Checking for updates")).toBeInTheDocument();
    expect(screen.queryByText("Ready to check")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers only the current safe candidate for explicit restart and exports diagnostics", async () => {
    const snapshot: AboutUpdateSnapshot = {
      application: {
        architecture: "x64",
        platform: "win32",
        version: "0.1.0",
      },
      candidate: {
        architecture: "x64",
        id: "00000000-0000-4000-8000-000000000025",
        platform: "win32",
        version: "0.2.0",
      },
      lastCheckAt: "2026-08-22T06:00:00.000Z",
      nextAutomaticCheckAt: "2026-08-23T06:00:00.000Z",
      policy: { channel: "stable", mode: "automatic" },
      restart: {
        guardReasons: [],
        immediateRestartAvailable: true,
        kind: "deferred",
      },
      schemaVersion: 2,
      state: { kind: "update-downloaded" },
    };
    const requestRestart = vi.fn(async () => ({
      ok: true as const,
      value: { ...snapshot, restart: { ...snapshot.restart, kind: "restarting" as const } },
    }));
    const exportDiagnostics = vi.fn(async () => ({
      ok: true as const,
      value: { status: "saved" as const },
    }));
    const client: AboutBridge = {
      exportDiagnostics,
      async getSnapshot() {
        return { ok: true, value: snapshot };
      },
      async requestCheck() {
        return { ok: true, value: snapshot };
      },
      requestRestart,
      subscribe() {
        return () => undefined;
      },
    };
    render(<AboutView client={client} />);

    expect(await screen.findByText("版本 0.2.0 已就绪")).toBeInTheDocument();
    expect(screen.queryByText(/Candidate/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Electron/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restart to update" }));
    await waitFor(() =>
      expect(requestRestart).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000025",
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Export release diagnostics" }),
    );
    await waitFor(() => expect(exportDiagnostics).toHaveBeenCalledTimes(1));
  });

  it("shows current restart guards and withholds immediate restart authority", async () => {
    const snapshot: AboutUpdateSnapshot = {
      application: {
        architecture: "arm64",
        platform: "darwin",
        version: "0.1.0",
      },
      candidate: {
        architecture: "arm64",
        id: "00000000-0000-4000-8000-000000000025",
        platform: "darwin",
        version: "0.2.0",
      },
      lastCheckAt: "2026-08-22T06:00:00.000Z",
      nextAutomaticCheckAt: "2026-08-23T06:00:00.000Z",
      policy: { channel: "stable", mode: "automatic" },
      restart: {
        guardReasons: ["mutation-active", "reconciliation-required"],
        immediateRestartAvailable: false,
        kind: "blocked",
      },
      schemaVersion: 2,
      state: { kind: "update-downloaded" },
    };
    render(<AboutView client={clientFor(snapshot)} />);

    expect(await screen.findByText("Mutation active")).toBeInTheDocument();
    expect(screen.getByText("Reconciliation required")).toBeInTheDocument();
    const restart = screen.getByRole("button", { name: "Restart to update" });
    expect(restart).toBeDisabled();
    expect(restart).toHaveAttribute(
      "title",
      "Restart unavailable: Mutation active, Reconciliation required",
    );
    expect(restart).toHaveAttribute(
      "aria-describedby",
      "about-restart-unavailable-reason",
    );
    expect(
      document.getElementById("about-restart-unavailable-reason"),
    ).toHaveTextContent("Mutation active");
  });
});
