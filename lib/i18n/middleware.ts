import type { Request, Response, NextFunction } from "express";
import type { Locale } from "./types.js";
import { INITIAL_LOCALE, SUPPORTED_LOCALES } from "./types.js";
import { normalizeLocale } from "./loader.js";

declare global {
  namespace Express {
    interface Request {
      locale: Locale;
    }
  }
}

export function i18nMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.locale = resolveRequestLocale(req);
  next();
}

/**
 * A blank or whitespace-only value is an ABSENT preference, not an expressed
 * one — and `??` falls through only on null/undefined, so `""` would otherwise
 * win its position in the chain below and swallow every weaker-but-real signal
 * after it. Every leg of that chain goes through here; normalising only one of
 * them fixes an instance rather than the class.
 *
 * A repeated header yields an array; the first element is taken, matching the
 * pre-existing convention. Blank-means-absent then applies to that element, so
 * a malformed leading value defers to the next SIGNAL rather than to the next
 * array entry. That is deliberate, not an oversight.
 */
function expressedPreference(value: string | string[] | null | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.trim() !== "" ? first : undefined;
}

export function resolveRequestLocale(req: Request, userLocale?: string | null): Locale {
  const userPreferred = expressedPreference(userLocale);
  const requestOverride = expressedPreference(req.headers["x-locale"]);
  const acceptLanguageValue = expressedPreference(req.headers["accept-language"]);
  // Resolver fallback uses INITIAL_LOCALE (Phase 6 PR 6.2). The dictionary
  // fallback chain in `loader.getLocaleDictionaries` continues to use
  // DEFAULT_LOCALE (English) as the structural fallback dict.
  const normalized = normalizeLocale(userPreferred ?? requestOverride ?? acceptLanguageValue ?? INITIAL_LOCALE);
  if (!SUPPORTED_LOCALES.includes(normalized)) {
    console.warn(`[i18n] Resolved unsupported locale "${normalized}", defaulting to "${INITIAL_LOCALE}"`);
    return INITIAL_LOCALE;
  }
  return normalized;
}
