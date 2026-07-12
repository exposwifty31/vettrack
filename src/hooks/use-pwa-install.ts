import { useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

export type PwaDisplayMode = "standalone" | "browser" | "fullscreen" | "minimal-ui";

export interface PwaInstallState {
  /** True when running as an installed PWA (standalone/fullscreen) */
  isStandalone: boolean;
  /** True on iOS Safari where beforeinstallprompt is not supported */
  isIos: boolean;
  /** True if the browser supports the install prompt (Chrome/Edge/Android) */
  canInstall: boolean;
  /** Trigger the native install prompt. Returns the user's choice. */
  promptInstall: () => Promise<"accepted" | "dismissed" | "unavailable">;
  /** True once the user has dismissed the Android/Chrome install banner (session-scoped) */
  androidDismissed: boolean;
  dismissAndroidBanner: () => void;
  /** True once the user has dismissed the iOS guidance banner */
  iosGuidanceDismissed: boolean;
  dismissIosGuidance: () => void;
}

function getDisplayMode(): PwaDisplayMode {
  if (typeof window === "undefined") return "browser";
  for (const mode of ["fullscreen", "standalone", "minimal-ui"] as const) {
    if (window.matchMedia(`(display-mode: ${mode})`).matches) return mode;
  }
  // iOS Safari standalone detection
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) {
    return "standalone";
  }
  return "browser";
}

function isIosSafari(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) && /safari/i.test(ua) && !/chrome|crios|fxios/i.test(ua);
}

// Re-show the iOS guidance banner after this many milliseconds (7 days).
const IOS_DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IOS_DISMISSED_KEY = "vt_pwa_ios_guidance_dismissed_at";

function isIosGuidanceSuppressed(): boolean {
  try {
    const raw = localStorage.getItem(IOS_DISMISSED_KEY);
    if (!raw) return false;
    const dismissedAt = parseInt(raw, 10);
    return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < IOS_DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

// Session-scoped: a dismissed Android/Chrome banner must stay dismissed across
// in-app navigation/remount for the rest of the browser tab's lifetime, but is
// free to reappear on the next fresh session (unlike the iOS guidance, which
// uses a 7-day TTL because it has no native re-trigger).
const ANDROID_DISMISSED_KEY = "vt_pwa_android_banner_dismissed";

function isAndroidBannerSuppressed(): boolean {
  try {
    return sessionStorage.getItem(ANDROID_DISMISSED_KEY) === "1";
  } catch (err) {
    // Non-fatal: fall back to "not suppressed" so the banner still offers
    // install, but surface the storage failure instead of swallowing it —
    // a silently-broken read here means a dismissed banner keeps reappearing.
    Sentry.captureMessage("PWA install: sessionStorage read failed (Android banner)", {
      level: "warning",
      extra: { key: ANDROID_DISMISSED_KEY, error: String(err) },
    });
    return false;
  }
}

export function usePwaInstall(): PwaInstallState {
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [isStandalone] = useState(() => {
    const mode = getDisplayMode();
    return mode === "standalone" || mode === "fullscreen";
  });
  const [isIos] = useState(isIosSafari);
  const [androidDismissed, setAndroidDismissed] = useState(isAndroidBannerSuppressed);
  const [iosGuidanceDismissed, setIosGuidanceDismissed] = useState(isIosGuidanceSuppressed);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      promptRef.current = e as BeforeInstallPromptEvent;
      setCanInstall(true);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // If the app was installed via our prompt, clear the install state.
    const onInstalled = () => setCanInstall(false);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
    if (!promptRef.current) return "unavailable";
    await promptRef.current.prompt();
    const { outcome } = await promptRef.current.userChoice;
    promptRef.current = null;
    setCanInstall(false);
    return outcome;
  }

  function dismissAndroidBanner() {
    setAndroidDismissed(true);
    try {
      sessionStorage.setItem(ANDROID_DISMISSED_KEY, "1");
    } catch (err) {
      // Non-fatal — state still held in memory for this session, but a
      // silently-failed write means the dismissal won't survive a remount.
      Sentry.captureMessage("PWA install: sessionStorage write failed (Android banner)", {
        level: "warning",
        extra: { key: ANDROID_DISMISSED_KEY, error: String(err) },
      });
    }
  }

  function dismissIosGuidance() {
    setIosGuidanceDismissed(true);
    try {
      // Store timestamp so we can re-show after IOS_DISMISS_TTL_MS (7 days).
      localStorage.setItem(IOS_DISMISSED_KEY, String(Date.now()));
    } catch {
      // storage unavailable — state still held in memory for this session
    }
  }

  return {
    isStandalone,
    isIos,
    canInstall,
    promptInstall,
    androidDismissed,
    dismissAndroidBanner,
    iosGuidanceDismissed,
    dismissIosGuidance,
  };
}
