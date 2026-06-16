import {
  getStoredLocale,
  isSupportedLocale,
  type Locale,
} from "@/lib/i18n";
import { safeStorageGetItem, safeStorageSetItem } from "@/lib/safe-browser";

export type Density = "compact" | "comfortable";
export type TimeFormat = "12h" | "24h";
export type DateFormat = "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD";
/** Forest = brand green; Clinical = 60/30/10. */
export type ColorTheme = "forest" | "clinical";

export interface UserSettings {
  locale: Locale;
  colorTheme: ColorTheme;
  darkMode: boolean;
  hapticsEnabled: boolean;
  density: Density;
  soundEnabled: boolean;
  criticalAlertsSound: boolean;
  technicianReturnRemindersEnabled: boolean;
  seniorOwnReturnRemindersEnabled: boolean;
  seniorTeamOverdueAlertsEnabled: boolean;
  adminHourlySummaryEnabled: boolean;
  timeFormat: TimeFormat;
  dateFormat: DateFormat;
  brightness: number;
}

export const USER_SETTINGS_STORAGE_KEY = "vettrack-settings";

export const DEFAULT_USER_SETTINGS: UserSettings = {
  locale: getStoredLocale(),
  colorTheme: "clinical",
  darkMode: false,
  hapticsEnabled: true,
  density: "comfortable",
  soundEnabled: true,
  criticalAlertsSound: true,
  technicianReturnRemindersEnabled: true,
  seniorOwnReturnRemindersEnabled: true,
  seniorTeamOverdueAlertsEnabled: true,
  adminHourlySummaryEnabled: true,
  timeFormat: "24h",
  dateFormat: "DD/MM/YYYY",
  brightness: 100,
};

/** Sync read of persisted user settings (safe outside React). */
export function getStoredUserSettings(): UserSettings {
  try {
    const raw = safeStorageGetItem(USER_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_USER_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<UserSettings> & { language?: string };
    if ("language" in parsed) {
      parsed.locale = isSupportedLocale(parsed.language) ? parsed.language : getStoredLocale();
      delete parsed.language;
    }
    if (!isSupportedLocale(parsed.locale)) parsed.locale = getStoredLocale();
    if (parsed.colorTheme !== "forest" && parsed.colorTheme !== "clinical") {
      parsed.colorTheme = "clinical";
    }
    if (typeof parsed.hapticsEnabled !== "boolean") {
      parsed.hapticsEnabled = true;
    }
    return { ...DEFAULT_USER_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_USER_SETTINGS;
  }
}

export function saveStoredUserSettings(settings: UserSettings): void {
  try {
    safeStorageSetItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore quota / private-mode failures
  }
}
