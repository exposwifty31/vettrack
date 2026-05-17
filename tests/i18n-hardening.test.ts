import { describe, it, expect } from "vitest";
import type { Request } from "express";
import {
  clearLocaleCache,
  getLocaleDictionaries,
  getLocaleReadCount,
  loadLocale,
} from "../lib/i18n/loader.js";
import { interpolate, translate } from "../lib/i18n/index.js";
import { resolveRequestLocale } from "../lib/i18n/middleware.js";
import { DEFAULT_LOCALE, INITIAL_LOCALE } from "../lib/i18n/types.js";

describe("Fallback + Missing Key Warning", () => {
  it("Falls back to English dictionary when key missing in locale", () => {
    clearLocaleCache();
    const heOnly = { greet: { hello: "שלום" } };
    const enFallback = { greet: { hello: "Hello", goodbye: "Goodbye" } };
    const warnMessages: string[] = [];
    const warn = (message: string) => warnMessages.push(message);

    const fromFallback = translate(heOnly, "greet.goodbye", undefined, {
      fallbackDict: enFallback,
      locale: "he",
      warn,
    });
    expect(fromFallback === "Goodbye").toBeTruthy();
  });

  it("Falls back to key when missing in locale + fallback", () => {
    clearLocaleCache();
    const heOnly = { greet: { hello: "שלום" } };
    const enFallback = { greet: { hello: "Hello", goodbye: "Goodbye" } };
    const warnMessages: string[] = [];
    const warn = (message: string) => warnMessages.push(message);

    const missingEverywhere = translate(heOnly, "greet.unknown", undefined, {
      fallbackDict: enFallback,
      locale: "he",
      warn,
    });
    expect(missingEverywhere === "greet.unknown").toBeTruthy();
  });

  it("Missing key warning includes key and locale", () => {
    clearLocaleCache();
    const heOnly = { greet: { hello: "שלום" } };
    const enFallback = { greet: { hello: "Hello", goodbye: "Goodbye" } };
    const warnMessages: string[] = [];
    const warn = (message: string) => warnMessages.push(message);

    translate(heOnly, "greet.unknown", undefined, {
      fallbackDict: enFallback,
      locale: "he",
      warn,
    });
    expect(
      warnMessages.some((m) => m.includes("greet.unknown") && m.includes("he")),
    ).toBeTruthy();
  });
});

describe("Interpolation + Pluralization", () => {
  it("Interpolation replaces parameters", () => {
    const interpolated = interpolate("Hello {name}", { name: "Dan" });
    expect(interpolated === "Hello Dan").toBeTruthy();
  });

  it("Pluralization uses 'one' branch", () => {
    const pluralTemplate = "{count, plural, one {# item} other {# items}}";
    const one = interpolate(pluralTemplate, { count: 1 }).replace("#", "1");
    expect(one === "1 item").toBeTruthy();
  });

  it("Pluralization uses 'other' branch", () => {
    const pluralTemplate = "{count, plural, one {# item} other {# items}}";
    const many = interpolate(pluralTemplate, { count: 4 }).replace("#", "4");
    expect(many === "4 items").toBeTruthy();
  });

  it("Pluralization substitutes the ICU `#` token with the count (no manual .replace needed)", () => {
    // Regression guard for the Bugbot finding on PR #338: prior to the
    // fix, `interpolate` returned the matched branch verbatim, leaving
    // literal `#` in the output. The fix substitutes `#` with the
    // numeric value before returning.
    const pluralTemplate = "{count, plural, one {# item} other {# items}}";
    expect(interpolate(pluralTemplate, { count: 1 })).toBe("1 item");
    expect(interpolate(pluralTemplate, { count: 4 })).toBe("4 items");
    expect(interpolate(pluralTemplate, { count: 0 })).toBe("0 items");
  });

  it("Pluralization substitutes ALL `#` occurrences within a branch", () => {
    const pluralTemplate = "{n, plural, one {# of # found} other {# of # found}}";
    expect(interpolate(pluralTemplate, { n: 3 })).toBe("3 of 3 found");
  });
});

describe("Locale Switching + Loader Cache", () => {
  it("Locale switching resolves English", () => {
    clearLocaleCache();
    const enBundle = getLocaleDictionaries("en");
    expect(enBundle.locale === "en").toBeTruthy();
  });

  it("Locale switching resolves Hebrew", () => {
    clearLocaleCache();
    const heBundle = getLocaleDictionaries("he");
    expect(heBundle.locale === "he").toBeTruthy();
  });

  it("English locale is served from cache after first load", () => {
    clearLocaleCache();
    getLocaleDictionaries("en");
    const enBefore = getLocaleReadCount("en");
    loadLocale("en");
    expect(getLocaleReadCount("en") === enBefore).toBeTruthy();
  });

  it("Hebrew locale is served from cache after first load", () => {
    clearLocaleCache();
    getLocaleDictionaries("he");
    const heBefore = getLocaleReadCount("he");
    loadLocale("he");
    expect(getLocaleReadCount("he") === heBefore).toBeTruthy();
  });
});

function makeRequest(headers: Record<string, string | string[] | undefined> = {}): Request {
  return { headers } as unknown as Request;
}

describe("INITIAL_LOCALE resolver default (Phase 6 PR 6.2)", () => {
  it("DEFAULT_LOCALE stays anchored to English (dictionary-fallback role)", () => {
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("INITIAL_LOCALE is Hebrew (resolver-default role)", () => {
    expect(INITIAL_LOCALE).toBe("he");
  });

  it("resolveRequestLocale with no signals returns INITIAL_LOCALE (he)", () => {
    const req = makeRequest({});
    expect(resolveRequestLocale(req)).toBe("he");
  });

  it("resolveRequestLocale honors Accept-Language: en", () => {
    const req = makeRequest({ "accept-language": "en-US,en;q=0.9" });
    expect(resolveRequestLocale(req)).toBe("en");
  });

  it("resolveRequestLocale honors Accept-Language: he", () => {
    const req = makeRequest({ "accept-language": "he-IL,he;q=0.9" });
    expect(resolveRequestLocale(req)).toBe("he");
  });

  it("resolveRequestLocale honors x-locale override", () => {
    const req = makeRequest({ "x-locale": "en" });
    expect(resolveRequestLocale(req)).toBe("en");
  });

  it("resolveRequestLocale prefers explicit user pref over headers", () => {
    const req = makeRequest({ "x-locale": "en", "accept-language": "en" });
    expect(resolveRequestLocale(req, "he")).toBe("he");
  });

  it("resolveRequestLocale routes unrecognized Accept-Language values through the loader's invalid-string fallback (DEFAULT_LOCALE)", () => {
    // Phase 6 intentionally keeps `normalizeLocale` returning DEFAULT_LOCALE
    // for invalid strings — only the "no signal" path uses INITIAL_LOCALE.
    const req = makeRequest({ "accept-language": "zz-ZZ" });
    expect(resolveRequestLocale(req)).toBe("en");
  });
});

describe("Loader fallback dictionary remains anchored to DEFAULT_LOCALE (en)", () => {
  it("getLocaleDictionaries('he') returns English as the fallback dict", () => {
    clearLocaleCache();
    const bundle = getLocaleDictionaries("he");
    const enBundle = getLocaleDictionaries("en");
    expect(bundle.fallback).toBe(enBundle.primary);
  });

  it("getLocaleDictionaries('en') returns English as both primary and fallback", () => {
    clearLocaleCache();
    const bundle = getLocaleDictionaries("en");
    expect(bundle.primary).toBe(bundle.fallback);
  });
});
