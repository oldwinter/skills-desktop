import { describe, expect, it } from "vitest";

import {
  USER_FACING_ERROR_FALLBACK,
  userFacingErrorMessage,
} from "./user-facing-error.js";

describe("userFacingErrorMessage", () => {
  it("maps common renderer codes to fixed user-facing copy", () => {
    expect(
      userFacingErrorMessage({
        code: "process_failed",
        message: "Inventory observation failed with stack …",
      }),
    ).toBe("本地进程执行失败。请刷新后重试。");
    expect(
      userFacingErrorMessage({
        code: "transport_failed",
        message: "ECONNRESET while dialing ssh",
      }),
    ).toBe("连接失败。请检查网络或 Target 后重试。");
    expect(
      userFacingErrorMessage({
        code: "reconciliation_required",
        message: "Recovery is required.",
      }),
    ).toBe("需要先完成 reconciliation。");
    expect(
      userFacingErrorMessage({
        code: "unauthorized",
        message: "This window cannot make that request.",
      }),
    ).toBe("无权限执行该操作。");
  });

  it("never returns the raw exception message for unknown codes", () => {
    const raw = "Error: ENOENT: no such file or directory, open '/secret/path'";
    expect(userFacingErrorMessage({ code: "not_a_real_code", message: raw })).toBe(
      USER_FACING_ERROR_FALLBACK,
    );
    expect(userFacingErrorMessage({ code: "not_a_real_code", message: raw })).not.toContain(
      "ENOENT",
    );
    expect(userFacingErrorMessage({ code: "not_a_real_code", message: raw })).not.toContain(
      "/secret/path",
    );
  });

  it("falls back safely for nullish errors", () => {
    expect(userFacingErrorMessage(null)).toBe(USER_FACING_ERROR_FALLBACK);
    expect(userFacingErrorMessage(undefined)).toBe(USER_FACING_ERROR_FALLBACK);
  });
});
