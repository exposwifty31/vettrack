import { describe, it, expect } from "vitest";
import { planClerkOrgCleanup } from "../server/services/account-deletion.service.js";

// Sole-org-admin hardening: before deleting the Clerk user, junk orgs the user
// solely occupies (no matching vt_clinics row) are deleted so Clerk never
// accumulates ownerless artifacts; being the SOLE member of a REAL clinic org
// blocks self-deletion instead of orphaning the clinic.
describe("planClerkOrgCleanup", () => {
  const known = new Set(["org_real_clinic"]);

  it("sole member of an unknown (junk) org → deletable", () => {
    const plan = planClerkOrgCleanup([{ orgId: "org_junk", membersCount: 1 }], known);
    expect(plan.deletableOrgIds).toEqual(["org_junk"]);
    expect(plan.blockingClinicOrgIds).toEqual([]);
  });

  it("sole member of a REAL clinic org → blocks deletion", () => {
    const plan = planClerkOrgCleanup([{ orgId: "org_real_clinic", membersCount: 1 }], known);
    expect(plan.deletableOrgIds).toEqual([]);
    expect(plan.blockingClinicOrgIds).toEqual(["org_real_clinic"]);
  });

  it("multi-member orgs are never touched, known or not", () => {
    const plan = planClerkOrgCleanup(
      [{ orgId: "org_real_clinic", membersCount: 13 }, { orgId: "org_junk", membersCount: 2 }],
      known,
    );
    expect(plan.deletableOrgIds).toEqual([]);
    expect(plan.blockingClinicOrgIds).toEqual([]);
  });

  it("no memberships → empty plan", () => {
    const plan = planClerkOrgCleanup([], known);
    expect(plan).toEqual({ deletableOrgIds: [], blockingClinicOrgIds: [] });
  });
});
