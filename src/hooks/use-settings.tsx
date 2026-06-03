import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import {
  applyLocaleDocumentAttributes,
  getStoredLocale,
  isSupportedLocale,
  setStoredLocale,
  type Locale,
} from "@/lib/i18n";
import { safeStorageGetItem, safeStorageSetItem } from "@/lib/safe-browser";

export type Density = "compact" | "comfortable";
export type TimeFormat = "12h" | "24h";
export type DateFormat = "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD";
/** Forest = brand green; Clinical = 60/30/10; Dark = clinical dark palette. */
export type ColorTheme = "forest" | "clinical" | "dark";

export interface Settings {
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

const STORAGE_KEY = "vettrack-settings";

const DEFAULT_SETTINGS: Settings = {
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
  timeFormat: "12h",
  dateFormat: "MM/DD/YYYY",
  brightness: 100,
};

function loadSettings(): Settings {
  try {
    const raw = safeStorageGetItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    if ("language" in parsed) {
      parsed.locale = isSupportedLocale(parsed.language) ? parsed.language : getStoredLocale();
      delete parsed.language;
    }
    if (!isSupportedLocale(parsed.locale)) parsed.locale = getStoredLocale();
    if (
      parsed.colorTheme !== "forest" &&
      parsed.colorTheme !== "clinical" &&
      parsed.colorTheme !== "dark"
    ) {
      parsed.colorTheme = "clinical";
    }
    if (typeof parsed.hapticsEnabled !== "boolean") {
      parsed.hapticsEnabled = true;
    }
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: Settings) {
  try {
    safeStorageSetItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
  }
}

function applySettings(settings: Settings) {
  const html = document.documentElement;
  const list = html?.classList;
  if (!list) return;
  const useDarkClass = settings.colorTheme === "dark" || settings.darkMode;
  if (useDarkClass) {
    list?.add("dark");
  } else {
    list?.remove("dark");
  }
  html.setAttribute("data-density", settings.density);
  html.setAttribute("data-color-theme", settings.colorTheme);
  const locale = setStoredLocale(settings.locale);
  applyLocaleDocumentAttributes(locale);
  const brightness = Math.min(100, Math.max(30, settings.brightness ?? 100));
  const body = document.body;
  if (!body) return;
  if (brightness < 100) {
    body.style.filter = `brightness(${brightness}%)`;
  } else {
    body.style.filter = "";
  }
}

interface SettingsContextType {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsContextType>({
  settings: DEFAULT_SETTINGS,
  update: () => {},
  reset: () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => {
    const loaded = loadSettings();
    applySettings(loaded);
    return loaded;
  });

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      applySettings(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    saveSettings(DEFAULT_SETTINGS);
    applySettings(DEFAULT_SETTINGS);
    setSettings(DEFAULT_SETTINGS);
  }, []);

  useEffect(() => {
    applySettings(settings);
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, update, reset }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
