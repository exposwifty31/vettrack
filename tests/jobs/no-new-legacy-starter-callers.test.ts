/**
 * B2a — ratchet: production must not gain new callers of legacy start*Worker
 * starters superseded by Phase 1b {@link startJobRuntime}.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Legacy BullMQ worker starters kept for compatibility; new wiring must use
 * startJobRuntime instead of calling these directly.
 */
const LEGACY_START_WORKER_NAMES = [
  "startChargeAlertWorker",
  "startInventoryDeductionWorker",
] as const;

/** `relative/path.ts:symbol` — frozen allowlist of production import/call sites. */
type LegacyStarterCallerRef = `${string}:${(typeof LEGACY_START_WORKER_NAMES)[number]}`;

/**
 * Current production callers on main (empty — definitions live in worker modules only).
 * Add an entry here only when a deliberate, reviewed production caller exists.
 */
const ALLOWED_LEGACY_STARTER_CALLERS: readonly LegacyStarterCallerRef[] = [];

const PRODUCTION_SCAN_ROOTS = ["server"] as const;
const SKIP_DIR_NAMES = new Set(["node_modules", "dist", ".git"]);

function isLegacyStarterDefinition(line: string, name: string): boolean {
  return new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`).test(line);
}

function isLegacyStarterCallerLine(line: string, name: string): boolean {
  if (isLegacyStarterDefinition(line, name)) return false;
  if (new RegExp(`\\bimport\\b[^;\\n]*\\b${name}\\b`).test(line)) return true;
  if (new RegExp(`\\b${name}\\s*\\(`).test(line)) return true;
  return false;
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.(ts|js|tsx|jsx|mjs|cjs)$/.test(ent.name)) {
      out.push(full);
    }
  }
  return out;
}

function findLegacyStarterCallersInProduction(): LegacyStarterCallerRef[] {
  const found = new Set<LegacyStarterCallerRef>();

  for (const root of PRODUCTION_SCAN_ROOTS) {
    const absRoot = path.join(repoRoot, root);
    if (!fs.existsSync(absRoot)) continue;

    for (const filePath of collectSourceFiles(absRoot)) {
      const rel = path.relative(repoRoot, filePath).replace(/\\/g, "/");
      const lines = fs.readFileSync(filePath, "utf8").split("\n");

      for (const name of LEGACY_START_WORKER_NAMES) {
        for (const line of lines) {
          if (isLegacyStarterCallerLine(line, name)) {
            found.add(`${rel}:${name}`);
          }
        }
      }
    }
  }

  return [...found].sort();
}

describe("B2a — no new legacy start*Worker callers", () => {
  it("has zero production callers beyond the frozen allowlist", () => {
    const callers = findLegacyStarterCallersInProduction();
    const allowed = [...ALLOWED_LEGACY_STARTER_CALLERS].sort();

    expect(callers).toEqual(allowed);
    expect(callers).toMatchInlineSnapshot(`[]`);
  });

  it("detects import/call usage (would fail if a new production caller were added)", () => {
    expect(
      isLegacyStarterCallerLine(
        'import { startChargeAlertWorker } from "../workers/chargeAlertWorker.js";',
        "startChargeAlertWorker",
      ),
    ).toBe(true);
    expect(
      isLegacyStarterDefinition(
        "export async function startChargeAlertWorker(): Promise<void> {",
        "startChargeAlertWorker",
      ),
    ).toBe(true);
    expect(
      isLegacyStarterCallerLine(
        "export async function startChargeAlertWorker(): Promise<void> {",
        "startChargeAlertWorker",
      ),
    ).toBe(false);
  });
});
