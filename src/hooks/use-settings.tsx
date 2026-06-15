import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import {
  applyLocaleDocumentAttributes,
  setStoredLocale,
} from "@/lib/i18n";
import {
  DEFAULT_USER_SETTINGS,
  getStoredUserSettings,
  saveStoredUserSettings,
  type ColorTheme,
  type DateFormat,
  type Density,
  type TimeFormat,
  type UserSettings,
} from "@/lib/user-settings-storage";

export type { ColorTheme, DateFormat, Density, TimeFormat };
export type Settings = UserSettings;

function applySettings(settings: Settings) {
  const html = document.documentElement;
  const list = html?.classList;
  if (!list) return;
  const useDarkClass = settings.darkMode;
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
  settings: DEFAULT_USER_SETTINGS,
  update: () => {},
  reset: () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => {
    const loaded = getStoredUserSettings();
    applySettings(loaded);
    return loaded;
  });

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveStoredUserSettings(next);
      applySettings(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    saveStoredUserSettings(DEFAULT_USER_SETTINGS);
    applySettings(DEFAULT_USER_SETTINGS);
    setSettings(DEFAULT_USER_SETTINGS);
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
