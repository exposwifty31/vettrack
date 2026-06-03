/**
 * Haptic feedback vocabulary — aligned with docs/design-handoff/.../MOTION_HAPTICS_SOUND.md.
 * Always paired with visual feedback; gated by settings.hapticsEnabled.
 */
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

function vibrate(pattern: VibratePattern) {
  if (!hapticsEnabled()) return;
  triggerVibration(pattern, {
    requireUserActivation: true,
    silent: true,
  });
}

export const haptics = {
  /** Routine confirm (checkout, toggle) */
  tap: () => vibrate(10),

  /** Scan logged, task complete */
  scanSuccess: () => vibrate([0, 30]),

  /** @deprecated use scanSuccess — kept for existing call sites */
  itemAdded: () => vibrate([0, 30]),

  /** Overdue / validation block */
  warning: () => vibrate([0, 20, 40, 20]),

  /** Hard error */
  error: () => vibrate([0, 80]),

  /** First scan, streak, milestone */
  celebrate: () => vibrate([0, 18, 40, 18, 40, 28]),

  /** Sync complete */
  syncComplete: () => vibrate([0, 18, 40, 18, 40, 28]),

  /** Navigation locked */
  locked: () => vibrate([0, 50]),

  /** Alert resolved */
  resolved: () => vibrate([0, 30, 50, 30]),
};
