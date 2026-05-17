import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { translate } from "../lib/i18n/index";

/**
 * Dev-only missing-key dedupe (Phase 6 §15 PR 6.1).
 *
 * `translate()` warns on missing keys but only in development (gated by
 * `process.env.NODE_ENV === "development"`) and only once per
 * `(key, locale)` pair. The custom-warn override path is unaffected.
 */

describe("Missing-key dev warn — dedupe + NODE_ENV gating", () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it("warns once in development, deduped on subsequent calls for the same key+locale", () => {
    process.env.NODE_ENV = "development";

    translate({}, "some.missing.key", undefined, { locale: "he" });
    translate({}, "some.missing.key", undefined, { locale: "he" });
    translate({}, "some.missing.key", undefined, { locale: "he" });

    const callsForKey = warnSpy.mock.calls.filter((args) =>
      typeof args[0] === "string" && (args[0] as string).includes("some.missing.key"),
    );
    expect(callsForKey.length).toBe(1);
  });

  it("warns separately for different locales of the same missing key", () => {
    process.env.NODE_ENV = "development";

    translate({}, "another.missing.key", undefined, { locale: "he" });
    translate({}, "another.missing.key", undefined, { locale: "en" });

    const callsHe = warnSpy.mock.calls.filter((args) =>
      typeof args[0] === "string" &&
      (args[0] as string).includes("another.missing.key") &&
      (args[0] as string).includes('locale "he"'),
    );
    const callsEn = warnSpy.mock.calls.filter((args) =>
      typeof args[0] === "string" &&
      (args[0] as string).includes("another.missing.key") &&
      (args[0] as string).includes('locale "en"'),
    );
    expect(callsHe.length).toBe(1);
    expect(callsEn.length).toBe(1);
  });

  it("is silent in production (no console.warn)", () => {
    process.env.NODE_ENV = "production";

    translate({}, "prod.missing.key", undefined, { locale: "he" });
    translate({}, "prod.missing.key", undefined, { locale: "en" });

    const callsForKey = warnSpy.mock.calls.filter((args) =>
      typeof args[0] === "string" && (args[0] as string).includes("prod.missing.key"),
    );
    expect(callsForKey.length).toBe(0);
  });

  it("custom warn override still fires regardless of NODE_ENV", () => {
    process.env.NODE_ENV = "production";

    const captured: string[] = [];
    translate({}, "custom.missing.key", undefined, {
      locale: "he",
      warn: (m) => captured.push(m),
    });
    translate({}, "custom.missing.key", undefined, {
      locale: "he",
      warn: (m) => captured.push(m),
    });

    expect(captured.length).toBe(2);
    expect(captured.every((m) => m.includes("custom.missing.key") && m.includes("he"))).toBe(true);
  });

  it("returns the key path unchanged when the key is missing in dict + fallback", () => {
    process.env.NODE_ENV = "test";
    const result = translate({}, "no.such.key", undefined, { locale: "he" });
    expect(result).toBe("no.such.key");
  });
});
