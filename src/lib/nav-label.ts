// src/lib/nav-label.ts
import { t } from "@/lib/i18n";

/**
 * Resolve a nav node's `labelKey` (e.g. "nav.integrations") to its localized
 * label. Shared by Topbar and TopbarManagementMenu so the two label-resolution
 * paths cannot silently drift.
 *
 * The `as Record<string, string>` cast is required because `t.nav` is a typed
 * object literal with no index signature, so a runtime-keyed lookup does not
 * type-check against it directly. Falls back to the raw key when unmapped.
 */
export function navLabel(key: string): string {
  const k = key.startsWith("nav.") ? key.slice(4) : key;
  return (t.nav as Record<string, string>)[k] ?? key;
}
