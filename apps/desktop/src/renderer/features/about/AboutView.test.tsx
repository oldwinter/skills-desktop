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
    async getSnapshot() {
      return { ok: true, value: snapshot };
    },
    async requestCheck() {
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
      async getSnapshot() {
        return { ok: true, value: idleSnapshot };
      },
      async requestCheck() {
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
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The update check could not be completed.",
    );
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
      getSnapshot: () =>
        new Promise((resolve) => {
          resolveInitial = resolve;
        }),
      async requestCheck() {
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
});
