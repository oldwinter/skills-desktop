import { describe, expect, it } from "vitest";

import {
  isLocalWorkspaceRoot,
  localWorkspaceLabel,
} from "./workspace-path.js";

describe("localWorkspaceLabel", () => {
  it("uses the workspace basename", () => {
    expect(localWorkspaceLabel("/Users/x/garden")).toBe("garden");
    expect(localWorkspaceLabel("relative/dir")).toBe("dir");
    expect(localWorkspaceLabel("/a/b/")).toBe("b");
  });

  it("falls back to the raw value when there is no basename", () => {
    expect(localWorkspaceLabel("/")).toBe("/");
    expect(localWorkspaceLabel("")).toBe("");
  });
});

describe("isLocalWorkspaceRoot", () => {
  it("detects the filesystem root", () => {
    expect(isLocalWorkspaceRoot("/")).toBe(true);
  });

  it("rejects non-root and relative workspaces", () => {
    expect(isLocalWorkspaceRoot("/tmp")).toBe(false);
    expect(isLocalWorkspaceRoot(".")).toBe(false);
    expect(isLocalWorkspaceRoot("")).toBe(false);
    expect(isLocalWorkspaceRoot("nested/dir")).toBe(false);
  });
});
