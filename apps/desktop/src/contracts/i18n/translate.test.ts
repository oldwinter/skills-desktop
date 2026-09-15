import { describe, expect, it } from "vitest";

import { LOCALES } from "../preferences.js";
import { en } from "./messages.en.js";
import { zhCN } from "./messages.zh-cn.js";
import {
  CATALOGS,
  createTranslator,
  interpolate,
  placeholdersOf,
  type MessageKey,
} from "./translate.js";

const enKeys = Object.keys(en).sort();

describe("message catalogs", () => {
  it("cover every supported locale with exactly the en key set", () => {
    for (const locale of LOCALES) {
      const keys = Object.keys(CATALOGS[locale]).sort();
      expect(keys, `${locale} keys`).toEqual(enKeys);
    }
  });

  it("keep every message non-empty with identical placeholders across locales", () => {
    for (const key of enKeys as MessageKey[]) {
      const expected = placeholdersOf(en[key]);
      for (const locale of LOCALES) {
        const value = CATALOGS[locale][key];
        expect(value.trim().length, `${locale}:${key}`).toBeGreaterThan(0);
        expect(placeholdersOf(value), `${locale}:${key}`).toEqual(expected);
      }
    }
  });

  it("pair every plural .one key with a .other key", () => {
    for (const key of enKeys) {
      if (key.endsWith(".one")) {
        expect(enKeys).toContain(`${key.slice(0, -".one".length)}.other`);
      }
      if (key.endsWith(".other")) {
        expect(enKeys).toContain(`${key.slice(0, -".other".length)}.one`);
      }
    }
  });

  it("keep zh-CN free of leftover English sentences for user-facing prose", () => {
    const proseKeys = [
      "inventory.empty.installHint",
      "recovery.empty.body",
      "comparison.next.addTarget",
    ] as const;
    for (const key of proseKeys) {
      expect(zhCN[key]).not.toBe(en[key]);
      expect(zhCN[key]).toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it("keep every renderer error code in the catalog", () => {
    const codes = [
      "branch_unsupported",
      "cancelled",
      "export_invalid",
      "git_unavailable",
      "publication_drift",
      "publication_guarded",
      "publication_invalid",
      "publication_unavailable",
      "remote_unreachable",
      "remote_unsupported",
      "cli_incompatible",
      "conflicting_inventory_entry",
      "duplicate_inventory_entry",
      "host_key_changed",
      "host_trust_invalid",
      "host_trust_required",
      "internal_error",
      "confirmation_expired",
      "confirmation_invalid",
      "invalid_inventory",
      "invalid_intent",
      "invalid_request",
      "inventory_too_large",
      "mutation_conflict",
      "mutation_ineligible",
      "persist_failed",
      "process_failed",
      "remote_protocol_mismatch",
      "remote_protocol_violation",
      "remote_runtime_unavailable",
      "reconciliation_required",
      "reconciliation_wait",
      "review_expired",
      "review_invalid",
      "stale_inventory",
      "ssh_config_invalid",
      "target_not_found",
      "target_unavailable",
      "transport_failed",
      "transport_lost",
      "transport_unavailable",
      "unauthorized",
      "unsupported_schema",
    ];
    for (const code of codes) expect(enKeys).toContain(`error.${code}`);
  });
});

describe("createTranslator", () => {
  it("interpolates placeholders and leaves unknown ones visible", () => {
    expect(interpolate("Version {version}", { version: "1.2.3" })).toBe(
      "Version 1.2.3",
    );
    expect(interpolate("Version {version}", {})).toBe("Version {version}");
    expect(interpolate("Count {count}", { count: 0 })).toBe("Count 0");
  });

  it("selects plural forms by count and forwards the count", () => {
    const english = createTranslator("en");
    expect(english.tc("inventory.subtitle.matching", 1)).toBe(
      "1 matching skill",
    );
    expect(english.tc("inventory.subtitle.matching", 3)).toBe(
      "3 matching skills",
    );
    expect(english.tc("nav.pending", 2, { label: "Recovery" })).toBe(
      "Recovery, 2 items pending",
    );
  });

  it("renders zh-CN without mixing in English catalog text", () => {
    const chinese = createTranslator("zh-CN");
    expect(chinese.locale).toBe("zh-CN");
    expect(chinese.t("nav.inventory")).toBe("库存");
    expect(chinese.t("about.version", { version: "0.1.0" })).toBe("版本 0.1.0");
    expect(chinese.t("common.details")).toBe("详情");
  });

  it("defaults to English", () => {
    expect(createTranslator().t("nav.inventory")).toBe("Inventory");
  });
});
