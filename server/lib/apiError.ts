import type { Request, Response } from "express";
import { getLocaleDictionaries } from "../../lib/i18n/loader.js";
import { translate, type TranslationParams } from "../../lib/i18n/index.js";
import { isInternalKey } from "../../lib/i18n/internal-keys.js";

/**
 * Phase 6 PR 6.3 — canonical i18n-aware 4xx/5xx response helper.
 *
 * Reads `req.locale` (resolved by `i18nMiddleware`), translates the key
 * path against the locale's dictionary (falling back to English then the
 * key path itself), and writes a minimal JSON response body:
 *
 *   { error: <localized>, code: <key>, params?: <params> }
 *
 * The `code` field is the resolved key actually rendered (so clients can
 * distinguish the production `_meta.*` fallback case — see below). The
 * `error` field is the rendered human-readable text in the request locale.
 *
 * COEXISTENCE: this helper does NOT replace `buildAccessDeniedBody`
 * (`server/lib/access-denied.ts`) or the Phase 5
 * `ClinicalInvariantDenyError` envelope. Those carry their own structured
 * shapes (`code`, `reason`, `message`, `requestId`, plus `clinical`/`cop`
 * for clinical-invariant) and remain unchanged through Phase 6.
 *
 * INTERNAL-KEY GUARD (Phase 6 §5 invariant 13, point (c) + §6):
 *
 *   - In dev/test (`NODE_ENV !== "production"`), invoking with an
 *     internal key (e.g. `_meta.foo`) THROWS. Loud detection at the
 *     source — internal keys are not user-facing.
 *
 *   - In production, invoking with an internal key LOGS to stderr and
 *     transparently substitutes the safe fallback key `"errors.generic"`
 *     at the ORIGINALLY REQUESTED status (never degrades to 500). The
 *     response `code` field reflects the resolved key
 *     (`"errors.generic"` in this fallback case) so clients can
 *     distinguish.
 *
 * The single shared `isInternalKey` predicate (`lib/i18n/internal-keys.ts`)
 * is the canonical check used at all four §5 invariant 13 enforcement
 * points.
 */
export function apiError(
  req: Request,
  res: Response,
  key: string,
  params?: TranslationParams,
  status: number = 400,
): Response {
  let resolvedKey = key;
  let resolvedParams = params;

  if (isInternalKey(key)) {
    if (process.env.NODE_ENV !== "production") {
      throw new Error(
        `apiError: internal key "${key}" is not user-facing. Use a non-underscore key path (e.g. errors.*).`,
      );
    }
    console.error(`[apiError] internal-key misuse: ${key} at ${req.method} ${req.originalUrl}`);
    resolvedKey = "errors.generic";
    resolvedParams = undefined;
  }

  const { primary, fallback, locale } = getLocaleDictionaries(req.locale);
  const error = translate(primary, resolvedKey, resolvedParams, {
    fallbackDict: fallback,
    locale,
  });

  const body: { error: string; code: string; params?: TranslationParams } = {
    error,
    code: resolvedKey,
  };
  if (resolvedParams) body.params = resolvedParams;

  return res.status(status).json(body);
}
