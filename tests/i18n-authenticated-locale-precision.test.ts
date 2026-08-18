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
import { describe, it, expect, beforeAll } from "vitest";
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
  return (req as Request & { locale?: string }).locale;
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
    expect((req as Request & { locale?: string }).locale).toBe("en");
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
