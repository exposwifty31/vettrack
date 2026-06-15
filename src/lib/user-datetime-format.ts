import { format } from "date-fns";
import { he, enUS } from "date-fns/locale";
import { getStoredLocale } from "@/lib/i18n";
import {
  getStoredUserSettings,
  type DateFormat,
  type TimeFormat,
} from "@/lib/user-settings-storage";

function dateFnsLocale() {
  return getStoredLocale() === "he" ? he : enUS;
}

function datePattern(dateFormat: DateFormat): string {
  switch (dateFormat) {
    case "MM/DD/YYYY":
      return "MM/dd/yyyy";
    case "DD/MM/YYYY":
      return "dd/MM/yyyy";
    case "YYYY-MM-DD":
      return "yyyy-MM-dd";
    default: {
      const _exhaustive: never = dateFormat;
      return _exhaustive;
    }
  }
}

function timePattern(timeFormat: TimeFormat): string {
  return timeFormat === "12h" ? "h:mm a" : "HH:mm";
}

/** Date string honoring user date-format preference from settings. */
export function formatUserDate(date: string | null | undefined): string {
  if (!date) return "—";
  try {
    const { dateFormat } = getStoredUserSettings();
    return format(new Date(date), datePattern(dateFormat), { locale: dateFnsLocale() });
  } catch {
    return "—";
  }
}

/** Date + time honoring user date and time format preferences from settings. */
export function formatUserDateTime(date: string | null | undefined): string {
  if (!date) return "—";
  try {
    const { dateFormat, timeFormat } = getStoredUserSettings();
    const pattern = `${datePattern(dateFormat)} ${timePattern(timeFormat)}`;
    return format(new Date(date), pattern, { locale: dateFnsLocale() });
  } catch {
    return "—";
  }
}
