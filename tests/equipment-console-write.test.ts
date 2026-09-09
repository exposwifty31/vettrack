/**
 * `equipment.consoleWrite` — the write affordance on the desktop `/equipment` table.
 *
 * Deliberately NOT `management.webWrite`. That capability gates ten console pages
 * whose every route is `requireAdmin` (`server/middleware/auth.ts` — an identity
 * check, `req.authUser.role !== "admin"`, which ignores the role hierarchy and does
 * not honour secondaryRole). Granting it to `lead` would render ten pages that fail
 * their fetch plus destructive controls — revoke a display device, deactivate an RFID
 * reader, rotate an HMAC secret, change a user's role — that all 403.
 *
 * This capability sits on exactly one route: `PATCH /api/equipment/:id`, which is
 * `requireEffectiveRole("technician")`. `senior_technician` (25) clears `technician`
 * (20), and already performs this write from the equipment detail page. So this
 * surfaces an existing permission in the console rather than granting a new one.
 */
import { describe, it, expect } from "vitest";
import { buildRoleExperience, can } from "@/lib/roles/experience-model";

const exp = (role: string, isAdmin = false) =>
  buildRoleExperience({ role, effectiveRole: role, roleSource: "permanent", isAdmin } as never);

describe("equipment.consoleWrite grants", () => {
  it("is held by admin and by the lead archetype", () => {
    expect(can(exp("admin"), "equipment.consoleWrite")).toBe(true);
    expect(can(exp("senior_technician"), "equipment.consoleWrite")).toBe(true);
  });

  it("is held by a secondary admin, like the other management capabilities", () => {
    expect(can(exp("vet", true), "equipment.consoleWrite")).toBe(true);
  });

  it("is NOT held by floor roles", () => {
    for (const role of ["technician", "vet_tech", "student"]) {
      expect(can(exp(role), "equipment.consoleWrite")).toBe(false);
    }
  });

  /**
   * The load-bearing assertion. The point of adding a narrow capability was to give
   * `lead` the equipment control WITHOUT widening console access — so if a later edit
   * quietly hands `lead` the broad capability instead, this must fail.
   */
  it("does not widen management.webWrite — console access is unchanged", () => {
    expect(can(exp("senior_technician"), "management.webWrite")).toBe(false);
    expect(can(exp("technician"), "management.webWrite")).toBe(false);
    expect(can(exp("student"), "management.webWrite")).toBe(false);
    expect(can(exp("admin"), "management.webWrite")).toBe(true);
  });
});
