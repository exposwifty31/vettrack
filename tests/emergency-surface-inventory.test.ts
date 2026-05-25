/**
 * Phase 7a — frozen emergency/live surface inventory (detection only).
 *
 * Locks drift between:
 * - classifyEmergencyEndpoint (Code Blue mutations → offline block)
 * - public/sw.js EMERGENCY_BYPASS_PATHS (live reads → never cached)
 *
 * Does not modify classifier, SW, or runtime behavior.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  classifyEmergencyEndpoint,
  type EmergencyEndpointClass,
} from "../src/lib/offline-emergency-block";

const SW_PATH = join(process.cwd(), "public/sw.js");

/** Phase 9 frozen live/emergency API paths — must appear in SW denylist. */
const SW_EMERGENCY_BYPASS_CANONICAL = [
  "/api/display/snapshot",
  "/api/code-blue/sessions/active",
  "/api/realtime/stream",
  "/api/realtime/replay",
  "/api/realtime/outbox-head",
  "/api/realtime/telemetry",
] as const;

/** Representative URLs for each Code Blue mutation class the classifier recognizes today. */
const CODE_BLUE_MUTATION_INVENTORY: ReadonlyArray<{
  label: string;
  url: string;
  method: string;
  expected: EmergencyEndpointClass;
}> = [
  {
    label: "session start",
    url: "/api/code-blue/sessions",
    method: "POST",
    expected: "start",
  },
  {
    label: "session log",
    url: "/api/code-blue/sessions/sess-1/logs",
    method: "POST",
    expected: "log",
  },
  {
    label: "session end",
    url: "/api/code-blue/sessions/sess-1/end",
    method: "PATCH",
    expected: "end",
  },
  {
    label: "session presence",
    url: "/api/code-blue/sessions/sess-1/presence",
    method: "PATCH",
    expected: "presence",
  },
];

/**
 * Live read paths that must bypass SW cache but must NOT be emergency mutations.
 */
const LIVE_READ_NOT_CLASSIFIER_MUTATIONS: ReadonlyArray<{
  label: string;
  url: string;
  method: string;
}> = [
  { label: "display snapshot", url: "/api/display/snapshot", method: "GET" },
  { label: "code blue active session", url: "/api/code-blue/sessions/active", method: "GET" },
  { label: "realtime stream", url: "/api/realtime/stream", method: "GET" },
  { label: "realtime replay", url: "/api/realtime/replay", method: "GET" },
  { label: "realtime outbox head", url: "/api/realtime/outbox-head", method: "GET" },
];

function readServiceWorkerSource(): string {
  return readFileSync(SW_PATH, "utf8");
}

/** Parse EMERGENCY_BYPASS_PATHS string literals from public/sw.js (read-only). */
function parseSwEmergencyBypassPaths(swSource: string): string[] {
  const blockMatch = swSource.match(
    /const\s+EMERGENCY_BYPASS_PATHS\s*=\s*\[([\s\S]*?)\];/,
  );
  expect(
    blockMatch,
    "public/sw.js must declare EMERGENCY_BYPASS_PATHS = [ ... ];",
  ).toBeTruthy();

  const paths: string[] = [];
  const stringLiteral = /["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = stringLiteral.exec(blockMatch![1])) !== null) {
    paths.push(m[1]);
  }

  expect(
    paths.length,
    "EMERGENCY_BYPASS_PATHS must list at least one path",
  ).toBeGreaterThan(0);

  return paths;
}

function formatInventoryDrift(
  surface: string,
  missing: readonly string[],
  extra: readonly string[],
): string {
  const lines = [`${surface} inventory drift:`];
  if (missing.length) {
    lines.push(`  missing (expected but not found): ${missing.join(", ")}`);
  }
  if (extra.length) {
    lines.push(`  extra (found but not in canonical list): ${extra.join(", ")}`);
  }
  return lines.join("\n");
}

describe("emergency-surface-inventory — Phase 7a frozen paths", () => {
  const swSource = readServiceWorkerSource();
  const swPaths = parseSwEmergencyBypassPaths(swSource);

  it("public/sw.js EMERGENCY_BYPASS_PATHS matches canonical live denylist", () => {
    const canonical = [...SW_EMERGENCY_BYPASS_CANONICAL].sort();
    const parsed = [...swPaths].sort();

    const missing = canonical.filter((p) => !parsed.includes(p));
    const extra = parsed.filter((p) => !canonical.includes(p as (typeof SW_EMERGENCY_BYPASS_CANONICAL)[number]));

    expect(
      missing,
      formatInventoryDrift("SW EMERGENCY_BYPASS_PATHS", missing, extra),
    ).toEqual([]);
    expect(
      extra,
      formatInventoryDrift("SW EMERGENCY_BYPASS_PATHS", missing, extra),
    ).toEqual([]);
  });

  it.each(SW_EMERGENCY_BYPASS_CANONICAL)(
    "SW denylist includes %s in source text",
    (path) => {
      expect(swSource).toContain(`"${path}"`);
    },
  );

  it.each(CODE_BLUE_MUTATION_INVENTORY)(
    "classifyEmergencyEndpoint classifies Code Blue mutation: $label",
    ({ url, method, expected }) => {
      expect(classifyEmergencyEndpoint(url, method)).toBe(expected);
    },
  );

  it.each(LIVE_READ_NOT_CLASSIFIER_MUTATIONS)(
    "live read $label is SW-bypassed but not an emergency mutation classifier match",
    ({ url, method }) => {
      expect(classifyEmergencyEndpoint(url, method)).toBeNull();
      const swCovers = swPaths.some(
        (p) => url === p || url.startsWith(`${p}/`),
      );
      expect(
        swCovers,
        `${url} must be covered by EMERGENCY_BYPASS_PATHS (exact or prefix)`,
      ).toBe(true);
    },
  );

  it("POST /api/realtime/telemetry is not classified as Code Blue emergency mutation", () => {
    expect(classifyEmergencyEndpoint("/api/realtime/telemetry", "POST")).toBeNull();
    expect(swPaths).toContain("/api/realtime/telemetry");
  });
});
