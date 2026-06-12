import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  CLERK_NATIVE_REDIRECT_ORIGINS,
  clerkProviderPropsForRuntime,
} from "../src/lib/clerk-capacitor-config";

vi.mock("@/lib/capacitor-runtime", () => ({
  isCapacitorNative: vi.fn(() => false),
}));

import { isCapacitorNative } from "@/lib/capacitor-runtime";

describe("clerkProviderPropsForRuntime", () => {
  beforeEach(() => {
    vi.mocked(isCapacitorNative).mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("includes capacitor origins when running in the native shell", () => {
    vi.mocked(isCapacitorNative).mockReturnValue(true);
    const props = clerkProviderPropsForRuntime("pk_live_test");
    expect(props.allowedRedirectOrigins).toEqual([...CLERK_NATIVE_REDIRECT_ORIGINS]);
  });

  it("forces non-standard-browser clerk-js in the native shell (cookie mode cannot complete system-browser OAuth)", () => {
    vi.mocked(isCapacitorNative).mockReturnValue(true);
    expect(clerkProviderPropsForRuntime("pk_live_test").standardBrowser).toBe(false);
  });

  it("leaves the web runtime in default (cookie) mode", () => {
    expect(clerkProviderPropsForRuntime("pk_live_test").standardBrowser).toBeUndefined();
  });
});
