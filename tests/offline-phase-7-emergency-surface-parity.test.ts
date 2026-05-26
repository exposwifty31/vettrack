/**
 * OFF-07 — Emergency API surface CI parity gate (Phase 7).
 *
 * Ratchets shared/emergency-surfaces.manifest.ts against:
 *   - classifyEmergencyEndpoint (offline block)
 *   - public/sw.js EMERGENCY_BYPASS_PATHS (cache denylist)
 *   - Express routes in code-blue, realtime, display routers
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  EMERGENCY_CACHE_BYPASS_PATHS,
  EMERGENCY_OFFLINE_BLOCK_MUTATIONS,
  EMERGENCY_SERVER_ROUTE_ALLOWLIST,
  classifyEmergencyEndpointFromManifest,
  normalizeEmergencyPathname,
} from "../shared/emergency-surfaces.manifest";
import { classifyEmergencyEndpoint } from "../src/lib/offline-emergency-block";

const REPO_ROOT = process.cwd();
const SW_PATH = join(REPO_ROOT, "public/sw.js");

const ROUTE_FILES: ReadonlyArray<{ file: string; mountPrefix: string }> = [
  { file: "server/routes/code-blue.ts", mountPrefix: "/api/code-blue" },
  { file: "server/routes/realtime.ts", mountPrefix: "/api/realtime" },
  { file: "server/routes/display.ts", mountPrefix: "/api/display" },
];

const ROUTER_METHOD_RE =
  /router\.(get|post|patch|put|delete)\(\s*["']([^"']+)["']/g;

function parseSwEmergencyBypassPaths(swSource: string): string[] {
  const blockMatch = swSource.match(/const\s+EMERGENCY_BYPASS_PATHS\s*=\s*\[([\s\S]*?)\];/);
  expect(blockMatch, "public/sw.js must declare EMERGENCY_BYPASS_PATHS = [ ... ];").toBeTruthy();

  const paths: string[] = [];
  const stringLiteral = /["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = stringLiteral.exec(blockMatch![1])) !== null) {
    paths.push(m[1]);
  }
  return paths;
}

function scanExpressRoutes(filePath: string, mountPrefix: string): string[] {
  const source = readFileSync(join(REPO_ROOT, filePath), "utf8");
  const routes: string[] = [];
  let match: RegExpExecArray | null;
  ROUTER_METHOD_RE.lastIndex = 0;
  while ((match = ROUTER_METHOD_RE.exec(source)) !== null) {
    const method = match[1].toUpperCase();
    const subPath = match[2];
    const fullPath =
      subPath === "/" ? `${mountPrefix}/` : `${mountPrefix}${subPath}`;
    routes.push(`${method} ${fullPath}`);
  }
  return routes;
}

function scanAllEmergencySurfaceRoutes(): string[] {
  return ROUTE_FILES.flatMap(({ file, mountPrefix }) =>
    scanExpressRoutes(file, mountPrefix),
  );
}

/** Code Blue session mutations that must appear in EMERGENCY_OFFLINE_BLOCK_MUTATIONS. */
function isCodeBlueOfflineBlockMutation(routeKey: string): boolean {
  const [method, path] = routeKey.split(" ", 2);
  if (method === "POST" && path === "/api/code-blue/sessions") return true;
  if (method === "POST" && /^\/api\/code-blue\/sessions\/:id\/logs$/.test(path)) {
    return true;
  }
  if (method === "PATCH" && /^\/api\/code-blue\/sessions\/:id\/end$/.test(path)) {
    return true;
  }
  if (
    method === "PATCH" &&
    /^\/api\/code-blue\/sessions\/:id\/presence$/.test(path)
  ) {
    return true;
  }
  return false;
}

/** Live reads that must be in the SW cache bypass denylist (Phase 9 family). */
function requiresSwCacheBypass(routeKey: string): boolean {
  const [, path] = routeKey.split(" ", 2);
  if (path === "/api/display/snapshot") return true;
  if (path === "/api/code-blue/sessions/active") return true;
  if (
    path === "/api/realtime/stream" ||
    path === "/api/realtime/replay" ||
    path === "/api/realtime/outbox-head" ||
    path === "/api/realtime/telemetry"
  ) {
    return true;
  }
  return false;
}

function expressPathToSamplePathname(expressPath: string): string {
  return expressPath.replace(/:id/g, "abc-123");
}

describe("OFF-07 — manifest ↔ classifyEmergencyEndpoint", () => {
  it.each(EMERGENCY_OFFLINE_BLOCK_MUTATIONS.map((m) => ({
    label: `${m.method} ${m.samplePathname} → ${m.class}`,
    mutation: m,
  })))("manifest entry classifies: $label", ({ mutation }) => {
    expect(
      classifyEmergencyEndpoint(mutation.samplePathname, mutation.method),
    ).toBe(mutation.class);
    expect(
      classifyEmergencyEndpointFromManifest(
        mutation.samplePathname,
        mutation.method,
      ),
    ).toBe(mutation.class);
  });

  it("trailing slash on session start normalizes to same class (P3-6)", () => {
    expect(classifyEmergencyEndpoint("/api/code-blue/sessions/", "POST")).toBe(
      "start",
    );
    expect(
      classifyEmergencyEndpoint(
        "/api/code-blue/sessions/?retry=1",
        "POST",
      ),
    ).toBe("start");
  });

  it("classifier matches manifest for every manifest sample", () => {
    for (const m of EMERGENCY_OFFLINE_BLOCK_MUTATIONS) {
      expect(classifyEmergencyEndpoint(m.samplePathname, m.method)).toBe(
        classifyEmergencyEndpointFromManifest(m.samplePathname, m.method),
      );
    }
  });

  it("non-null classifier decisions always match a manifest entry", () => {
    const probes: Array<{ url: string; method: string }> = [
      ...EMERGENCY_OFFLINE_BLOCK_MUTATIONS.map((m) => ({
        url: m.samplePathname,
        method: m.method,
      })),
      { url: "/api/code-blue/sessions/active", method: "GET" },
      { url: "/api/code-blue/events", method: "POST" },
      { url: "/api/display/snapshot", method: "GET" },
    ];
    for (const { url, method } of probes) {
      const fromClassifier = classifyEmergencyEndpoint(url, method);
      const fromManifest = classifyEmergencyEndpointFromManifest(url, method);
      expect(fromClassifier).toBe(fromManifest);
      if (fromClassifier !== null) {
        const matched = EMERGENCY_OFFLINE_BLOCK_MUTATIONS.some(
          (m) =>
            method.toUpperCase() === m.method &&
            m.pathPattern.test(normalizeEmergencyPathname(url)),
        );
        expect(matched).toBe(true);
      }
    }
  });
});

describe("OFF-07 — manifest ↔ public/sw.js EMERGENCY_BYPASS_PATHS", () => {
  const swSource = readFileSync(SW_PATH, "utf8");
  const swPaths = parseSwEmergencyBypassPaths(swSource);

  it("set equality between manifest and SW denylist", () => {
    const canonical = [...EMERGENCY_CACHE_BYPASS_PATHS].sort();
    const parsed = [...swPaths].sort();
    expect(parsed).toEqual(canonical);
  });
});

describe("OFF-07 — server route ratchet", () => {
  const discovered = scanAllEmergencySurfaceRoutes();
  const allowlist = new Set(EMERGENCY_SERVER_ROUTE_ALLOWLIST);

  it("discovers at least one route per emergency router file", () => {
    expect(discovered.length).toBeGreaterThanOrEqual(ROUTE_FILES.length);
  });

  it("every registered route is on EMERGENCY_SERVER_ROUTE_ALLOWLIST", () => {
    const unlisted = discovered.filter((key) => !allowlist.has(key));
    expect(
      unlisted,
      unlisted.length
        ? `Add to shared/emergency-surfaces.manifest.ts EMERGENCY_SERVER_ROUTE_ALLOWLIST:\n${unlisted.join("\n")}`
        : undefined,
    ).toEqual([]);
  });

  it("ratchet: unlisted route key would fail (documented guard)", () => {
    expect(allowlist.has("GET /api/code-blue/sessions/foo")).toBe(false);
  });

  it.each(EMERGENCY_SERVER_ROUTE_ALLOWLIST)(
    "allowlisted route %s satisfies coverage rules",
    (routeKey) => {
      if (isCodeBlueOfflineBlockMutation(routeKey)) {
        const [, expressPath] = routeKey.split(" ", 2);
        const sample = expressPathToSamplePathname(expressPath);
        const [method] = routeKey.split(" ", 1);
        expect(classifyEmergencyEndpoint(sample, method)).not.toBeNull();
        return;
      }
      if (requiresSwCacheBypass(routeKey)) {
        const [, expressPath] = routeKey.split(" ", 2);
        const sample = expressPath.replace(/:id/g, "abc-123");
        expect([...EMERGENCY_CACHE_BYPASS_PATHS]).toContain(sample);
      }
    },
  );
});
