import { describe, it, expect, vi, beforeEach } from "vitest";

const mockImpact = vi.fn().mockResolvedValue(undefined);
const mockSelectionChanged = vi.fn().mockResolvedValue(undefined);
const mockNotification = vi.fn().mockResolvedValue(undefined);

vi.mock("@capacitor/haptics", () => ({
  Haptics: {
    impact: mockImpact,
    selectionChanged: mockSelectionChanged,
    notification: mockNotification,
  },
  ImpactStyle: { Light: "LIGHT", Medium: "MEDIUM", Heavy: "HEAVY" },
  NotificationType: { Success: "SUCCESS", Warning: "WARNING", Error: "ERROR" },
}));

describe("HapticsAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("calls Haptics.impact with mapped style", async () => {
    const { haptics } = await import("../src/infrastructure/platform/HapticsAdapter");
    await haptics.impact("medium");
    expect(mockImpact).toHaveBeenCalledWith({ style: "MEDIUM" });
  });

  it("calls Haptics.selectionChanged", async () => {
    const { haptics } = await import("../src/infrastructure/platform/HapticsAdapter");
    await haptics.selectionChanged();
    expect(mockSelectionChanged).toHaveBeenCalled();
  });

  it("calls Haptics.notification with mapped type", async () => {
    const { haptics } = await import("../src/infrastructure/platform/HapticsAdapter");
    await haptics.notification("success");
    expect(mockNotification).toHaveBeenCalledWith({ type: "SUCCESS" });
  });

  it("silently swallows errors when plugin unavailable", async () => {
    mockNotification.mockRejectedValueOnce(new Error("not implemented"));
    const { haptics } = await import("../src/infrastructure/platform/HapticsAdapter");
    await expect(haptics.notification("error")).resolves.toBeUndefined();
  });
});
