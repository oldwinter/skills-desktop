import { describe, expect, it } from "vitest";

import { en } from "./i18n/messages.en.js";
import { zhCN } from "./i18n/messages.zh-cn.js";
import {
  GITHUB_SOURCE_OWNER_REPOSITORY_COPY,
  userFacingErrorMessage,
} from "./user-facing-error.js";

describe("userFacingErrorMessage", () => {
  it("maps common renderer codes to fixed user-facing copy in English by default", () => {
    expect(
      userFacingErrorMessage({
        code: "process_failed",
        message: "Inventory observation failed with stack …",
      }),
    ).toBe("The local process failed. Refresh, then try again.");
    expect(
      userFacingErrorMessage({
        code: "transport_failed",
        message: "ECONNRESET while dialing ssh",
      }),
    ).toBe(
      "The connection failed. Check the network or the Target, then try again.",
    );
    expect(
      userFacingErrorMessage({
        code: "reconciliation_required",
        message: "Recovery is required.",
      }),
    ).toBe("Reconciliation must finish first.");
    expect(
      userFacingErrorMessage({
        code: "unauthorized",
        message: "This window cannot make that request.",
      }),
    ).toBe("You are not allowed to perform this operation.");
  });

  it("renders the same codes in zh-CN without falling back to English", () => {
    expect(
      userFacingErrorMessage(
        { code: "process_failed", message: "stack" },
        "zh-CN",
      ),
    ).toBe("本地进程执行失败。请刷新后重试。");
    expect(
      userFacingErrorMessage({ code: "unauthorized", message: "no" }, "zh-CN"),
    ).toBe("无权限执行该操作。");
    expect(userFacingErrorMessage(null, "zh-CN")).toBe(
      "操作未能完成。请重试；若持续失败可导出诊断查看详情。",
    );
  });

  it("never returns the raw exception message for unknown codes", () => {
    const raw = "Error: ENOENT: no such file or directory, open '/secret/path'";
    expect(userFacingErrorMessage({ code: "not_a_real_code", message: raw })).toBe(
      en["error.fallback"],
    );
    expect(userFacingErrorMessage({ code: "not_a_real_code", message: raw })).not.toContain(
      "ENOENT",
    );
    expect(userFacingErrorMessage({ code: "not_a_real_code", message: raw })).not.toContain(
      "/secret/path",
    );
    // A code that happens to name a non-error catalog key must not leak it.
    expect(
      userFacingErrorMessage({ code: "fallback", message: raw }),
    ).toBe(en["error.fallback"]);
  });

  it("maps host-trust codes without inviting an unavailable V1 review CTA", () => {
    expect(
      userFacingErrorMessage({
        code: "host_trust_required",
        message: "This SSH Target requires explicit host-key review.",
      }),
    ).toBe(
      "Host identity must be confirmed, but host identity review is not available in V1.",
    );
    expect(
      userFacingErrorMessage({
        code: "host_key_changed",
        message: "Host key changed",
      }),
    ).toBe("The host key changed. Host identity review is not available in V1.");
    expect(
      userFacingErrorMessage({
        code: "host_trust_invalid",
        message: "invalid",
      }),
    ).toBe("Host trust is invalid. Host identity review is not available in V1.");
  });

  it("falls back safely for nullish errors", () => {
    expect(userFacingErrorMessage(null)).toBe(en["error.fallback"]);
    expect(userFacingErrorMessage(undefined)).toBe(en["error.fallback"]);
  });

  it("maps invalid GitHub source copy instead of a generic unsupported request", () => {
    expect(
      userFacingErrorMessage({
        code: "invalid_request",
        message: GITHUB_SOURCE_OWNER_REPOSITORY_COPY,
      }),
    ).toBe(en["error.githubSource"]);
    expect(
      userFacingErrorMessage(
        {
          code: "invalid_request",
          message: GITHUB_SOURCE_OWNER_REPOSITORY_COPY,
        },
        "zh-CN",
      ),
    ).toBe(zhCN["error.githubSource"]);
    expect(
      userFacingErrorMessage({
        code: "invalid_request",
        message: "The request is not supported.",
      }),
    ).not.toBe("The request is not supported.");
  });
});
