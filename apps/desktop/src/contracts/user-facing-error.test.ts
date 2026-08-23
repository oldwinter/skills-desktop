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


  it("maps host-trust codes without inviting an unavailable V1 review CTA", () => {
    expect(
      userFacingErrorMessage({
        code: "host_trust_required",
        message: "This SSH Target requires explicit host-key review.",
      }),
    ).toBe("需要确认主机身份，但主机身份复核未在 V1 开放。");
    expect(
      userFacingErrorMessage({
        code: "host_key_changed",
        message: "Host key changed",
      }),
    ).toBe("主机密钥已变更。主机身份复核未在 V1 开放。");
    expect(
      userFacingErrorMessage({
        code: "host_trust_invalid",
        message: "invalid",
      }),
    ).toBe("主机信任无效。主机身份复核未在 V1 开放。");
  });

  it("falls back safely for nullish errors", () => {
    expect(userFacingErrorMessage(null)).toBe(USER_FACING_ERROR_FALLBACK);
    expect(userFacingErrorMessage(undefined)).toBe(USER_FACING_ERROR_FALLBACK);
  });
});
