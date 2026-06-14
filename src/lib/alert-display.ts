import { t } from "@/lib/i18n";
import type { AlertType } from "@/types";

/** Returns the localized detail string for a computed alert. */
export function formatAlertDetail(type: AlertType, days?: number): string {
  switch (type) {
    case "issue":
      return t.alerts.details.issue;
    case "overdue":
      return t.alerts.details.overdue(days ?? 0);
    case "sterilization_due":
      return t.alerts.details.sterilization_due;
    case "inactive":
      return t.alerts.details.inactive;
    default:
      return "";
  }
}
