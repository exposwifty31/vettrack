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

  it("registers appUrlOpen listener, invokes handler, and cleanup calls remove()", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const addListener = vi.fn().mockResolvedValue({ remove });
    vi.doMock("@capacitor/app", () => ({
      App: { addListener },
    }));

    const { deepLink } = await import("../src/infrastructure/platform/DeepLinkAdapter");
    const handler = vi.fn();
    const cleanup = deepLink.onOpen(handler);

    // Flush the async import + addListener promise
    await new Promise((r) => setTimeout(r, 0));

    expect(addListener).toHaveBeenCalledWith("appUrlOpen", expect.any(Function));

    // Simulate the appUrlOpen event by calling the registered callback directly
    const [, registeredCallback] = addListener.mock.calls[0] as [string, (ev: { url: string }) => void];
    registeredCallback({ url: "vettrack://equipment/e1" });
    expect(handler).toHaveBeenCalledWith("vettrack://equipment/e1");

    // Cleanup should call handle.remove()
    cleanup();
    await new Promise((r) => setTimeout(r, 0));
    expect(remove).toHaveBeenCalled();
  });

  it("does not invoke handler after cleanup (disposed guard)", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const addListener = vi.fn().mockResolvedValue({ remove });
    vi.doMock("@capacitor/app", () => ({
      App: { addListener },
    }));

    const { deepLink } = await import("../src/infrastructure/platform/DeepLinkAdapter");
    const handler = vi.fn();
    const cleanup = deepLink.onOpen(handler);

    cleanup(); // dispose before async import resolves

    await new Promise((r) => setTimeout(r, 0));

    // Even if addListener was called, handler must not be called after disposal
    if (addListener.mock.calls.length > 0) {
      const [, cb] = addListener.mock.calls[0] as [string, (ev: { url: string }) => void];
      cb({ url: "vettrack://equipment/e1" });
    }
    expect(handler).not.toHaveBeenCalled();
  });
});
