/**
 * Audit finding §1 — authenticated-request locale precision.
 *
 * RN sends `X-Locale` on every authenticated request. On the Clerk path the
 * server mapped the (usually absent) `locale` session claim through
 * `normalizeLocale`, which is TOTAL: it collapses "the claim said en" and
 * "there was no claim at all" into the same non-null "en". That defaulted
 * value then reached `resolveRequestLocale(req, userLocale)` as a
 * user preference and outranked the explicit header.
 *
 * The contract asserted here: an EXPRESSED preference still wins over the
 * header; an ABSENT (or uninterpretable) one must not.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { normalizeLocale, normalizeLocaleStrict } from "../lib/i18n/loader.js";
import { resolveRequestLocale } from "../lib/i18n/middleware.js";
import { INITIAL_LOCALE, DEFAULT_LOCALE } from "../lib/i18n/types.js";

type JsonBody = Record<string, unknown>;

function makeReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function makeRes() {
  const res = {
    status() {
      return this;
    },
    json(_payload: JsonBody) {
      return this;
    },
  } as unknown as Response;
  return res;
}

const noopNext: NextFunction = () => {};

const BASE_USER = {
  id: "u1",
  clerkId: "c1",
  email: "user@vettrack.dev",
  name: "User One",
  role: "technician",
  status: "active",
  clinicId: "clinic-1",
} as const;

let createRequireAuth: (
  resolver: () => Promise<unknown>,
) => (req: Request, res: Response, next: NextFunction) => Promise<void>;
let resolveClerkLocalePreference: (claims: Record<string, unknown> | undefined) => string | undefined;

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://user:pass@localhost:5432/vettrack_test";
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  const mod = await import("../server/middleware/auth.js");
  createRequireAuth = mod.createRequireAuth;
  resolveClerkLocalePreference = mod.resolveClerkLocalePreference;
}, 30000);

/**
 * Drives the REAL composition: the production claim->preference mapping feeding
 * the production `requireAuth` -> `resolveRequestLocale` locale assignment.
 */
async function localeForClerkRequest(
  sessionClaims: Record<string, unknown> | undefined,
  headers: Record<string, string>,
): Promise<string | undefined> {
  const middleware = createRequireAuth(async () => ({
    ok: true,
    user: { ...BASE_USER, locale: resolveClerkLocalePreference(sessionClaims) },
  }));
  const req = makeReq(headers);
  await middleware(req, makeRes(), noopNext);
  return req.locale;
}

describe("authenticated locale: absent Clerk claim must not outrank an explicit X-Locale", () => {
  it("honours X-Locale: he when the session carries no locale claim", async () => {
    expect(await localeForClerkRequest({}, { "x-locale": "he" })).toBe("he");
  });

  it("honours X-Locale: en when the session carries no locale claim", async () => {
    expect(await localeForClerkRequest({}, { "x-locale": "en" })).toBe("en");
  });

  it("honours X-Locale when sessionClaims is entirely undefined", async () => {
    expect(await localeForClerkRequest(undefined, { "x-locale": "he" })).toBe("he");
  });

  it("treats an unsupported claim value as no expressed preference", async () => {
    expect(await localeForClerkRequest({ locale: "zz-ZZ" }, { "x-locale": "he" })).toBe("he");
  });

  it("still honours Accept-Language when there is no claim and no X-Locale", async () => {
    expect(await localeForClerkRequest({}, { "accept-language": "en-US,en;q=0.9" })).toBe("en");
  });

  it("falls back to INITIAL_LOCALE when the session carries no claim and no header signal", async () => {
    // Deliberate collateral change: previously the defaulted claim forced "en"
    // here. INITIAL_LOCALE is the documented no-signal default.
    expect(await localeForClerkRequest({}, {})).toBe(INITIAL_LOCALE);
  });
});

describe("authenticated locale: a real preference still outranks the header", () => {
  it("keeps user preference he over X-Locale: en", async () => {
    expect(await localeForClerkRequest({ locale: "he" }, { "x-locale": "en" })).toBe("he");
  });

  it("keeps user preference en over X-Locale: he", async () => {
    expect(await localeForClerkRequest({ locale: "en" }, { "x-locale": "he" })).toBe("en");
  });

  it("reads the namespaced clerk locale claim as a real preference", async () => {
    expect(
      await localeForClerkRequest({ "https://clerk.dev/locale": "he" }, { "x-locale": "en" }),
    ).toBe("he");
  });
});

describe("dev-bypass auth mode keeps honouring X-Locale", () => {
  it("honours X-Locale when the resolved user has no locale field at all", async () => {
    const middleware = createRequireAuth(async () => ({ ok: true, user: { ...BASE_USER } }));
    const req = makeReq({ "x-locale": "en" });
    await middleware(req, makeRes(), noopNext);
    expect(req.locale).toBe("en");
  });
});

describe("resolveRequestLocale: a blank user preference is not a preference", () => {
  it("falls through an empty-string userLocale to the X-Locale header", () => {
    expect(resolveRequestLocale(makeReq({ "x-locale": "he" }), "")).toBe("he");
  });

  it("falls through a whitespace-only userLocale to the X-Locale header", () => {
    expect(resolveRequestLocale(makeReq({ "x-locale": "en" }), "   ")).toBe("en");
  });
});

describe("normalizeLocale stays total for its existing frontend+backend consumers", () => {
  it("still returns DEFAULT_LOCALE for an absent value", () => {
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE);
  });

  it("still returns DEFAULT_LOCALE for an unsupported value", () => {
    expect(normalizeLocale("zz-ZZ")).toBe(DEFAULT_LOCALE);
  });

  it("still normalizes a region-tagged supported value", () => {
    expect(normalizeLocale("he-IL")).toBe("he");
  });

  it("still warns when an unsupported value is coerced to DEFAULT_LOCALE", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      normalizeLocale("zz-ZZ");
      expect(warn.mock.calls.some(([m]) => String(m).includes("zz-ZZ"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("stays silent when there was no value to coerce", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      normalizeLocale(undefined);
      normalizeLocale("");
      normalizeLocale("   ");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("normalizeLocaleStrict distinguishes present from defaulted", () => {
  it("returns undefined for an absent value", () => {
    expect(normalizeLocaleStrict(undefined)).toBeUndefined();
  });

  it("returns undefined for an unsupported value", () => {
    expect(normalizeLocaleStrict("zz-ZZ")).toBeUndefined();
  });

  it("returns the normalized locale for a supported value", () => {
    expect(normalizeLocaleStrict("he-IL")).toBe("he");
  });
});

/**
 * The SAME defect class, two legs further down the same `??` chain.
 *
 * `resolveRequestLocale` normalised `userLocale` so that a blank value stops
 * outranking weaker-but-explicit signals — but `requestOverride` and
 * `acceptLanguageValue` were left raw. `??` falls through only on null and
 * undefined, and an Express header that is present-but-empty is `""`, which is
 * neither. So an empty `X-Locale` SWALLOWS `Accept-Language` entirely, and an
 * empty `Accept-Language` swallows INITIAL_LOCALE — both landing on
 * `normalizeLocale("")`, i.e. English, in a Hebrew-default app.
 *
 * Fixing only the first leg is fixing an instance, not the class.
 */
describe("resolveRequestLocale — a present-but-empty header is not a preference", () => {
  const reqWith = (headers: Record<string, string | string[] | undefined>) =>
    ({ headers }) as unknown as Parameters<typeof resolveRequestLocale>[0];

  it("an empty X-Locale must not swallow Accept-Language", () => {
    expect(resolveRequestLocale(reqWith({ "x-locale": "", "accept-language": "he-IL" }))).toBe("he");
  });

  it("a whitespace-only X-Locale must not swallow Accept-Language", () => {
    expect(resolveRequestLocale(reqWith({ "x-locale": "   ", "accept-language": "he-IL" }))).toBe("he");
  });

  it("an empty first value in a repeated X-Locale must not swallow Accept-Language", () => {
    expect(resolveRequestLocale(reqWith({ "x-locale": ["", "en"], "accept-language": "he-IL" }))).toBe("he");
  });

  it("an empty Accept-Language falls through to INITIAL_LOCALE, not to English", () => {
    expect(resolveRequestLocale(reqWith({ "accept-language": "" }))).toBe(INITIAL_LOCALE);
  });

  it("a real X-Locale still outranks Accept-Language", () => {
    expect(resolveRequestLocale(reqWith({ "x-locale": "en", "accept-language": "he-IL" }))).toBe("en");
  });
});

/**
 * `sessionClaims` is untrusted JWT payload, so `as string | undefined` is a
 * promise rather than a check. A non-string claim survives `??` (only null and
 * undefined fall through), reaches `parseLocaleTag`, and throws on `.split` —
 * a 500 on the authenticated path from a value the caller controls.
 *
 * And an empty-or-unsupported standard claim must not shadow the namespaced
 * one: `?? ` cannot express "try the next SOURCE", only "the next non-nullish
 * value", which is the same distinction the header chain needed.
 */
describe("resolveClerkLocalePreference — claims are untrusted input", () => {
  it.each([
    ["a number", 5],
    ["an object", { he: true }],
    ["an array", ["he"]],
    ["a boolean", true],
    ["null", null],
  ])("survives %s claim without throwing", (_label, claim) => {
    expect(() =>
      resolveClerkLocalePreference({ locale: claim } as Record<string, unknown>),
    ).not.toThrow();
    expect(resolveClerkLocalePreference({ locale: claim } as Record<string, unknown>)).toBeUndefined();
  });

  it("falls through to the namespaced claim when the standard one is empty", () => {
    expect(
      resolveClerkLocalePreference({ locale: "", "https://clerk.dev/locale": "he-IL" }),
    ).toBe("he");
  });

  it("falls through to the namespaced claim when the standard one is unsupported", () => {
    expect(
      resolveClerkLocalePreference({ locale: "zz-ZZ", "https://clerk.dev/locale": "he" }),
    ).toBe("he");
  });

  it("still prefers a resolvable standard claim", () => {
    expect(
      resolveClerkLocalePreference({ locale: "en", "https://clerk.dev/locale": "he" }),
    ).toBe("en");
  });
});
