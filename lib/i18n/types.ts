export type Locale = "en" | "he";

export type TranslationParams = Record<string, string | number | boolean>;

export interface TranslationDictionary {
  [key: string]: string | TranslationDictionary;
}

export const SUPPORTED_LOCALES: readonly Locale[] = ["en", "he"] as const;

/**
 * Structural fallback dictionary locale. `loadLocale(DEFAULT_LOCALE)` is
 * the source-of-truth dictionary that `translate()` falls back to when a
 * key is missing from the requested locale's dictionary. Phase 6 keeps
 * this anchored to English so the fallback chain stays intact.
 *
 * Do NOT flip this to `"he"`. Use `INITIAL_LOCALE` (below) for resolver
 * defaults instead.
 */
export const DEFAULT_LOCALE: Locale = "en";

/**
 * Initial locale for requests with no user preference, `x-locale` header,
 * or `Accept-Language` signal — i.e. unauthenticated callers and broadcast
 * paths. Phase 6 (§19 locked decision 1) introduces this as a separate
 * additive constant so the unauth/broadcast default can be Hebrew without
 * disturbing the English dictionary-fallback role of `DEFAULT_LOCALE`.
 */
export const INITIAL_LOCALE: Locale = "he";
