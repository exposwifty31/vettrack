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
 * Every `/api/…` literal anywhere in the web client resolves to a real
 * registered route, matched on the FULL path — not a leading prefix. It boots
 * the real `registerApiRoutes`, walks each router's own stack (including nested
 * routers), and compares segment by segment with `:param` and `${expr}` both
 * treated as single-segment wildcards. A near-miss deeper in the path
 * (`/api/clinical-check-in/me/typo`) fails, which a prefix comparison would let
 * through.
 *
 * SCOPE
 * The whole web/Capacitor client (`src/**` .ts/.tsx), not just `src/lib/api.ts`
 * — the incident's own feature calls the API from `src/features/shift-gate/`.
 * Only literals passed directly as a call argument count: React Query keys look
 * exactly like URLs (`queryKey: ["/api/containers/detail", id]`) but are never
 * fetched, and treating them as requests produces noise that hides real drift.
 * The React Native client lives in a separate repository and cannot be read
 * from here; it needs the equivalent guard on its own side.
 *
 * When this test fails, either the client path is wrong or the server mount is.
 * Do not "fix" it by loosening the comparison.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Express, Router } from "express";

/** A registered mount: the path passed to `app.use` plus the router mounted there. */
type Mount = { path: string; router: unknown };

/** Anything the walkers could not read. A blind spot must fail loudly, not pass quietly. */
const unresolved: string[] = [];

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

/** `/api/equipment/:id/waitlist` → `["api","equipment","*","waitlist"]`. */
function segments(path: string): string[] {
  return path
    .split("/")
    .filter(Boolean)
    .map((s) => (s.startsWith(":") || s === "*" ? "*" : s));
}

/**
 * The sub-path of a nested `router.use("/ops", subRouter)` layer.
 *
 * Express 4 keeps it only as a compiled regexp (`/^\/ops\/?(?=\/|$)/i`), so it
 * has to be read back out. A regexp carrying anything but literal segments
 * (a `:param` in the sub-mount) is reported as unresolved rather than guessed.
 */
function nestedMountPath(layer: { regexp?: RegExp & { fast_slash?: boolean } }): string | null {
  const re = layer.regexp;
  if (!re) return null;
  if (re.fast_slash) return "";
  const body = re.source.replace(/^\^/, "").replace(/\\\/\?\(\?=\\\/\|\$\)$/, "");
  const literal = body.replace(/\\\//g, "/");
  return /^(?:\/[A-Za-z0-9._~-]+)+$/.test(literal) ? literal : null;
}

/** Every full path a mounted router serves, expanded recursively. */
function expandRouter(prefix: string, router: unknown, out: Set<string>): void {
  const stack = (router as Router & { stack?: unknown[] })?.stack;
  if (!Array.isArray(stack)) {
    out.add(prefix);
    return;
  }
  let added = false;
  for (const raw of stack) {
    const layer = raw as {
      route?: { path?: unknown };
      handle?: { stack?: unknown[] };
      name?: string;
      regexp?: RegExp & { fast_slash?: boolean };
    };
    const routePath = layer.route?.path;
    if (layer.route !== undefined) {
      if (typeof routePath !== "string") {
        unresolved.push(`${prefix} → non-string route path ${JSON.stringify(routePath)}`);
        continue;
      }
      out.add((prefix + (routePath === "/" ? "" : routePath)).replace(/\/+$/, "") || prefix);
      added = true;
      continue;
    }
    if (layer.name === "router" && Array.isArray(layer.handle?.stack) && layer.handle.stack.length > 0) {
      const sub = nestedMountPath(layer);
      if (sub === null) {
        unresolved.push(`${prefix} → unreadable nested mount ${String(layer.regexp)}`);
        continue;
      }
      expandRouter(prefix + sub, layer.handle, out);
      added = true;
    }
  }
  if (!added) out.add(prefix);
}

/**
 * Routes registered directly on the app in `server/index.ts`, outside
 * `registerApiRoutes` — `/api/version`, `/api/healthz`, and the routers mounted
 * ahead of auth. Read from the source rather than hardcoded, so a new one is
 * picked up automatically.
 *
 * An `app.use` mount is resolved back to its imported module and expanded like
 * any other router. Accepting every path under a mount because the mount exists
 * would reinstate the prefix match this test exists to kill: `/api/health/typo`
 * would pass. A mount that cannot be resolved is recorded as unresolved and
 * fails the suite instead.
 *
 * `server/index.ts` itself is only ever READ here — importing it would start a
 * server. Only the modules it names are imported.
 */
async function appLevelRoutes(): Promise<{ exact: string[]; mounts: Mount[] }> {
  const source = readFileSync("server/index.ts", "utf8");
  const defaultImports = new Map<string, string>();
  for (const m of source.matchAll(/^import\s+([A-Za-z_$][\w$]*)\s+from\s+"([^"]+)"/gm)) {
    defaultImports.set(m[1], m[2]);
  }

  const exact: string[] = [];
  const mounts: Mount[] = [];
  for (const m of source.matchAll(
    /\bapp\.(use|get|post|patch|put|delete)\("(\/api[^"]*)"\s*,\s*([A-Za-z_$][\w$]*)/g,
  )) {
    const [, verb, routePath, handler] = m;
    if (segments(routePath).length < 2) continue; // bare "/api" is middleware, not a route
    if (verb !== "use") {
      exact.push(routePath);
      continue;
    }
    const spec = defaultImports.get(handler);
    if (!spec?.startsWith("./")) {
      unresolved.push(`server/index.ts: app.use("${routePath}", ${handler}) — no local default import to expand`);
      continue;
    }
    const mod = (await import(spec.replace(/^\.\//, "../server/"))) as { default?: unknown };
    mounts.push({ path: routePath, router: mod.default });
  }
  return { exact, mounts };
}

/** Every `.ts`/`.tsx` file under `src/`. */
function clientSourceFiles(dir = "src", acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) clientSourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

type ClientPath = { path: string; file: string; openEnded: boolean };

/**
 * `/api/…` paths the web client requests.
 *
 * Only literals in call-argument position (`request(`/api/…`)`) are collected —
 * the lookbehind is what separates a real request from a React Query key, which
 * is a URL-shaped array element and never fetched.
 *
 * `${expr}` becomes a `*` wildcard SEGMENT rather than a truncation point, so
 * the segments after an interpolation are still compared. Two forms are open
 * ended, because what follows is decided at runtime and cannot be read here: a
 * literal ending in `/` (string concatenation, `"/api/equipment/" + id`) and a
 * literal whose trailing `${expr}` is glued to a segment (a query string,
 * `` `/api/audit-logs${query}` ``). Those match a route or any route beneath it;
 * every other path must match a route in full.
 */
function clientApiPaths(files: string[]): ClientPath[] {
  const seen = new Set<string>();
  const found: ClientPath[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?<=\(\s*)["'`](\/api\/[^"'`\s\\]*)["'`]/g)) {
      const raw = match[1];
      const withoutQuery = raw.split(/[?#]/)[0];
      const normalized = withoutQuery.replace(/\$\{[^{}]*\}/g, "*");
      if (/[${}]/.test(normalized)) {
        unresolved.push(`${file}: cannot normalize ${raw}`);
        continue;
      }
      // A trailing `${expr}` GLUED to a segment is a query string, so the `*` it
      // became is dropped and the path is left open ended. A trailing `${expr}`
      // that is its own segment is a real path parameter and keeps its wildcard.
      const gluedTail = /[^/]\$\{[^{}]*\}$/.test(withoutQuery);
      const openEnded = withoutQuery.endsWith("/") || gluedTail;
      const path = (gluedTail ? normalized.replace(/\*$/, "") : normalized).replace(/\/+$/, "");
      if (segments(path).length < 2) continue;
      const key = `${path}|${openEnded}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ path, file, openEnded });
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

/** Segment-wise comparison; `*` (from `:param` or `${expr}`) matches one segment. */
function sameShape(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((s, i) => s === "*" || b[i] === "*" || s === b[i]);
}

function isServable(client: ClientPath, routes: string[][]): boolean {
  const want = segments(client.path);
  return routes.some((route) => {
    if (sameShape(want, route)) return true;
    return client.openEnded && route.length > want.length && sameShape(want, route.slice(0, want.length));
  });
}

describe("client → server API path contract", () => {
  it("every /api path the web client calls resolves to a registered server route", async () => {
    const appLevel = await appLevelRoutes();
    const servable = new Set<string>(appLevel.exact);
    for (const mount of [...(await collectMounts()), ...appLevel.mounts]) {
      expandRouter(mount.path, mount.router, servable);
    }
    const routes = [...servable].map(segments);

    expect(routes.length, "no server routes were discovered — the walker is broken").toBeGreaterThan(100);
    expect(appLevel.mounts.length, "no app-level mounts were expanded from server/index.ts").toBeGreaterThan(0);

    const clientPaths = clientApiPaths(clientSourceFiles());
    expect(clientPaths.length, "no client API paths were discovered — the extractor is broken").toBeGreaterThan(50);

    const unreachable = clientPaths.filter((c) => !isServable(c, routes));

    expect(
      unreachable.map((c) => `${c.path}  (${c.file})`),
      `These client paths match no registered server route. Express matches mounts on\n` +
        `segment boundaries, so a near-miss like /api/clinical vs /api/clinical-check-in\n` +
        `silently falls through to the SPA catch-all and returns 200 text/html.`,
    ).toEqual([]);
    // Importing the whole route graph and reading every client source file runs
    // in ~3s alone but contends for CPU under the full parallel suite.
  }, 30_000);

  it("leaves no unreadable route or client literal behind", () => {
    expect(
      unresolved,
      "Something could not be parsed. An unparsed entry is an untested path — teach the\n" +
        "walker to read it rather than letting it pass silently.",
    ).toEqual([]);
  });
});
