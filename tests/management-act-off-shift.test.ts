/**
 * Track D / Phase 5 — the shift-wall on the management console.
 *
 * `lead` (senior_technician + lead_technician) reaches the web console via
 * `management.web` but does NOT hold `equipment.actOffShift` — so wiring the desktop
 * path to that capability, as this plan originally proposed, would have left exactly
 * the walled managers walled.
 *
 * Owner decision: add a distinct `management.actOffShift` rather than widening
 * `equipment.actOffShift` to `lead`. Widening the existing grant would relax the wall
 * on MOBILE/NATIVE for leads too, which Track D explicitly does not want; a separate
 * capability keeps the field-tech gate and the management gate independently
 * steerable.
 */
import { describe, it, expect } from "vitest";
import { buildRoleExperience, can } from "@/lib/roles/experience-model";

const exp = (role: string, isAdmin = false) =>
  buildRoleExperience({ role, effectiveRole: role, roleSource: "permanent", isAdmin } as never);

describe("management.actOffShift grants", () => {
  it("is held by the roles that actually reach the console", () => {
    for (const role of ["admin", "senior_technician", "lead_technician"]) {
      expect(can(exp(role), "management.actOffShift")).toBe(true);
    }
  });

  it("is held by a secondary admin, like the other management capabilities", () => {
    expect(can(exp("vet", true), "management.actOffShift")).toBe(true);
  });

  it("is NOT held by floor roles that never reach the console", () => {
    for (const role of ["technician", "vet_tech", "student"]) {
      expect(can(exp(role), "management.actOffShift")).toBe(false);
    }
  });

  it("leaves equipment.actOffShift untouched — the field-tech gate is unchanged", () => {
    // lead still lacks the mobile/native exemption; only the console one is new.
    expect(can(exp("senior_technician"), "equipment.actOffShift")).toBe(false);
    expect(can(exp("technician"), "equipment.actOffShift")).toBe(false);
    expect(can(exp("admin"), "equipment.actOffShift")).toBe(true);
    expect(can(exp("vet"), "equipment.actOffShift")).toBe(true);
  });
});
