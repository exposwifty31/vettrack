import { useKioskWakeLock } from "@/hooks/useKioskWakeLock";

/**
 * Sole wake-lock owner on the /board kiosk. A wall display is always "kiosk", so
 * it unconditionally requests the screen wake-lock. BoardShell re-keys this on a
 * BFCache `pageshow(persisted)` restore so it remounts → the hook's [enabled]
 * effect re-runs tryAcquire(), closing the one gap useKioskWakeLock's own
 * visibilitychange handler doesn't cover (a pure BFCache restore fires no
 * visibilitychange). Renders nothing.
 */
export function KioskAwake() {
  useKioskWakeLock(true);
  return null;
}
