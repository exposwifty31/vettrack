import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  IHapticsProvider,
  INfcProvider,
  IDeepLinkProvider,
} from "../src/core/ports";

function hasMethod(obj: object, name: string): boolean {
  return typeof (obj as Record<string, unknown>)[name] === "function";
}

describe("IHapticsProvider contract", () => {
  beforeEach(() => vi.resetModules());

  it("HapticsAdapter satisfies the interface", async () => {
    const { haptics } = await import("../src/infrastructure/platform/HapticsAdapter");
    const adapter = haptics as IHapticsProvider;
    expect(hasMethod(adapter, "impact")).toBe(true);
    expect(hasMethod(adapter, "selectionChanged")).toBe(true);
    expect(hasMethod(adapter, "notification")).toBe(true);
  });

  it("rethrows unexpected errors from impact", async () => {
    vi.doMock("@capacitor/haptics", () => ({
      Haptics: {
        impact: vi.fn().mockRejectedValue(new Error("network failure")),
      },
      ImpactStyle: { Light: "LIGHT", Medium: "MEDIUM", Heavy: "HEAVY" },
    }));
    const { haptics } = await import("../src/infrastructure/platform/HapticsAdapter");
    await expect(haptics.impact("light")).rejects.toThrow("network failure");
  });
});

describe("INfcProvider contract", () => {
  beforeEach(() => vi.resetModules());

  it("NfcAdapter satisfies the interface", async () => {
    const { nfc } = await import("../src/infrastructure/platform/NfcAdapter");
    const adapter = nfc as INfcProvider;
    expect(hasMethod(adapter, "isSupported")).toBe(true);
    expect(hasMethod(adapter, "readOnce")).toBe(true);
    expect(hasMethod(adapter, "startSession")).toBe(true);
  });

  it("surfaces readOnce rejection unchanged", async () => {
    vi.doMock("../src/lib/nfc-platform", () => ({
      isNfcSupported: vi.fn().mockResolvedValue(true),
      readNfcOnce: vi.fn().mockRejectedValue(new Error("NFC timeout")),
      startNfcScanSession: vi.fn(),
    }));
    const { nfc } = await import("../src/infrastructure/platform/NfcAdapter");
    await expect(nfc.readOnce()).rejects.toThrow("NFC timeout");
  });
});

describe("IDeepLinkProvider contract", () => {
  beforeEach(() => vi.resetModules());

  it("DeepLinkAdapter satisfies the interface", async () => {
    vi.doMock("../src/lib/capacitor-runtime", () => ({
      isCapacitorNative: vi.fn(() => false),
    }));
    const { deepLink } = await import("../src/infrastructure/platform/DeepLinkAdapter");
    const adapter = deepLink as IDeepLinkProvider;
    expect(hasMethod(adapter, "onOpen")).toBe(true);
  });

  it("cleanup is a function in browser context", async () => {
    vi.doMock("../src/lib/capacitor-runtime", () => ({
      isCapacitorNative: vi.fn(() => false),
    }));
    const { deepLink } = await import("../src/infrastructure/platform/DeepLinkAdapter");
    const cleanup = deepLink.onOpen(vi.fn());
    expect(typeof cleanup).toBe("function");
  });
});
