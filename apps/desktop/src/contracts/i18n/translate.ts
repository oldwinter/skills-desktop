import { DEFAULT_LOCALE, type Locale } from "../preferences.js";
import { en } from "./messages.en.js";
import { zhCN } from "./messages.zh-cn.js";

/**
 * ADR 0023 message keys. `en` is the source of truth for the key set; every
 * other catalog must cover exactly the same keys (enforced by the type below
 * and by the catalog parity test). Values interpolate `{name}` placeholders.
 */
export type MessageKey = keyof typeof en;
export type MessageCatalog = Readonly<Record<MessageKey, string>>;

type PluralBase<K extends string> = K extends `${infer Base}.one`
  ? Base extends string
    ? `${Base}.other` extends MessageKey
      ? Base
      : never
    : never
  : never;
export type PluralMessageKey = PluralBase<MessageKey>;

export type MessageParams = Readonly<
  Record<string, string | number | null | undefined>
>;

export interface Translator {
  readonly locale: Locale;
  /** Resolve a message key, interpolating `{name}` placeholders. */
  t(key: MessageKey, params?: MessageParams): string;
  /** Resolve `${base}.one` or `${base}.other` by count and pass `count` in. */
  tc(base: PluralMessageKey, count: number, params?: MessageParams): string;
}

export const CATALOGS: Readonly<Record<Locale, MessageCatalog>> = {
  en,
  "zh-CN": zhCN,
};

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

export function interpolate(template: string, params?: MessageParams): string {
  if (params === undefined) return template;
  return template.replaceAll(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? match : String(value);
  });
}

export function placeholdersOf(template: string): readonly string[] {
  return [...template.matchAll(PLACEHOLDER)]
    .map((match) => match[1] ?? "")
    .sort();
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && value in CATALOGS;
}

export function createTranslator(locale: Locale = DEFAULT_LOCALE): Translator {
  const catalog = CATALOGS[locale];
  const t: Translator["t"] = (key, params) =>
    interpolate(catalog[key] ?? en[key], params);
  return {
    locale,
    t,
    tc(base, count, params) {
      const key = `${base}.${count === 1 ? "one" : "other"}` as MessageKey;
      return t(key, { count, ...params });
    },
  };
}
