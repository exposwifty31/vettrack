import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/capacitor-runtime", () => ({
  isCapacitorNative: vi.fn(() => false),
}));

vi.mock("@capacitor/app", () => ({
  App: {
    getInfo: vi.fn(),
  },
}));

vi.mock("@/lib/auth-fetch", () => ({
  authFetch: vi.fn(),
}));

import { App } from "@capacitor/app";
import { authFetch } from "@/lib/auth-fetch";
import { isCapacitorNative } from "@/lib/capacitor-runtime";
import {
  compareVersions,
  getBundledAppVersion,
  resolveDisplayAppVersion,
  resolveServerAppVersion,
} from "@/lib/app-version";

describe("app-version", () => {
  beforeEach(() => {
    vi.mocked(isCapacitorNative).mockReturnValue(false);
    vi.mocked(App.getInfo).mockReset();
    vi.mocked(authFetch).mockReset();
  });

  it("compareVersions reports greater when first semver is newer", () => {
    expect(compareVersions("1.1.2", "1.0.1")).toBeGreaterThan(0);
  });

  it("compareVersions reports equal for matching semver", () => {
    expect(compareVersions("1.0.1", "1.0.1")).toBe(0);
  });

  it("resolveDisplayAppVersion uses bundled version on web", async () => {
    await expect(resolveDisplayAppVersion()).resolves.toBe(getBundledAppVersion());
  });

  it("resolveDisplayAppVersion uses native marketing version in Capacitor", async () => {
    vi.mocked(isCapacitorNative).mockReturnValue(true);
    vi.mocked(App.getInfo).mockResolvedValue({ version: "1.0.1", build: "16", id: "uk.vettrack.app", name: "VetTrack" });
    await expect(resolveDisplayAppVersion()).resolves.toBe("1.0.1");
  });

  it("resolveServerAppVersion returns server semver on success", async () => {
    vi.mocked(authFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ version: "1.1.2" }),
    } as Response);
    await expect(resolveServerAppVersion()).resolves.toBe("1.1.2");
  });

  it("resolveServerAppVersion returns null on failure", async () => {
    vi.mocked(authFetch).mockRejectedValue(new Error("offline"));
    await expect(resolveServerAppVersion()).resolves.toBeNull();
  });
});
