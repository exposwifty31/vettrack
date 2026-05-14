/**
 * Phase 2B.2 guard — dispense endpoints enforce clinical authority.
 *
 * Static source assertions that the three dispense endpoints
 * (POST /draft, POST /:id/confirm, POST /emergency) each call
 * requireClinicalAuthority with the agreed Phase 2B.2 options,
 * and that the file does not regress to legacy or forbidden patterns.
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

function blockAfter(marker: string): string {
  const idx = dispenseSource.indexOf(marker);
  expect(idx, `expected to find ${marker} in dispense.ts`).toBeGreaterThan(-1);
  // Slice the next ~600 chars to cover the requireClinicalAuthority({...}) call.
  return dispenseSource.slice(idx, idx + 600);
}

function expectAuthorityCallShape(block: string): void {
  expect(block).toMatch(/requireClinicalAuthority\(\s*\{/);
  expect(block).toMatch(
    /allow:\s*\[\s*"vet"\s*,\s*"senior_technician"\s*,\s*"technician"\s*\]/,
  );
  expect(block).toMatch(
    /allowPermanentClinicalRoleFallbackForLegacyDispense:\s*true/,
  );
  expect(block).not.toMatch(/allowSystemAdmin/);
}

describe("Phase 2B.2: dispense endpoints enforce requireClinicalAuthority", () => {
  it("POST /draft is guarded by requireClinicalAuthority({...})", () => {
    expectAuthorityCallShape(blockAfter('router.post(\n  "/draft"'));
  });

  it("POST /:id/confirm is guarded by requireClinicalAuthority({...})", () => {
    expectAuthorityCallShape(blockAfter('router.post(\n  "/:id/confirm"'));
  });

  it("POST /emergency is guarded by requireClinicalAuthority({...})", () => {
    expectAuthorityCallShape(blockAfter('router.post(\n  "/emergency"'));
  });

  it("requireClinicalAuthority( appears exactly 3 times in dispense.ts", () => {
    const matches = dispenseSource.match(/requireClinicalAuthority\(/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(3);
  });

  it("allowPermanentClinicalRoleFallbackForLegacyDispense appears exactly 3 times", () => {
    const matches = dispenseSource.match(
      /allowPermanentClinicalRoleFallbackForLegacyDispense/g,
    );
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(3);
  });

  it("no dispense endpoint passes allowSystemAdmin", () => {
    expect(dispenseSource).not.toContain("allowSystemAdmin");
  });

  it("requireClinicalUser remains at router level", () => {
    expect(dispenseSource).toMatch(
      /router\.use\s*\([^)]*requireAuth[^)]*requireClinicalUser[^)]*\)/,
    );
    expect(dispenseSource).toContain("requireClinicalUser");
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

  it("dispense.ts does not contain requireEffectiveRole", () => {
    expect(dispenseSource).not.toContain("requireEffectiveRole");
  });

  it("no TODO(Phase 2B) markers remain", () => {
    expect(dispenseSource).not.toMatch(/TODO\(Phase 2B\)/);
  });
});
