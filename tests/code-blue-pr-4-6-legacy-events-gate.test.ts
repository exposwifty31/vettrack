/**
 * Phase 4 PR 4.6 — Legacy /api/code-blue/events clinical-gate tests.
 *
 * Static-analysis tests over `server/routes/code-blue.ts` locking the
 * clinical gate on both legacy archive routes (POST /events and
 * PATCH /events/:id). No operational-role evaluator, no audit-kind /
 * counter additions — the legacy routes are scheduled for removal in a
 * future cleanup phase (master plan §14).
 *
 * Coverage:
 *   - POST /events uses requireClinicalUser + requireClinicalAuthority
 *   - PATCH /events/:id uses the same chain
 *   - both gates use allowSystemAdmin:false (master plan §17)
 *   - both use the standard clinical allow list
 *   - neither uses the legacy dispense fallback option
 *   - existing behavior (insert into vt_code_blue_events, audit emit,
 *     response shape) is preserved
 *   - no operational-role evaluator is wired (legacy archive contract)
 *   - no schema change
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const routeFile = path.join(repoRoot, "server", "routes", "code-blue.ts");
const routeSrc = fs.readFileSync(routeFile, "utf8");

function extractHandlerBlock(routeStartPattern: RegExp): string {
  const start = routeSrc.search(routeStartPattern);
  expect(start, `route ${routeStartPattern} not found`).toBeGreaterThanOrEqual(0);
  const end = routeSrc.indexOf("\nrouter.", start + 1);
  return routeSrc.slice(start, end > start ? end : start + 4000);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/code-blue/events  — legacy archive start
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/code-blue/events — clinical-gate (PR 4.6)", () => {
  const block = extractHandlerBlock(/router\.post\(\s*["']\/events["']/);

  it("uses requireClinicalUser before requireClinicalAuthority", () => {
    const userIdx = block.indexOf("requireClinicalUser");
    const authIdx = block.indexOf("requireClinicalAuthority");
    expect(userIdx).toBeGreaterThanOrEqual(0);
    expect(authIdx).toBeGreaterThanOrEqual(0);
    expect(userIdx).toBeLessThan(authIdx);
  });

  it("uses allowSystemAdmin: false (master plan §17)", () => {
    expect(block).toMatch(/allowSystemAdmin\s*:\s*false/);
  });

  it("uses the standard clinical allow list", () => {
    expect(block).toContain('"vet"');
    expect(block).toContain('"senior_technician"');
    expect(block).toContain('"technician"');
  });

  it("does NOT use the legacy dispense fallback option", () => {
    expect(block).not.toContain(
      "allowPermanentClinicalRoleFallbackForLegacyDispense",
    );
  });

  it("preserves the existing insert into vt_code_blue_events and code_blue_started audit", () => {
    expect(block).toContain("insert(codeBlueEvents)");
    expect(block).toContain('"code_blue_started"');
  });

  it("preserves the response shape ({ id, startedAt })", () => {
    expect(block).toMatch(/res\.status\(201\)\.json\(\s*\{\s*id\s*,/);
    expect(block).toContain("startedAt: startedAt.toISOString()");
  });

  it("does NOT wire any Phase 4 operational-role evaluator (legacy archive contract)", () => {
    const codeOnly = block.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(codeOnly).not.toContain("evaluateCodeBlueManagerForRoute");
    expect(codeOnly).not.toContain("evaluateDrugShockActorForRoute");
    expect(codeOnly).not.toContain("detectMidsessionManagerDrift");
    expect(codeOnly).not.toContain("computeCodeBlueManagerSnapshotDeny");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/code-blue/events/:id  — legacy archive close-out
// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/code-blue/events/:id — clinical-gate (PR 4.6)", () => {
  const block = extractHandlerBlock(/router\.patch\(\s*["']\/events\/:id["']/);

  it("uses requireClinicalUser before requireClinicalAuthority", () => {
    const userIdx = block.indexOf("requireClinicalUser");
    const authIdx = block.indexOf("requireClinicalAuthority");
    expect(userIdx).toBeGreaterThanOrEqual(0);
    expect(authIdx).toBeGreaterThanOrEqual(0);
    expect(userIdx).toBeLessThan(authIdx);
  });

  it("uses allowSystemAdmin: false (master plan §17)", () => {
    expect(block).toMatch(/allowSystemAdmin\s*:\s*false/);
  });

  it("uses the standard clinical allow list", () => {
    expect(block).toContain('"vet"');
    expect(block).toContain('"senior_technician"');
    expect(block).toContain('"technician"');
  });

  it("does NOT use the legacy dispense fallback option", () => {
    expect(block).not.toContain(
      "allowPermanentClinicalRoleFallbackForLegacyDispense",
    );
  });

  it("preserves the existing UPDATE on vt_code_blue_events and code_blue_ended audit", () => {
    expect(block).toContain(".update(codeBlueEvents)");
    expect(block).toContain('"code_blue_ended"');
  });

  it("does NOT wire any Phase 4 operational-role evaluator (legacy archive contract)", () => {
    const codeOnly = block.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(codeOnly).not.toContain("evaluateCodeBlueManagerForRoute");
    expect(codeOnly).not.toContain("evaluateDrugShockActorForRoute");
    expect(codeOnly).not.toContain("detectMidsessionManagerDrift");
    expect(codeOnly).not.toContain("computeCodeBlueManagerSnapshotDeny");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Forbidden-scope assertions (PR 4.6 scope discipline)
// ─────────────────────────────────────────────────────────────────────────────

describe("PR 4.6 — scope discipline", () => {
  it("legacy /events routes do NOT add any new audit kind", () => {
    // No legacy-events-specific audit kind was registered. The existing
    // code_blue_started / code_blue_ended kinds (PR 4.1 frozen) continue
    // to fire from the legacy archive code paths.
    const auditFile = path.join(repoRoot, "server", "lib", "audit.ts");
    const auditSrc = fs.readFileSync(auditFile, "utf8");
    expect(auditSrc).not.toContain("code_blue_event_clinical_gate_denied");
    expect(auditSrc).not.toContain("code_blue_event_authority_");
  });

  it("legacy /events routes do NOT add any new metric counter", () => {
    const metricsFile = path.join(repoRoot, "server", "lib", "metrics.ts");
    const metricsSrc = fs.readFileSync(metricsFile, "utf8");
    expect(metricsSrc).not.toContain("code_blue_event_clinical_gate_denied");
    expect(metricsSrc).not.toContain("code_blue_event_authority_");
  });

  it("no schema migration introduced (no new migration file for PR 4.6)", () => {
    const migrationsDir = path.join(repoRoot, "migrations");
    const files = fs.readdirSync(migrationsDir);
    // Filter to .sql files; check none reference legacy events authority.
    const matching = files.filter((f) =>
      /code.?blue.?events.?authority|legacy.?events.?authority/i.test(f),
    );
    expect(matching).toEqual([]);
  });

  it("server/routes/code-blue.ts is the only file modified for the gate (no parallel framework)", () => {
    // Sanity: requireClinicalAuthority is invoked from code-blue.ts (PR 4.2,
    // 4.3, 4.4a, 4.6 collectively) — but not from any other Code Blue support
    // file. The wiring helper / midsession helper / drug-shock helper /
    // evaluator do not invoke middleware.
    const supportFiles = [
      path.join(repoRoot, "server", "lib", "authority", "code-blue-manager.wiring.ts"),
      path.join(repoRoot, "server", "lib", "authority", "code-blue-manager-midsession.ts"),
      path.join(repoRoot, "server", "lib", "authority", "code-blue-log-drug-shock.ts"),
      path.join(repoRoot, "server", "lib", "authority", "enforcement", "code-blue-manager.evaluator.ts"),
    ];
    for (const f of supportFiles) {
      const src = fs.readFileSync(f, "utf8");
      const codeOnly = src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
      expect(
        codeOnly,
        `${path.basename(f)} must not invoke requireClinicalAuthority directly`,
      ).not.toContain("requireClinicalAuthority(");
    }
  });
});
