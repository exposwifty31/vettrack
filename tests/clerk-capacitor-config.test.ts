import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { enUS, heIL } from "@clerk/localizations";
import {
  CLERK_NATIVE_REDIRECT_ORIGINS,
  clerkLocalizationForLocale,
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

  it("allows the capacitor: protocol for clerk-js session-sync navigation (else boot reload-loops)", () => {
    vi.mocked(isCapacitorNative).mockReturnValue(true);
    expect(clerkProviderPropsForRuntime("pk_live_test").allowedRedirectProtocols).toContain("capacitor:");
  });

  it("leaves the web runtime in default (cookie) mode", () => {
    expect(clerkProviderPropsForRuntime("pk_live_test").standardBrowser).toBeUndefined();
  });

  it("passes the Hebrew Clerk localization (heIL) when the app locale is Hebrew", () => {
    expect(clerkProviderPropsForRuntime("pk_live_test", "he").localization).toBe(heIL);
  });

  it("passes the English Clerk localization (enUS) when the app locale is English", () => {
    expect(clerkProviderPropsForRuntime("pk_live_test", "en").localization).toBe(enUS);
  });

  it("wires the same localization for the native-shell runtime", () => {
    vi.mocked(isCapacitorNative).mockReturnValue(true);
    expect(clerkProviderPropsForRuntime("pk_live_test", "he").localization).toBe(heIL);
    expect(clerkProviderPropsForRuntime("pk_live_test", "en").localization).toBe(enUS);
  });
});

describe("clerkLocalizationForLocale", () => {
  it("returns heIL for the Hebrew locale", () => {
    expect(clerkLocalizationForLocale("he")).toBe(heIL);
  });

  it("returns enUS for the English locale", () => {
    expect(clerkLocalizationForLocale("en")).toBe(enUS);
  });
});
