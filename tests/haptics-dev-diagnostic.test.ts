/**
 * Task 0.7 — src/lib/haptics.ts's vibrate() swallows native Haptics plugin
 * failures with an empty `.catch(() => {})` (no diagnostic at all). That's
 * correct for production (a haptic failure must never surface to the user),
 * but it means a misregistered/missing native plugin fails completely
 * silently during development, with no signal to the developer.
 *
 * This test asserts a dev-only diagnostic: when `import.meta.env.DEV` is
 * true and the native Haptics call rejects, `console.warn` is called.
 * Production behavior (never throwing, never surfacing to the user) must
 * be unaffected — that's covered by the existing
 * tests/settings-haptics-platform-gate.test.tsx regression check.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({ isNative: true }));

vi.mock("@/lib/capacitor-runtime", () => ({
  isCapacitorNative: () => mocks.isNative,
}));

vi.mock("@/lib/safe-browser", () => ({
  safeStorageGetItem: () => null, // hapticsEnabled() defaults to true
  triggerVibration: vi.fn(),
}));

vi.mock("@capacitor/haptics", () => ({
  Haptics: {
    impact: vi.fn().mockRejectedValue(new Error("plugin not implemented")),
    notification: vi.fn().mockRejectedValue(new Error("plugin not implemented")),
  },
  ImpactStyle: { Light: "LIGHT", Medium: "MEDIUM", Heavy: "HEAVY" },
  NotificationType: { Success: "SUCCESS", Warning: "WARNING", Error: "ERROR" },
}));

describe("haptics dev diagnostic on native fire failure", () => {
  let prevDev: boolean;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    prevDev = import.meta.env.DEV;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (import.meta.env as any).DEV = true;
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (import.meta.env as any).DEV = prevDev;
    warnSpy.mockRestore();
  });

  it("warns in dev when the native Haptics call rejects, without throwing", async () => {
    const { haptics } = await import("../src/lib/haptics");

    expect(() => haptics.tap()).not.toThrow();

    // vibrate() fires a fire-and-forget promise; flush microtasks so the
    // rejection handler (and diagnostic) has run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(warnSpy).toHaveBeenCalled();
  });
});
