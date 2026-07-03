import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import {
  applyLocaleDocumentAttributes,
  getStoredLocale,
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
import { getNativeContentSizeScale } from "@/lib/dynamic-type";

export type { ColorTheme, DateFormat, Density, TimeFormat };
export type Settings = UserSettings;

const TEXT_SCALE_MULTIPLIER: Record<Settings["textScale"], number> = {
  s: 0.9,
  m: 1,
  l: 1.15,
  xl: 1.3,
};

/** Map a native OS Dynamic Type scale (~0.82–1.5) to our text-size bucket. */
function scaleToBucket(scale: number): Settings["textScale"] {
  if (scale <= 0.92) return "s";
  if (scale < 1.1) return "m";
  if (scale < 1.28) return "l";
  return "xl";
}

/** Whether dark styling is active — follows the OS when appearance is "system". */
function isDarkActive(appearance: Settings["appearance"]): boolean {
  if (appearance === "dark") return true;
  if (appearance === "light") return false;
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function applySettings(settings: Settings) {
  const html = document.documentElement;
  const list = html?.classList;
  if (!list) return;
  if (isDarkActive(settings.appearance)) {
    list.add("dark");
  } else {
    list.remove("dark");
  }
  html.style.setProperty("--type-scale", String(TEXT_SCALE_MULTIPLIER[settings.textScale] ?? 1));
  html.setAttribute("data-density", settings.density);
  html.setAttribute("data-color-theme", settings.colorTheme);
  // setStoredLocale dispatches "vettrack:locale-changed", and main.tsx keys
  // <App> by that event — so it remounts the entire tree (resetting scroll).
  // Only persist + broadcast when the locale actually changed; otherwise an
  // unrelated toggle (e.g. Master Sound) would remount the app and jump the
  // page. The document lang/dir attributes are cheap and always re-applied.
  if (settings.locale !== getStoredLocale()) {
    setStoredLocale(settings.locale);
  }
  applyLocaleDocumentAttributes(settings.locale);
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

  // Re-apply when the OS appearance changes and the user is following the system.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (settings.appearance === "system") applySettings(settings);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [settings]);

  // Seed text size from the OS Dynamic Type on native — once, and only if the
  // user hasn't chosen a size yet (still the default). No-op on web and until the
  // native plugin is registered (getNativeContentSizeScale → null).
  useEffect(() => {
    let cancelled = false;
    getNativeContentSizeScale().then((scale) => {
      if (cancelled || scale == null) return;
      setSettings((prev) => {
        if (prev.textScale !== DEFAULT_USER_SETTINGS.textScale) return prev;
        const bucket = scaleToBucket(scale);
        if (bucket === prev.textScale) return prev;
        const next = { ...prev, textScale: bucket };
        saveStoredUserSettings(next);
        applySettings(next);
        return next;
      });
    });
    return () => { cancelled = true; };
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
