/**
 * Static-analysis tests for dispense route auth wiring.
 *
 * The FIRST block verifies the frozen `requireClinicalUser` middleware itself —
 * still exported from auth.ts and still used by Code Blue + clinical-check-in
 * routes, where students MUST stay blocked:
 *  1. requireClinicalUser is exported from server/middleware/auth.ts
 *  2. The Set contains ONLY real normalizeUserRole-emittable roles
 *  3. Phantom roles (lead_technician, vet_tech) are NOT in the Set
 *  4. student is not in the Set (explicitly blocked — clinical routes)
 *
 * The SECOND block verifies dispense.ts wiring AFTER T26 reclassified inventory
 * dispense as NON-clinical consumables work: the router now gates on
 * `requireEffectiveRole("student")` (the role floor, admits all staff incl. a
 * supervised student) and no longer uses requireClinicalUser.
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

describe("dispense route — non-clinical student-floor wiring (T26)", () => {
  it("imports requireEffectiveRole from auth middleware", () => {
    expect(dispenseRoute).toMatch(/import\s*\{[^}]*requireEffectiveRole[^}]*\}/);
  });

  it("applies requireEffectiveRole(\"student\") at router level (admits all staff, incl. students)", () => {
    expect(dispenseRoute).toMatch(/router\.use\([^)]*requireAuth[^)]*requireEffectiveRole\(\s*["']student["']\s*\)[^)]*\)/);
  });

  it("no longer gates students out via requireClinicalUser", () => {
    expect(dispenseRoute).not.toContain("requireClinicalUser");
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
