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
/** Theme: follow the OS appearance, or force light/dark. */
export type Appearance = "system" | "light" | "dark";
/** Dynamic Type bucket — maps to the --type-scale multiplier. */
export type TextScale = "s" | "m" | "l" | "xl";

export interface UserSettings {
  locale: Locale;
  colorTheme: ColorTheme;
  appearance: Appearance;
  hapticsEnabled: boolean;
  density: Density;
  textScale: TextScale;
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
  appearance: "system",
  hapticsEnabled: true,
  density: "comfortable",
  textScale: "m",
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

// Incremented when settings schema changes in a way that requires migration.
// Stored alongside settings as `_v`. Absent → schema v0 (pre-migration build).
const SETTINGS_SCHEMA_VERSION = 2;

/** Sync read of persisted user settings (safe outside React). */
export function getStoredUserSettings(): UserSettings {
  try {
    const raw = safeStorageGetItem(USER_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_USER_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<UserSettings> & { language?: string; _v?: number };
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
    // Migration to v2: replace boolean darkMode with tri-state `appearance`.
    // v0's darkMode is untrusted inherited state (production localStorage on fresh
    // installs) → default to "system"; a v1 explicit darkMode:true is a genuine
    // user choice → "dark". Everything else follows the OS ("system").
    const storedV = typeof parsed._v === "number" ? parsed._v : 0;
    const legacyDark = (parsed as { darkMode?: boolean }).darkMode;
    if (parsed.appearance !== "system" && parsed.appearance !== "light" && parsed.appearance !== "dark") {
      parsed.appearance = storedV >= 1 && legacyDark === true ? "dark" : "system";
    }
    delete (parsed as { darkMode?: boolean }).darkMode;
    if (parsed.textScale !== "s" && parsed.textScale !== "m" && parsed.textScale !== "l" && parsed.textScale !== "xl") {
      parsed.textScale = "m";
    }
    const { _v: _storedSchemaVersion, ...storedSettings } = parsed;
    return { ...DEFAULT_USER_SETTINGS, ...storedSettings };
  } catch {
    return DEFAULT_USER_SETTINGS;
  }
}

export function saveStoredUserSettings(settings: UserSettings): void {
  const ok = safeStorageSetItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify({ ...settings, _v: SETTINGS_SCHEMA_VERSION }));
  if (!ok) {
    console.error(`[user-settings] failed to persist to "${USER_SETTINGS_STORAGE_KEY}" (quota or private-mode)`);
  }
}
