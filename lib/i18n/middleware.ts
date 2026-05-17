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

export function resolveRequestLocale(req: Request, userLocale?: string | null): Locale {
  const userPreferred = typeof userLocale === "string" ? userLocale : undefined;
  const customHeaderValue = req.headers["x-locale"];
  const requestOverride = Array.isArray(customHeaderValue) ? customHeaderValue[0] : customHeaderValue;
  const acceptLanguage = req.headers["accept-language"];
  const acceptLanguageValue = Array.isArray(acceptLanguage) ? acceptLanguage[0] : acceptLanguage;
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
