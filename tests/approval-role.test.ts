/**
 * C3 (gated role-onboarding): on admin approval (pending → active) the user is
 * promoted to their self-requested role, so the admin no longer re-selects it.
 * The vet grant is gated: vet = clinical authority level 30 ("dangerous"), so a
 * vet approval requires a doctor/license number on the row.
 */
import { describe, it, expect } from "vitest";
import { resolveApprovalRole } from "../server/lib/approval-role.js";

describe("resolveApprovalRole (C3)", () => {
  it("promotes an approved user to their requested tech role", () => {
    expect(
      resolveApprovalRole({
        currentStatus: "pending",
        newStatus: "active",
        requestedRole: "technician",
        overrideRole: null,
        vetLicenseNumber: null,
      }),
    ).toEqual({ ok: true, roleToApply: "technician" });
  });

  it("promotes an approved user to vet when a license number is present", () => {
    expect(
      resolveApprovalRole({
        currentStatus: "pending",
        newStatus: "active",
        requestedRole: "vet",
        overrideRole: null,
        vetLicenseNumber: "MD-12345",
      }),
    ).toEqual({ ok: true, roleToApply: "vet" });
  });

  it("blocks a vet approval when the license number is missing/blank", () => {
    expect(
      resolveApprovalRole({
        currentStatus: "pending",
        newStatus: "active",
        requestedRole: "vet",
        overrideRole: null,
        vetLicenseNumber: "   ",
      }),
    ).toEqual({ ok: false, error: "VET_LICENSE_REQUIRED" });
  });

  it("lets an admin override the requested role (vet request → grant tech)", () => {
    expect(
      resolveApprovalRole({
        currentStatus: "pending",
        newStatus: "active",
        requestedRole: "vet",
        overrideRole: "technician",
        vetLicenseNumber: null,
      }),
    ).toEqual({ ok: true, roleToApply: "technician" });
  });

  it("does not change the role outside the pending→active approval (e.g. re-activating a blocked user)", () => {
    expect(
      resolveApprovalRole({
        currentStatus: "blocked",
        newStatus: "active",
        requestedRole: "vet",
        overrideRole: null,
        vetLicenseNumber: null,
      }),
    ).toEqual({ ok: true, roleToApply: null });
  });

  it("applies no role when there is neither a requested role nor an override", () => {
    expect(
      resolveApprovalRole({
        currentStatus: "pending",
        newStatus: "active",
        requestedRole: null,
        overrideRole: null,
        vetLicenseNumber: null,
      }),
    ).toEqual({ ok: true, roleToApply: null });
  });
});
