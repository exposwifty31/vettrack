import { describe, it, expect, vi, beforeEach } from "vitest";

const mockIsNfcSupported = vi.fn().mockResolvedValue(true);
const mockReadNfcOnce = vi.fn().mockResolvedValue({ text: "eq-123", url: null, tagId: null });
const mockStartNfcScanSession = vi.fn().mockResolvedValue({ stop: vi.fn() });

vi.mock("../src/lib/nfc-platform", () => ({
  isNfcSupported: mockIsNfcSupported,
  readNfcOnce: mockReadNfcOnce,
  startNfcScanSession: mockStartNfcScanSession,
}));

describe("NfcAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("delegates isSupported to nfc-platform", async () => {
    const { nfc } = await import("../src/infrastructure/platform/NfcAdapter");
    const result = await nfc.isSupported();
    expect(mockIsNfcSupported).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("delegates readOnce with options", async () => {
    const { nfc } = await import("../src/infrastructure/platform/NfcAdapter");
    const payload = await nfc.readOnce({ timeoutMs: 5000 });
    expect(mockReadNfcOnce).toHaveBeenCalledWith({ timeoutMs: 5000, signal: undefined });
    expect(payload.text).toBe("eq-123");
  });

  it("delegates startSession and returns session handle", async () => {
    const onRead = vi.fn();
    const { nfc } = await import("../src/infrastructure/platform/NfcAdapter");
    const session = await nfc.startSession({ onRead });
    expect(mockStartNfcScanSession).toHaveBeenCalledWith({ onRead, signal: undefined });
    expect(typeof session.stop).toBe("function");
  });
});
