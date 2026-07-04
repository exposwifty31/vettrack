import { t } from "@/lib/i18n";
import { STATUS_LABELS, type EquipmentStatus } from "@/types/equipment";

/**
 * Localized equipment-status label. `t.status.*` is the source of truth
 * (Hebrew default); the legacy English STATUS_LABELS dict is only a last
 * resort for statuses missing from the locale files (M1 — "OK" chips were
 * leaking English next to Hebrew UI).
 */
export function equipmentStatusLabel(status: string): string {
  const localized = (t.status as Record<string, string | undefined>)[status];
  return localized ?? STATUS_LABELS[status as EquipmentStatus] ?? status;
}
