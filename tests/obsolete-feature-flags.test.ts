/**
 * Regression guards for removed feature flags / kill switches.
 * Active rollout env flags (ENABLE_SERVICE_TASK_MODE, AUTHORITY_*, PILOT_MODE, …)
 * are intentionally not listed here — see server/lib/feature-flags.ts and .env.example.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const REMOVED_SYMBOLS = [
  "DISABLE_EQUIPMENT_OPERATIONAL_STATE_V1",
  "isOperationalStateFeatureEnabled",
  "DISABLE_INVENTORY_ENQUEUE",
] as const;

/** Application source only — tests may mention removed symbols in regression guards. */
const SCAN_ROOTS = ["server", "src", "shared"] as const;
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

function walk(dir: string, out: string[]): void {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "dist") continue;
      walk(full, out);
      continue;
    }
    const ext = path.extname(ent.name);
    if (!SCAN_EXTENSIONS.has(ext)) continue;
    out.push(full);
  }
}

function readRepoSources(): string {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    const abs = path.join(repoRoot, root);
    if (fs.existsSync(abs)) walk(abs, files);
  }
  return files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
}

describe("obsolete feature flags (regression)", () => {
  it(".env.example does not assign removed WebSocket client URL env var", () => {
    const envExample = fs.readFileSync(path.join(repoRoot, ".env.example"), "utf8");
    expect(/^VITE_WS_URL\s*=/m.test(envExample)).toBe(false);
    expect(envExample.includes("/api/realtime/stream")).toBe(true);
  });

  it("removed kill-switch symbols are absent from server/src/shared", () => {
    const blob = readRepoSources();
    for (const sym of REMOVED_SYMBOLS) {
      expect(blob.includes(sym)).toBe(false);
    }
  });

  it("bundle readiness gate has no featureEnabled parameter", () => {
    const service = fs.readFileSync(
      path.join(repoRoot, "server", "services", "equipment-operational-state.service.ts"),
      "utf8",
    );
    expect(service.includes("featureEnabled")).toBe(false);
    expect(service.includes("computeBundleReadinessGate(")).toBe(true);
    expect(service.includes("FEATURE_DISABLED")).toBe(false);
    expect(service.includes("skipped: true")).toBe(false);
  });

  it("AUTHORITY_OBS_V1 env check exists only in isAuthorityObsV1Enabled", () => {
    const needle = 'process.env.AUTHORITY_OBS_V1 === "true"';
    const authorityAudit = fs.readFileSync(
      path.join(repoRoot, "server", "lib", "authority-audit.ts"),
      "utf8",
    );
    expect(authorityAudit.includes(needle)).toBe(true);

    const files: string[] = [];
    for (const root of SCAN_ROOTS) {
      const abs = path.join(repoRoot, root);
      if (fs.existsSync(abs)) walk(abs, files);
    }
    const otherHits = files.filter((f) => {
      if (f.endsWith("authority-audit.ts")) return false;
      return fs.readFileSync(f, "utf8").includes(needle);
    });
    expect(otherHits).toEqual([]);
  });
});
