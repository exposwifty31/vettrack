/**
 * Haptic feedback vocabulary — aligned with docs/design-handoff/.../MOTION_HAPTICS_SOUND.md.
 * Always paired with visual feedback; gated by settings.hapticsEnabled.
 *
 * Two transports:
 * - Capacitor shell (iOS/Android): the native Haptics plugin — `navigator.vibrate`
 *   is a no-op in WKWebView, so without this iOS users feel nothing.
 * - Web/PWA: `navigator.vibrate` patterns (Android Chrome; silently unsupported
 *   on iOS Safari, same as before).
 */
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { isCapacitorNative } from "@/lib/capacitor-runtime";
import { triggerVibration } from "@/lib/safe-browser";
import { safeStorageGetItem } from "@/lib/safe-browser";

const SETTINGS_KEY = "vettrack-settings";

function hapticsEnabled(): boolean {
  try {
    const raw = safeStorageGetItem(SETTINGS_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as { hapticsEnabled?: boolean };
    return parsed.hapticsEnabled !== false;
  } catch {
    return true;
  }
}

type NativeCue =
  | { kind: "impact"; style: ImpactStyle }
  | { kind: "notification"; type: NotificationType };

function vibrate(pattern: VibratePattern, native: NativeCue) {
  if (!hapticsEnabled()) return;

  if (isCapacitorNative()) {
    const fire =
      native.kind === "impact"
        ? Haptics.impact({ style: native.style })
        : Haptics.notification({ type: native.type });
    fire.catch(() => {
      // Haptic failure must never surface to the user.
    });
    return;
  }

  triggerVibration(pattern, {
    requireUserActivation: true,
    silent: true,
  });
}

export const haptics = {
  /** Routine confirm (checkout, toggle) */
  tap: () => vibrate(10, { kind: "impact", style: ImpactStyle.Light }),

  /** Scan logged, task complete */
  scanSuccess: () => vibrate([0, 30], { kind: "notification", type: NotificationType.Success }),

  /** @deprecated use scanSuccess — kept for existing call sites */
  itemAdded: () => vibrate([0, 30], { kind: "notification", type: NotificationType.Success }),

  /** Overdue / validation block */
  warning: () => vibrate([0, 20, 40, 20], { kind: "notification", type: NotificationType.Warning }),

  /** Hard error */
  error: () => vibrate([0, 80], { kind: "notification", type: NotificationType.Error }),

  /** First scan, streak, milestone */
  celebrate: () => vibrate([0, 18, 40, 18, 40, 28], { kind: "notification", type: NotificationType.Success }),

  /** Sync complete */
  syncComplete: () => vibrate([0, 18, 40, 18, 40, 28], { kind: "notification", type: NotificationType.Success }),

  /** Navigation locked */
  locked: () => vibrate([0, 50], { kind: "impact", style: ImpactStyle.Heavy }),

  /** Alert resolved */
  resolved: () => vibrate([0, 30, 50, 30], { kind: "notification", type: NotificationType.Success }),
};
