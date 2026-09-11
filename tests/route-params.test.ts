/**
 * Express 5 widens `req.params.x` to `string | string[]` (path-to-regexp v8 can
 * yield an array for a wildcard/repeated segment). `param(req, name)` is the one
 * boundary that narrows it back to a non-empty string for the 187 sites that
 * read a route param, throwing a typed 400 instead of letting an array reach a
 * `WHERE id = $1`. The terminal error handler owns the response shape, so the
 * helper stays envelope-agnostic and one-line at every call site.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import express from "express";
import type { NextFunction, Request, Response } from "express";

import { RouteParamError, param } from "../server/lib/route-params.js";
import { terminalErrorHandler } from "../server/lib/body-parser-errors.js";

describe("param()", () => {
  it("returns the string value as-is (no trimming — validateUuid trims only for its own check)", () => {
    expect(param({ params: { id: "abc-123" } }, "id")).toBe("abc-123");
    expect(param({ params: { id: " padded " } }, "id")).toBe(" padded ");
  });

  it("throws a 400 RouteParamError when the segment matched as an array", () => {
    let caught: unknown;
    try {
      param({ params: { id: ["a", "b"] } }, "id");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RouteParamError);
    expect(caught).toMatchObject({ status: 400, code: "INVALID_ROUTE_PARAM", param: "id", reason: "array" });
  });

  it("throws when the param is missing or empty", () => {
    expect(() => param({ params: {} }, "id")).toThrow(RouteParamError);
    expect(() => param({ params: { id: undefined } }, "id")).toThrowError(expect.objectContaining({ reason: "missing" }));
    expect(() => param({ params: { id: "" } }, "id")).toThrowError(expect.objectContaining({ reason: "empty" }));
  });

  it("accepts the plain-object mock requests the route tests already use (structural type, no Express import needed)", () => {
    const mockReq = { params: { equipmentId: "eq-1" }, body: {}, query: {} };
    expect(param(mockReq, "equipmentId")).toBe("eq-1");
  });
});

describe("terminalErrorHandler maps RouteParamError to 400", () => {
  function res() {
    const captured: { status?: number; body?: unknown } = {};
    const r = {
      headersSent: false,
      status(code: number) {
        captured.status = code;
        return this;
      },
      json(body: unknown) {
        captured.body = body;
        return this;
      },
    };
    return { r: r as unknown as Response, captured };
  }

  it("writes { error, code: INVALID_ROUTE_PARAM, param } with status 400 and does not log it as unhandled", () => {
    const { r, captured } = res();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    terminalErrorHandler(new RouteParamError("id", "array"), {} as Request, r, (() => {}) as NextFunction);
    expect(captured.status).toBe(400);
    expect(captured.body).toMatchObject({ code: "INVALID_ROUTE_PARAM", param: "id" });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("respects headersSent", () => {
    const { r, captured } = res();
    (r as unknown as { headersSent: boolean }).headersSent = true;
    terminalErrorHandler(new RouteParamError("id", "missing"), {} as Request, r, (() => {}) as NextFunction);
    expect(captured.status).toBeUndefined();
  });
});

describe("end-to-end on a throwaway app", () => {
  let server: Server;
  let baseUrl: string;
  beforeAll(async () => {
    const app = express();
    // A sync throw reaches the error middleware on Express 4 and 5 alike; the
    // async-throw propagation is Express 5 behaviour and is pinned in
    // tests/express5-runtime-contract.test.ts once the bump lands.
    app.get("/items/:id", (req, res) => {
      // Simulate what path-to-regexp v8 hands over for a repeated segment.
      (req.params as Record<string, unknown>).id = ["a", "b"];
      const id = param(req, "id");
      res.json({ id });
    });
    app.use(terminalErrorHandler);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("answers 400 INVALID_ROUTE_PARAM for an array param", async () => {
    const r = await fetch(`${baseUrl}/items/x`);
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ code: "INVALID_ROUTE_PARAM", param: "id" });
  });
});
