/**
 * T26 guard — dispense endpoints are NON-clinical consumables dispense.
 *
 * Inventory dispense was reclassified as non-clinical (drug formulary removed,
 * migrations 142-143). The three dispense endpoints (POST /draft,
 * POST /:id/confirm, POST /emergency) are no longer gated by clinical authority;
 * the router admits any authenticated staff member down to the student floor via
 * `requireEffectiveRole("student")`. Clinical authority (STUDENT_NEVER_ELEVATED /
 * requireClinicalAuthority) is untouched and still gates Code Blue + genuinely-
 * clinical routes — this file asserts dispense.ts has fully shed the clinical gate.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const dispenseSource = fs.readFileSync(
  path.join(repoRoot, "server", "routes", "dispense.ts"),
  "utf8",
);

describe("T26: dispense endpoints are non-clinical (no clinical-authority gate)", () => {
  it("dispense.ts contains no requireClinicalAuthority call (reclassified non-clinical)", () => {
    const matches = dispenseSource.match(/requireClinicalAuthority\(/g);
    expect(matches).toBeNull();
  });

  it("dispense.ts no longer references the legacy dispense fallback flag", () => {
    expect(dispenseSource).not.toContain(
      "allowPermanentClinicalRoleFallbackForLegacyDispense",
    );
  });

  it("dispense.ts does not import the authority middleware module", () => {
    expect(dispenseSource).not.toMatch(
      /from\s+["'][^"']*middleware\/authority[^"']*["']/,
    );
  });

  it("router-level gate is requireEffectiveRole(\"student\") (admits all staff incl. students)", () => {
    expect(dispenseSource).toMatch(
      /router\.use\s*\([^)]*requireAuth[^)]*requireEffectiveRole\(\s*["']student["']\s*\)[^)]*\)/,
    );
  });

  it("does not gate students out via requireClinicalUser", () => {
    expect(dispenseSource).not.toContain("requireClinicalUser");
  });

  it("no endpoint passes allowSystemAdmin", () => {
    expect(dispenseSource).not.toContain("allowSystemAdmin");
  });

  it("dispense.ts does not reference secondaryRole", () => {
    expect(dispenseSource).not.toContain("secondaryRole");
  });

  it("dispense.ts does not import resolveAuthority", () => {
    expect(dispenseSource).not.toMatch(
      /import\s*\{[^}]*resolveAuthority[^}]*\}\s*from/,
    );
  });

  it("dispense.ts does not contain the literal resolveAuthority", () => {
    expect(dispenseSource).not.toContain("resolveAuthority");
  });

  it("no TODO(Phase 2B) markers remain", () => {
    expect(dispenseSource).not.toMatch(/TODO\(Phase 2B\)/);
  });
});
