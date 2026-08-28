/**
 * Clinic-wide Code Blue activation push copy.
 *
 * Hebrew is the product default for `code_blue_broadcast` (clinic-wide fan-out
 * has no per-recipient locale path today — do not invent one here). Fail-open:
 * if dictionary load / translate throws, return ASCII clinical fallbacks so the
 * caller can still enqueue.
 */

import { getLocaleDictionaries } from "../../lib/i18n/loader.js";
import { translate } from "../../lib/i18n/index.js";
import { INITIAL_LOCALE } from "../../lib/i18n/types.js";
import type { Locale } from "../../lib/i18n/types.js";

export type CodeBlueBroadcastPushCopy = {
  title: string;
  body: string;
};

type LoadDictionaries = (locale: Locale) => ReturnType<typeof getLocaleDictionaries>;

let loadDictionaries: LoadDictionaries = getLocaleDictionaries;

/** Test-only seam to force i18n failure (fail-open path). Pass null to restore. */
export function __setCodeBlueBroadcastPushI18nForTests(
  override: LoadDictionaries | null,
): void {
  loadDictionaries = override ?? getLocaleDictionaries;
}

function asciiFallback(actorName: string): CodeBlueBroadcastPushCopy {
  return {
    title: "⚠ CODE BLUE",
    body: `CODE BLUE activated by ${actorName}`,
  };
}

export function resolveCodeBlueBroadcastPushCopy(
  actorName: string,
): CodeBlueBroadcastPushCopy {
  const name = actorName || "";
  try {
    const { primary, fallback, locale: lc } = loadDictionaries(INITIAL_LOCALE);
    return {
      title: translate(primary, "push.codeBlue.title", undefined, {
        fallbackDict: fallback,
        locale: lc,
      }),
      body: translate(primary, "push.codeBlue.body", { name }, {
        fallbackDict: fallback,
        locale: lc,
      }),
    };
  } catch {
    return asciiFallback(name);
  }
}
