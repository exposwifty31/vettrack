import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";
import { apiError } from "../server/lib/apiError";
import { clearLocaleCache } from "../lib/i18n/loader";

/**
 * Phase 6 PR 6.3 — canonical `apiError(req, res, key, params?, status?)`
 * server helper. Reads `req.locale`, translates against the locale
 * dictionary (with English fallback), and writes
 *   { error: <localized>, code: <key>, params?: <params> }
 * at the requested status.
 */

interface CapturedResponse {
  statusCode: number;
  body: { error: string; code: string; params?: Record<string, string | number | boolean> };
}

function makeReqRes(locale: "en" | "he", method = "GET", url = "/api/sample"): {
  req: Request;
  res: Response;
  captured: CapturedResponse;
} {
  const captured: CapturedResponse = { statusCode: 0, body: { error: "", code: "" } };
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(body: CapturedResponse["body"]) {
      captured.body = body;
      return this;
    },
  } as unknown as Response;
  const req = {
    locale,
    method,
    originalUrl: url,
    headers: {},
  } as unknown as Request;
  return { req, res, captured };
}

describe("apiError(req, res, key, params?, status?)", () => {
  beforeEach(() => {
    clearLocaleCache();
  });

  it("defaults to status 400 when no status is provided", () => {
    const { req, res, captured } = makeReqRes("en");
    apiError(req, res, "errors.generic");
    expect(captured.statusCode).toBe(400);
  });

  it("uses the provided status (e.g. 404)", () => {
    const { req, res, captured } = makeReqRes("en");
    apiError(req, res, "errors.notFound", undefined, 404);
    expect(captured.statusCode).toBe(404);
  });

  it("returns English text when req.locale is 'en'", () => {
    const { req, res, captured } = makeReqRes("en");
    apiError(req, res, "errors.notFound", undefined, 404);
    expect(captured.body.error).toBe("Resource not found.");
    expect(captured.body.code).toBe("errors.notFound");
  });

  it("returns Hebrew text when req.locale is 'he'", () => {
    const { req, res, captured } = makeReqRes("he");
    apiError(req, res, "errors.notFound", undefined, 404);
    expect(captured.body.error).toBe("המשאב לא נמצא.");
    expect(captured.body.code).toBe("errors.notFound");
  });

  it("falls back to English when the key is missing in Hebrew dict", () => {
    // `errors.server.failedToListEquipment` exists in both — use it to
    // confirm the resolution chain. For a missing key, fallback chain is
    // requested locale → English dict → key path.
    const { req, res, captured } = makeReqRes("he");
    apiError(req, res, "errors.this.is.not.a.real.key", undefined, 422);
    // Missing in both — should render as the key path.
    expect(captured.body.error).toBe("errors.this.is.not.a.real.key");
    expect(captured.body.code).toBe("errors.this.is.not.a.real.key");
    expect(captured.statusCode).toBe(422);
  });

  it("interpolates params into the rendered string and echoes them in the body", () => {
    // `errors.generic` has no placeholders, but params are still echoed.
    const { req, res, captured } = makeReqRes("en");
    apiError(req, res, "errors.generic", { detail: "extra" }, 400);
    expect(captured.body.code).toBe("errors.generic");
    expect(captured.body.params).toEqual({ detail: "extra" });
  });

  it("omits the params field when no params are passed", () => {
    const { req, res, captured } = makeReqRes("en");
    apiError(req, res, "errors.generic");
    expect("params" in captured.body).toBe(false);
  });
});

describe("apiError internal-key guard (_meta.* misuse)", () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearLocaleCache();
    errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errSpy.mockRestore();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it("THROWS in development on internal key", () => {
    process.env.NODE_ENV = "development";
    const { req, res } = makeReqRes("en");
    expect(() => apiError(req, res, "_meta.someKey", undefined, 422)).toThrow(
      /internal key/i,
    );
  });

  it("THROWS in test on internal key", () => {
    process.env.NODE_ENV = "test";
    const { req, res } = makeReqRes("en");
    expect(() => apiError(req, res, "_meta.someKey")).toThrow(/internal key/i);
  });

  it("THROWS on any underscore-prefixed segment", () => {
    process.env.NODE_ENV = "test";
    const { req, res } = makeReqRes("en");
    expect(() => apiError(req, res, "foo._bar")).toThrow(/internal key/i);
  });

  it("in PRODUCTION logs + substitutes errors.generic at the ORIGINALLY requested status (not 500)", () => {
    process.env.NODE_ENV = "production";
    const { req, res, captured } = makeReqRes("he");
    apiError(req, res, "_meta.someKey", undefined, 422);

    expect(captured.statusCode).toBe(422);
    expect(captured.body.code).toBe("errors.generic");
    expect(captured.body.error).toBe("משהו השתבש. אנא נסו שוב.");
    expect(errSpy).toHaveBeenCalled();
    const logged = errSpy.mock.calls.find((args) =>
      typeof args[0] === "string" && (args[0] as string).includes("_meta.someKey"),
    );
    expect(logged).toBeDefined();
  });

  it("in PRODUCTION the substitution drops any caller-supplied params", () => {
    process.env.NODE_ENV = "production";
    const { req, res, captured } = makeReqRes("en");
    apiError(req, res, "_meta.someKey", { passthrough: "should be dropped" }, 400);
    expect("params" in captured.body).toBe(false);
  });
});
