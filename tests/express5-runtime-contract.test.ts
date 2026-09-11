/**
 * Express 5 runtime contract — the behaviour changes the type bump cannot see.
 * Each case mounts the REAL pieces this server relies on (express.json, the
 * terminal error handler, validateBody) on a throwaway app, so a future bump
 * or a "harmless" middleware edit that changes one of these fails here, not in
 * production.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { JSON_BODY_LIMIT, terminalErrorHandler } from "../server/lib/body-parser-errors.js";
import { RouteParamError } from "../server/lib/route-params.js";
import { validateBody } from "../server/middleware/validate.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  // Async throw with NO try/catch: Express 5 routes the rejection to the error
  // middleware; on Express 4 this request hung and the process saw an
  // unhandledRejection.
  app.get("/async-throw", async () => {
    throw new Error("escaped rejection");
  });
  app.get("/async-param", async () => {
    throw new RouteParamError("id", "array");
  });
  app.get("/query", (req, res) => {
    res.json({ keys: Object.keys(req.query), value: req.query["a[b]"] ?? null });
  });
  app.get("/query-assign", (req, res) => {
    let threw = false;
    try {
      (req as unknown as { query: unknown }).query = { replaced: true };
    } catch {
      threw = true;
    }
    res.json({ threw });
  });
  // The body-less POST shape: `z.object({}).strict()` guards two production
  // routes (dispense confirm, action-proposal kinds) that accept an empty body.
  app.post("/empty-body", validateBody(z.object({}).strict()), (_req, res) => {
    res.json({ ok: true });
  });
  app.post("/destructure", (req, res) => {
    const { name } = (req.body ?? {}) as { name?: string };
    res.json({ name: name ?? null });
  });
  // Mirrors server/index.ts: JSON 404 for unknown /api paths, SPA catch-all after.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  app.get("/{*splat}", (req, res) => {
    res.type("text/plain").send(`shell:${req.path}`);
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

describe("async error propagation", () => {
  it("an async handler that throws reaches the terminal handler as 500 JSON (no hang)", async () => {
    const r = await fetch(`${baseUrl}/async-throw`, { signal: AbortSignal.timeout(3000) });
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "Internal Server Error" });
  });
  it("an async RouteParamError becomes the mapped 400", async () => {
    const r = await fetch(`${baseUrl}/async-param`, { signal: AbortSignal.timeout(3000) });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ code: "INVALID_ROUTE_PARAM", param: "id" });
  });
});

describe("req.query is a getter with the 'simple' parser", () => {
  it("does not nest bracket keys (no consumer relies on nesting)", async () => {
    const r = await fetch(`${baseUrl}/query?a[b]=1&c=2`);
    expect(await r.json()).toEqual({ keys: ["a[b]", "c"], value: "1" });
  });
  it("cannot be reassigned", async () => {
    const r = await fetch(`${baseUrl}/query-assign`);
    expect(await r.json()).toEqual({ threw: true });
  });
});

describe("body-parser 2 leaves req.body undefined when nothing parsed", () => {
  it("a body-less POST still passes an empty strict schema (validateBody defaults the body)", async () => {
    const r = await fetch(`${baseUrl}/empty-body`, { method: "POST" });
    expect(r.status).toBe(200);
  });
  it("destructuring a missing body does not throw", async () => {
    const r = await fetch(`${baseUrl}/destructure`, { method: "POST" });
    expect(await r.json()).toEqual({ name: null });
  });
});

describe("the SPA catch-all", () => {
  it("serves / and deep paths, and /api/* stays a JSON 404", async () => {
    expect(await (await fetch(`${baseUrl}/`)).text()).toBe("shell:/");
    expect(await (await fetch(`${baseUrl}/equipment/x`)).text()).toBe("shell:/equipment/x");
    const api = await fetch(`${baseUrl}/api/nope`);
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ error: "Not found" });
  });
});

describe("removed Express 4 signatures are absent from the source", () => {
  it("no res.send(status), res.json(x, status), redirect('back'), app.del, req.param, res.sendfile, app.get('*')", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "server");
    const offenders: string[] = [];
    const patterns = [
      /\bres\.send\(\s*\d{3}\s*\)/,
      /\bres\.json\([^)]*,\s*\d{3}\s*\)/,
      /redirect\(\s*["']back["']\s*\)/,
      /\bapp\.del\(/,
      /\breq\.param\(/,
      /\bres\.sendfile\(/,
      /\.get\(\s*["']\*["']/,
    ];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|js|mjs)$/.test(entry.name)) {
          const src = fs.readFileSync(full, "utf8");
          for (const p of patterns) if (p.test(src)) offenders.push(`${path.relative(root, full)}: ${p}`);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
