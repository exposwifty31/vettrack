import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockImpact = vi.fn();
const mockNotification = vi.fn();
const mockIsCapacitorNative = vi.fn();
const mockSafeStorageGetItem = vi.fn();
const mockTriggerVibration = vi.fn();

vi.mock("@capacitor/haptics", () => ({
  Haptics: { impact: mockImpact, notification: mockNotification },
  ImpactStyle: { Light: "LIGHT", Medium: "MEDIUM", Heavy: "HEAVY" },
  NotificationType: { Success: "SUCCESS", Warning: "WARNING", Error: "ERROR" },
}));

vi.mock("@/lib/capacitor-runtime", () => ({
  isCapacitorNative: mockIsCapacitorNative,
}));

vi.mock("@/lib/safe-browser", () => ({
  safeStorageGetItem: mockSafeStorageGetItem,
  triggerVibration: mockTriggerVibration,
}));

// The native catch handler runs on a microtask; flush the queue before asserting.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("haptics DEV diagnostic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Shared baseline so each test overrides only the axis it exercises: a
    // native shell with haptics on, and both native cues failing so the
    // failure-diagnostic path is what gets tested.
    mockIsCapacitorNative.mockReturnValue(true);
    mockSafeStorageGetItem.mockReturnValue(null);
    mockTriggerVibration.mockReturnValue(true);
    mockImpact.mockRejectedValue(new Error("impact failed"));
    mockNotification.mockRejectedValue(new Error("notification failed"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("warns once when a native notification cue rejects in DEV", async () => {
    vi.stubEnv("DEV", true);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { haptics } = await import("@/lib/haptics");

    expect(() => haptics.error()).not.toThrow();
    await flush();

    // Prove the cue routed to the notification path — not just that *some*
    // native call warned (both mocks reject with the same error).
    expect(mockNotification).toHaveBeenCalledTimes(1);
    expect(mockImpact).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[haptics] native Haptics call failed:",
      expect.any(Error),
    );
  });

  it("does not warn when DEV is off", async () => {
    vi.stubEnv("DEV", false);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { haptics } = await import("@/lib/haptics");

    expect(() => haptics.error()).not.toThrow();
    await flush();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns when a native impact cue rejects in DEV", async () => {
    vi.stubEnv("DEV", true);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { haptics } = await import("@/lib/haptics");

    // Covers the impact branch (the notification cases exercise the other one).
    haptics.tap();
    await flush();

    expect(mockImpact).toHaveBeenCalledTimes(1);
    expect(mockNotification).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("short-circuits without dispatching when haptics are disabled", async () => {
    mockSafeStorageGetItem.mockReturnValue(JSON.stringify({ hapticsEnabled: false }));
    vi.stubEnv("DEV", true);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { haptics } = await import("@/lib/haptics");

    haptics.error();
    await flush();

    expect(mockNotification).not.toHaveBeenCalled();
    expect(mockImpact).not.toHaveBeenCalled();
    expect(mockTriggerVibration).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("never touches the native plugin or warns on the web path", async () => {
    mockIsCapacitorNative.mockReturnValue(false);
    vi.stubEnv("DEV", true);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { haptics } = await import("@/lib/haptics");

    haptics.error();
    await flush();

    expect(mockNotification).not.toHaveBeenCalled();
    expect(mockImpact).not.toHaveBeenCalled();
    expect(mockTriggerVibration).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
