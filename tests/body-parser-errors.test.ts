/**
 * F2 regression — body-parser failures must return 4xx, not 500:
 *   - JSON body over the explicit limit → 413 PAYLOAD_TOO_LARGE
 *   - malformed JSON → 400 INVALID_JSON
 *   - unrelated errors still → blanket 500
 *
 * The behavioral tests mount the REAL exported terminal handler + json limit
 * on a throwaway express app, so they exercise the production code path.
 * A source contract pins server/index.ts to the same exports.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  JSON_BODY_LIMIT,
  classifyBodyParserError,
  terminalErrorHandler,
} from "../server/lib/body-parser-errors.js";

describe("classifyBodyParserError", () => {
  it("maps entity.too.large to 413 PAYLOAD_TOO_LARGE", () => {
    const classified = classifyBodyParserError(
      Object.assign(new Error("request entity too large"), { type: "entity.too.large", status: 413 }),
    );
    expect(classified).toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
  });

  it("maps entity.parse.failed to 400 INVALID_JSON", () => {
    const classified = classifyBodyParserError(
      Object.assign(new SyntaxError("Unexpected end of JSON input"), {
        type: "entity.parse.failed",
        status: 400,
      }),
    );
    expect(classified).toMatchObject({ status: 400, code: "INVALID_JSON" });
  });

  it("maps a plain SyntaxError carrying body-parser status 400 to INVALID_JSON", () => {
    const classified = classifyBodyParserError(
      Object.assign(new SyntaxError("Unexpected token"), { status: 400, body: "{" }),
    );
    expect(classified).toMatchObject({ status: 400, code: "INVALID_JSON" });
  });

  it("maps other typed body-parser 4xx errors through their own status", () => {
    const classified = classifyBodyParserError(
      Object.assign(new Error("unsupported charset"), { type: "charset.unsupported", status: 415 }),
    );
    expect(classified).toMatchObject({ status: 415, code: "REQUEST_BODY_REJECTED" });
  });

  it("returns null for unrelated errors (blanket 500 stays)", () => {
    expect(classifyBodyParserError(new Error("boom"))).toBeNull();
    expect(classifyBodyParserError(undefined)).toBeNull();
    expect(classifyBodyParserError("string error")).toBeNull();
  });
});

describe("express.json limit + terminal handler behavior", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: JSON_BODY_LIMIT }));
    app.post("/echo", (req, res) => {
      res.json({ ok: true, keys: Object.keys(req.body ?? {}).length });
    });
    app.post("/boom", () => {
      throw new Error("unrelated failure");
    });
    app.use(terminalErrorHandler);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("accepts a normal JSON body", async () => {
    const res = await fetch(`${baseUrl}/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 413 PAYLOAD_TOO_LARGE for a body over the limit (was 500)", async () => {
    const oversized = JSON.stringify({ csv: "x".repeat(6 * 1024 * 1024) });
    const res = await fetch(`${baseUrl}/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: oversized,
    });
    expect(res.status).toBe(413);
    const json = (await res.json()) as { code?: string };
    expect(json.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("returns 400 INVALID_JSON for a malformed JSON body (was 500)", async () => {
    const res = await fetch(`${baseUrl}/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"broken":',
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code?: string };
    expect(json.code).toBe("INVALID_JSON");
  });

  it("still returns blanket 500 for unrelated route errors", async () => {
    const res = await fetch(`${baseUrl}/boom`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe("Internal Server Error");
  });
});

describe("server/index.ts wiring contract", () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const indexSource = fs.readFileSync(path.resolve(__dirname, "../server/index.ts"), "utf8");

  it("express.json is configured with the shared JSON_BODY_LIMIT", () => {
    expect(indexSource).toContain("express.json({ limit: JSON_BODY_LIMIT })");
  });

  it("the terminal error handler is the shared body-parser-aware handler", () => {
    expect(indexSource).toContain("terminalErrorHandler");
    expect(indexSource).toContain('from "./lib/body-parser-errors.js"');
  });
});
