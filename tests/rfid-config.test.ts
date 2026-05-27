import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/db.js", () => ({ db: {} }));

const mockGetServerConfigValue = vi.fn();
vi.mock("../server/lib/server-config.js", () => ({
  getServerConfigValue: (...args: unknown[]) => mockGetServerConfigValue(...args),
}));

import {
  __resetRfidConfigCacheForTests,
  isRfidIngestEnabled,
} from "../server/lib/rfid/config.js";

beforeEach(() => {
  __resetRfidConfigCacheForTests();
  mockGetServerConfigValue.mockReset();
});

afterEach(() => {
  __resetRfidConfigCacheForTests();
});

describe("isRfidIngestEnabled", () => {
  it("defaults to false when config row missing", async () => {
    mockGetServerConfigValue.mockResolvedValue(null);
    expect(await isRfidIngestEnabled("clinic-a")).toBe(false);
  });

  it("returns true when config is \"true\"", async () => {
    mockGetServerConfigValue.mockResolvedValue("true");
    expect(await isRfidIngestEnabled("clinic-a")).toBe(true);
  });

  it("caches within TTL window", async () => {
    mockGetServerConfigValue.mockResolvedValue("true");
    expect(await isRfidIngestEnabled("clinic-a")).toBe(true);
    expect(await isRfidIngestEnabled("clinic-a")).toBe(true);
    expect(mockGetServerConfigValue).toHaveBeenCalledTimes(1);
  });

  it("refreshes after TTL expires", async () => {
    vi.useFakeTimers();
    mockGetServerConfigValue.mockResolvedValueOnce("true").mockResolvedValueOnce("false");
    expect(await isRfidIngestEnabled("clinic-a")).toBe(true);
    vi.advanceTimersByTime(10_001);
    expect(await isRfidIngestEnabled("clinic-a")).toBe(false);
    vi.useRealTimers();
  });
});
