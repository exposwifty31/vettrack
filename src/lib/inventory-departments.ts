import { t } from "@/lib/i18n";

type DepartmentLocaleKey = keyof typeof t.inventoryPage.departments;

/** Canonical department strings stored on inventory containers (English keys). */
const DEPARTMENT_LOCALE_KEYS: Record<string, DepartmentLocaleKey> = {
  Hospital: "hospital",
  Emergency: "emergency",
  "Internal Medicine": "internalMedicine",
};

/** Localized department label for inventory UI; falls back to the stored value. */
export function formatDepartmentLabel(department: string): string {
  const key = DEPARTMENT_LOCALE_KEYS[department];
  if (!key) return department;
  return t.inventoryPage.departments[key];
}
