/**
 * Static-analysis tests for dispense route auth hardening (PR 1.4).
 *
 * Verifies that:
 *  1. requireClinicalUser is exported from server/middleware/auth.ts
 *  2. The Set contains ONLY real normalizeUserRole-emittable roles
 *  3. Phantom roles (lead_technician, vet_tech) are NOT in the Set
 *  4. student is not in the Set (explicitly blocked)
 *  5. dispense.ts uses router-level requireClinicalUser (no per-endpoint duplicates)
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const authMiddleware = read("server/middleware/auth.ts");
const dispenseRoute = read("server/routes/dispense.ts");

// Slice from the module-scope CLINICAL_ROLES const through the requireClinicalUser function body.
// CLINICAL_ROLES was hoisted to module scope (above the function) to avoid recreating the Set
// on every request, so the slice must start at the const declaration, not the function keyword.
const clinicalConstStart = authMiddleware.indexOf("const CLINICAL_ROLES");
const clinicalFnStart = authMiddleware.indexOf("export function requireClinicalUser");
const clinicalFnEnd = authMiddleware.indexOf("\nexport function", clinicalFnStart + 1);
const clinicalFnBody = authMiddleware.slice(
  clinicalConstStart,
  clinicalFnEnd > clinicalConstStart ? clinicalFnEnd : clinicalConstStart + 1500,
);

// Narrow slice: just the CLINICAL_ROLES Set literal
const clinicalRolesStart = clinicalFnBody.indexOf("CLINICAL_ROLES");
const clinicalRolesEnd = clinicalFnBody.indexOf(";", clinicalRolesStart);
const clinicalRolesLiteral = clinicalFnBody.slice(clinicalRolesStart, clinicalRolesEnd + 1);

// ─────────────────────────────────────────────────────────────────────────────
// auth.ts — requireClinicalUser structure
// ─────────────────────────────────────────────────────────────────────────────

describe("requireClinicalUser — auth middleware", () => {
  it("is exported from auth.ts", () => {
    expect(authMiddleware).toContain("export function requireClinicalUser");
  });

  it("uses a Set of clinical roles", () => {
    expect(clinicalFnBody).toContain("CLINICAL_ROLES");
    expect(clinicalFnBody).toContain("new Set(");
  });

  it("allows admin role", () => {
    expect(clinicalRolesLiteral).toContain('"admin"');
  });

  it("allows vet role", () => {
    expect(clinicalRolesLiteral).toContain('"vet"');
  });

  it("allows senior_technician role", () => {
    expect(clinicalRolesLiteral).toContain('"senior_technician"');
  });

  it("allows technician role", () => {
    expect(clinicalRolesLiteral).toContain('"technician"');
  });

  it("does NOT include phantom role lead_technician (normalizeUserRole never emits it)", () => {
    expect(clinicalRolesLiteral).not.toContain('"lead_technician"');
  });

  it("does NOT include phantom role vet_tech (normalizeUserRole never emits it)", () => {
    expect(clinicalRolesLiteral).not.toContain('"vet_tech"');
  });

  it("does NOT include student (non-clinical role must be blocked)", () => {
    expect(clinicalRolesLiteral).not.toContain('"student"');
  });

  it("returns 403 INSUFFICIENT_ROLE for roles not in the Set", () => {
    expect(clinicalFnBody).toContain("403");
    expect(clinicalFnBody).toContain("INSUFFICIENT_ROLE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// dispense.ts — router-level wiring (no per-endpoint duplication)
// ─────────────────────────────────────────────────────────────────────────────

describe("dispense route — requireClinicalUser wiring", () => {
  it("imports requireClinicalUser from auth middleware", () => {
    expect(dispenseRoute).toMatch(/import\s*\{[^}]*requireClinicalUser[^}]*\}/);
  });

  it("applies requireClinicalUser at router level", () => {
    expect(dispenseRoute).toMatch(/router\.use\([^)]*requireAuth[^)]*requireClinicalUser[^)]*\)/);
  });

  it("draft route does not duplicate requireAuth at endpoint level", () => {
    const draftLine = dispenseRoute.match(/router\.post\(["']\/draft["'][^)]*\)/)?.[0] ?? "";
    expect(draftLine).not.toContain("requireAuth");
  });

  it("confirm route does not duplicate requireAuth at endpoint level", () => {
    const confirmLine = dispenseRoute.match(/router\.post\(["']\/:id\/confirm["'][^)]*\)/)?.[0] ?? "";
    expect(confirmLine).not.toContain("requireAuth");
  });

  it("emergency route does not duplicate requireAuth at endpoint level", () => {
    const emergencyLine = dispenseRoute.match(/router\.post\(["']\/emergency["'][^)]*\)/)?.[0] ?? "";
    expect(emergencyLine).not.toContain("requireAuth");
  });
});
