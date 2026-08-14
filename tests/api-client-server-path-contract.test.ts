/**
 * Client → server API path contract.
 *
 * WHY THIS EXISTS
 * On 2026-08-14 the doctor shift gate was found broken in production, in BOTH
 * clients, for ~24h after shipping. The server mounted the clinical check-in
 * router at `/api/clinical`; both clients called `/api/clinical-check-in/…`.
 * Express matches mounts on segment boundaries, so the client path never hit a
 * route — it fell through to the SPA catch-all and returned `200 text/html`.
 * The clients asked for a JSON row and got an HTML page, with a success code.
 *
 * Nothing caught it: server tests invoke route handlers directly and never
 * exercise the mount, and client tests mock the transport. No test crossed the
 * boundary. This one does.
 *
 * WHAT IT ASSERTS
 * Every `/api/...` literal the web client calls resolves to a real registered
 * route once mount paths and router-internal paths are composed. It boots the
 * real `registerApiRoutes` and walks each router's own stack rather than
 * string-matching mount prefixes — three routers mount at bare `/api`, so a
 * prefix check would match everything and prove nothing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Express, Router } from "express";

/** A registered mount: the path passed to `app.use` plus the router mounted there. */
type Mount = { path: string; router: unknown };

/** Collect every `app.use("/api…", router)` the real registration performs. */
async function collectMounts(): Promise<Mount[]> {
  const { registerApiRoutes } = await import("../server/app/routes.js");
  const mounts: Mount[] = [];
  const app = {
    use(path: unknown, ...rest: unknown[]) {
      if (typeof path === "string" && path.startsWith("/api")) {
        mounts.push({ path, router: rest[0] });
      }
      return app;
    },
    get() {
      return app;
    },
    post() {
      return app;
    },
  } as unknown as Express;
  registerApiRoutes(app);
  return mounts;
}

/**
 * Full paths a mounted router actually serves.
 *
 * Express Router keeps its layers on `.stack`; a layer with `.route` carries the
 * router-relative path. Nested routers (a layer without `.route`) are not walked
 * — their sub-paths are covered by the prefix they contribute, which is enough
 * for the base-path drift this guard exists to catch.
 */
function routePathsOf(mount: Mount): string[] {
  const stack = (mount.router as Router & { stack?: unknown[] })?.stack;
  if (!Array.isArray(stack)) return [mount.path];
  const paths = stack
    .map((layer) => (layer as { route?: { path?: string } })?.route?.path)
    .filter((p): p is string => typeof p === "string")
    .map((p) => (mount.path + (p === "/" ? "" : p)).replace(/\/+$/, ""));
  return paths.length > 0 ? paths : [mount.path];
}

/** `/api/equipment/:id/waitlist` → `/api/equipment` — the segments a client can't get wrong. */
function basePrefix(path: string): string {
  const segments = path.split("/").filter(Boolean); // ["api","equipment",":id",…]
  const stable = segments.slice(0, 2).filter((s) => !s.startsWith(":"));
  return "/" + stable.join("/");
}

/**
 * `/api/...` paths the web client requests.
 *
 * Template-literal interpolations (`${id}`) and query strings are truncated, so
 * only the static leading path is compared — exactly the part a client cannot
 * get wrong by accident, and the part that drifted in the incident above.
 */
function clientApiPaths(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const found = new Set<string>();
  for (const match of source.matchAll(/["'`](\/api\/[^"'`\s]*)["'`]/g)) {
    const staticPart = match[1].split(/[$?#]/)[0].replace(/\/+$/, "");
    if (staticPart.split("/").filter(Boolean).length >= 2) found.add(staticPart);
  }
  return [...found].sort();
}

describe("client → server API path contract", () => {
  it("every /api path the web client calls resolves to a registered server route", async () => {
    const mounts = await collectMounts();
    const servable = new Set(mounts.flatMap(routePathsOf).map(basePrefix));

    const unreachable = clientApiPaths("src/lib/api.ts")
      .filter((clientPath) => !servable.has(basePrefix(clientPath)))
      .sort();

    expect(
      unreachable,
      `These client paths match no registered server route. Express matches mounts on\n` +
        `segment boundaries, so a near-miss like /api/clinical vs /api/clinical-check-in\n` +
        `silently falls through to the SPA catch-all and returns 200 text/html:\n` +
        unreachable.map((p) => `  ${p}`).join("\n"),
    ).toEqual([]);
  });
});
