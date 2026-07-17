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
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server as HttpServer } from "node:http";
import { type AddressInfo } from "node:net";
import { initCollabServer } from "../server/lib/realtime-collab/server.js";
import { recordCollabMetric, isCollabMetric, COLLAB_METRICS } from "../server/lib/realtime-collab/telemetry.js";

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

/**
 * Flags an import of a forbidden module. Must catch BOTH forms:
 *   - static:  import x from "../event-publisher.js"  /  import "../event-publisher.js"
 *   - dynamic: await import("../event-publisher.js")
 * A regex that only requires whitespace before the quote misses `import(` — the
 * gap that would let a future collab→emergency coupling slip through the ONLY
 * frozen-surface guard. The dynamic form must also cover backtick template
 * literals: dynamic `import()` legally permits `import(`../x`)`, so the specifier
 * delimiter can be `'`, `"`, OR `` ` `` — all three must be caught. Comment prose
 * must NOT be flagged.
 */
function importsForbiddenModule(src: string, forbidden: string): boolean {
  const mod = forbidden.replace(/\//g, "\\/");
  const staticRe = new RegExp(`(import|from)\\s+["'][^"']*${mod}`);
  const dynamicRe = new RegExp(`import\\s*\\(\\s*["'\`][^"'\`]*${mod}`);
  return staticRe.test(src) || dynamicRe.test(src);
}

/**
 * Walk a directory tree, flagging every `.ts` file (at ANY depth) that imports a
 * FORBIDDEN emergency/SSE/outbox module. `readdirSync(dir, { recursive: true })`
 * descends into subdirectories — a NON-recursive scan (direct children only) would let
 * a future NESTED collab module (e.g. `realtime-collab/adapters/x.ts`) couple to the
 * frozen surface and silently pass THE only merge gate. — PR#112 (b).
 */
function collectImportOffenders(dir: string): string[] {
  const offenders: string[] = [];
  const entries = readdirSync(dir, { recursive: true }) as string[];
  for (const rel of entries.filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(join(dir, rel), "utf8");
    for (const forbidden of FORBIDDEN) {
      if (importsForbiddenModule(src, forbidden)) offenders.push(`${rel} → ${forbidden}`);
    }
  }
  return offenders;
}

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

  it("Redis-absent disable (REDIS_REQUIRED) NEVER stops the shared http.Server it was attached to", async () => {
    process.env.NODE_ENV = "production";
    process.env.COLLAB_WS_ENABLED = "true";
    delete process.env.COLLAB_WS_ALLOW_SINGLE_INSTANCE;
    delete process.env.REDIS_URL;
    delete process.env.PGBOUNCER_URL;
    // A LIVE, listening server — exactly the shared server Express + SSE + Code Blue run on.
    await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
    expect(httpServer.listening).toBe(true);

    const collab = await initCollabServer(httpServer);
    expect(collab.enabled).toBe(false);
    expect(collab.reason).toBe("REDIS_REQUIRED");
    // The shared production server must still be up — collab must NOT have torn it down.
    expect(httpServer.listening).toBe(true);
    await expect(collab.close()).resolves.toBeUndefined();
    expect(httpServer.listening).toBe(true);
  });

  it("adapter-wiring throw (REDIS_ADAPTER_FAILED) NEVER stops the shared http.Server", async () => {
    process.env.COLLAB_WS_ENABLED = "true";
    await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
    const addr = httpServer.address() as AddressInfo;
    expect(httpServer.listening).toBe(true);

    // Force the Redis adapter wiring to throw AFTER io was created (the branch that
    // currently io.close()s the shared server). A fake client whose duplicate() throws
    // routes through the REDIS_ADAPTER_FAILED catch.
    const explodingRedis = {
      duplicate() {
        throw new Error("boom: adapter wiring");
      },
    };
    const collab = await initCollabServer(httpServer, {
      getRedisClient: async () => explodingRedis as never,
    });
    expect(collab.enabled).toBe(false);
    expect(collab.reason).toBe("REDIS_ADAPTER_FAILED");
    // Shared server untouched, same address still bound.
    expect(httpServer.listening).toBe(true);
    expect((httpServer.address() as AddressInfo).port).toBe(addr.port);
    await expect(collab.close()).resolves.toBeUndefined();
    expect(httpServer.listening).toBe(true);
  });

  it("STRUCTURAL: no collab source file imports an emergency / SSE / outbox module (recursive)", () => {
    const dir = join(process.cwd(), "server", "lib", "realtime-collab");
    // Recursive walk: catches a forbidden import in a NESTED module, not just direct children.
    expect(collectImportOffenders(dir)).toEqual([]);
  });

  it("STRUCTURAL scan is RECURSIVE: a forbidden import in a NESTED collab module IS caught", () => {
    // A non-recursive `readdirSync(dir)` scan sees only direct children, so a future
    // `realtime-collab/<subdir>/x.ts` that couples to the frozen emergency surface would
    // evade THE only merge gate. Prove the walk descends: a nested file that imports a
    // forbidden module MUST be flagged, while a sibling clean file is not. — PR#112 (b).
    const fixture = mkdtempSync(join(tmpdir(), "collab-nested-scan-"));
    try {
      mkdirSync(join(fixture, "adapters"));
      writeFileSync(join(fixture, "clean.ts"), "export const ok = 1;\n");
      writeFileSync(
        join(fixture, "adapters", "sneaky.ts"),
        'import { publish } from "../../event-publisher.js";\n',
      );
      const offenders = collectImportOffenders(fixture);
      expect(offenders).toContain(`${join("adapters", "sneaky.ts")} → event-publisher`);
      // The clean sibling is never flagged (no false positive from the recursion).
      expect(offenders.some((o) => o.startsWith("clean.ts"))).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("STRUCTURAL scanner catches a DYNAMIC import() of a forbidden emergency module", () => {
    // The collab code already uses dynamic import() (server.ts loads the Redis
    // adapter that way). A regex that only matches static `import x from "..."`
    // would let a future `await import("../event-publisher.js")` coupling defeat
    // the merge gate silently. The scanner must catch EVERY dynamic-import form —
    // single-quote, double-quote, AND backtick template literal (dynamic import()
    // specifically permits template literals, so a backtick specifier is legal JS
    // and must not be a one-character-different evasion of the merge gate).
    const dynamicForms = [
      `await import("../event-publisher.js");`,
      `const m = import('../lib/event-publisher');`,
      `void import( "../code-blue-keepalive.js" );`,
      // Raw backtick template-literal specifiers (NOT rewritten to quotes).
      "await import(`../routes/realtime`)",
      "const p = import(`../event-publisher.js`);",
      "void import( `../code-blue-keepalive.js` );",
    ];
    for (const src of dynamicForms) {
      const caught = FORBIDDEN.some((forbidden) => importsForbiddenModule(src, forbidden));
      expect(caught, `dynamic import not caught: ${src}`).toBe(true);
    }

    // Static forms must still be caught (no regression / no weakening).
    expect(importsForbiddenModule(`import { publish } from "../event-publisher.js";`, "event-publisher")).toBe(true);
    expect(importsForbiddenModule(`import "../routes/code-blue";`, "routes/code-blue")).toBe(true);

    // Comment prose and unrelated dynamic imports must NOT be flagged.
    expect(importsForbiddenModule(`// this file must never import event-publisher`, "event-publisher")).toBe(false);
    expect(importsForbiddenModule(`const { createAdapter } = await import("@socket.io/redis-adapter");`, "event-publisher")).toBe(false);
    // Unrelated backtick dynamic import must NOT be flagged either.
    expect(importsForbiddenModule("const a = await import(`@socket.io/redis-adapter`);", "event-publisher")).toBe(false);
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
