/**
 * @vitest-environment happy-dom
 *
 * CodeRabbit finding (PR #166): `@capgo/capacitor-nfc` exposes no Android scan
 * timeout, cancel, or error event. Without a bounded wait, `lockNfcTag()` on
 * Android could remain pending forever when no tag is presented, leaving the
 * listener registered and reader mode enabled. This covers the fix: a timeout
 * that tears down the listener + scanning session and rejects, shared cleanup
 * on listener-registration failure, and no leaked timer on a successful lock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/capacitor-runtime", () => ({
  isCapacitorNative: () => true,
  capacitorPlatform: () => "android",
}));

const mockStartScanning = vi.fn();
const mockStopScanning = vi.fn();
const mockMakeReadOnly = vi.fn();
const mockAddListener = vi.fn();

vi.mock("@capgo/capacitor-nfc", () => ({
  CapacitorNfc: {
    startScanning: (...args: unknown[]) => mockStartScanning(...args),
    stopScanning: (...args: unknown[]) => mockStopScanning(...args),
    makeReadOnly: (...args: unknown[]) => mockMakeReadOnly(...args),
    addListener: (...args: unknown[]) => mockAddListener(...args),
  },
}));

vi.mock("@capacitor/core", () => ({
  registerPlugin: () => ({
    lockTag: vi.fn(),
  }),
}));

import { lockNfcTag } from "@/lib/nfc-lock";

describe("lockNfcTag — Android scan timeout + cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockStartScanning.mockReset().mockResolvedValue(undefined);
    mockStopScanning.mockReset().mockResolvedValue(undefined);
    mockMakeReadOnly.mockReset().mockResolvedValue(undefined);
    mockAddListener.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects and tears down the listener + scan session when no tag is presented", async () => {
    const removeListener = vi.fn().mockResolvedValue(undefined);
    mockAddListener.mockResolvedValue({ remove: removeListener });

    const pending = lockNfcTag();
    const assertion = expect(pending).rejects.toThrow("nfc_lock_timeout");

    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;

    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(mockStopScanning).toHaveBeenCalledTimes(1);
  });

  it("resolves on a successful lock and does not fire the timeout afterward", async () => {
    let fireTag: (() => void) | undefined;
    const removeListener = vi.fn().mockResolvedValue(undefined);
    mockAddListener.mockImplementation(async (_event: string, cb: () => void) => {
      fireTag = cb;
      return { remove: removeListener };
    });

    const pending = lockNfcTag();
    await vi.waitFor(() => expect(fireTag).toBeDefined());
    fireTag?.();

    await expect(pending).resolves.toEqual({ alreadyLocked: false });
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(mockStopScanning).toHaveBeenCalledTimes(1);

    // Timer must be cleared — advancing past the timeout must not throw/reject
    // again or perform a second cleanup pass.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockStopScanning).toHaveBeenCalledTimes(1);
  });

  it("cleans up and rejects when listener registration itself fails", async () => {
    mockAddListener.mockRejectedValue(new Error("listener_registration_failed"));

    const pending = lockNfcTag();
    await expect(pending).rejects.toThrow("listener_registration_failed");
    expect(mockStopScanning).toHaveBeenCalledTimes(1);
  });
});
