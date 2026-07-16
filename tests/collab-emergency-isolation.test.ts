/**
 * R-RTC-1.7 — THE load-bearing acceptance test (merge gate).
 *
 * The collaboration channel must be provably decoupled from the frozen
 * SSE + `vt_event_outbox` + Code Blue path. Two proofs:
 *   1. With the channel forcibly disabled AND Redis unavailable, initialization
 *      returns cleanly disabled — it never throws, so it can never block the main
 *      server / SSE / outbox / Code Blue startup (which run BEFORE this in index.ts).
 *   2. Structural isolation: no collab source file imports any emergency/SSE/outbox
 *      module. Coupling can't creep in via an import even if someone tries.
 * Plus the closed-enum telemetry rejection.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createServer, type Server as HttpServer } from "node:http";
import { initCollabServer } from "../server/lib/realtime-collab/server.js";
import { recordCollabMetric, isCollabMetric, COLLAB_METRICS } from "../server/lib/realtime-collab/telemetry.js";

describe("R-RTC-1.7 — emergency isolation merge gate", () => {
  const original = { ...process.env };
  let httpServer: HttpServer;

  beforeEach(() => {
    httpServer = createServer();
  });
  afterEach(() => {
    process.env = { ...original };
    httpServer.close();
  });

  it("with COLLAB_WS_ENABLED=false, init returns disabled and NEVER throws", async () => {
    process.env.COLLAB_WS_ENABLED = "false";
    const collab = await initCollabServer(httpServer);
    expect(collab.enabled).toBe(false);
    expect(collab.reason).toContain("COLLAB_WS_ENABLED");
    await expect(collab.close()).resolves.toBeUndefined();
  });

  it("in production with Redis unavailable + no single-instance opt-in, the channel disables itself (non-fatal)", async () => {
    process.env.NODE_ENV = "production";
    process.env.COLLAB_WS_ENABLED = "true";
    delete process.env.COLLAB_WS_ALLOW_SINGLE_INSTANCE;
    // getRedis() returns null when REDIS_URL is absent — simulate no Redis.
    delete process.env.REDIS_URL;
    delete process.env.PGBOUNCER_URL;
    const collab = await initCollabServer(httpServer);
    // Fails ITS OWN init loudly (disabled) but does not throw — the process,
    // SSE, outbox, and Code Blue are unaffected.
    expect(collab.enabled).toBe(false);
    expect(collab.reason).toBe("REDIS_REQUIRED");
  });

  it("STRUCTURAL: no collab source file imports an emergency / SSE / outbox module", () => {
    const dir = join(process.cwd(), "server", "lib", "realtime-collab");
    const FORBIDDEN = [
      "event-publisher",
      "event-outbox",
      "vt_event_outbox",
      "code-blue",
      "code-blue-keepalive",
      "realtime/", // SSE transport internals
      "routes/realtime",
      "routes/display",
      "routes/code-blue",
    ];
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(dir, file), "utf8");
      for (const forbidden of FORBIDDEN) {
        // Only flag actual import statements, not comment prose.
        const importRe = new RegExp(`(import|from)\\s+["'][^"']*${forbidden.replace("/", "\\/")}`);
        if (importRe.test(src)) offenders.push(`${file} → ${forbidden}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("telemetry: recordCollabMetric accepts ONLY the closed allowlist", () => {
    for (const name of COLLAB_METRICS) {
      expect(isCollabMetric(name)).toBe(true);
      expect(recordCollabMetric(name)).toBe(true);
    }
    // Any name outside the allowlist is rejected — literal or dynamically built.
    expect(recordCollabMetric("collab_evil")).toBe(false);
    expect(recordCollabMetric("realtime_events_sent")).toBe(false); // a real metric, but not a collab one
    expect(recordCollabMetric("collab_" + "cursor_leaked")).toBe(false);
    expect(isCollabMetric("")).toBe(false);
  });
});
