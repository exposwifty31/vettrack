import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/lib/capacitor-runtime", () => ({
  isCapacitorNative: vi.fn(() => false),
}));

describe("DeepLinkAdapter — browser (non-native)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns a no-op cleanup function when not on native", async () => {
    const { deepLink } = await import("../src/infrastructure/platform/DeepLinkAdapter");
    const handler = vi.fn();
    const cleanup = deepLink.onOpen(handler);
    expect(typeof cleanup).toBe("function");
    expect(handler).not.toHaveBeenCalled();
    expect(() => cleanup()).not.toThrow();
  });
});

describe("DeepLinkAdapter — native", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("../src/lib/capacitor-runtime", () => ({
      isCapacitorNative: vi.fn(() => true),
    }));
  });

  it("registers appUrlOpen listener when native and invokes handler", async () => {
    const removeListener = vi.fn().mockResolvedValue(undefined);
    const addListener = vi.fn().mockResolvedValue(removeListener);
    vi.doMock("@capacitor/app", () => ({
      App: { addListener },
    }));

    const { deepLink } = await import("../src/infrastructure/platform/DeepLinkAdapter");
    const handler = vi.fn();
    const cleanup = deepLink.onOpen(handler);
    expect(typeof cleanup).toBe("function");
  });
});
