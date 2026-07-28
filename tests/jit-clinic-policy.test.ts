import { describe, it, expect } from "vitest";
import { decideJitClinicPolicy } from "../server/lib/auth/jit-clinic-policy.js";

// C-6 incident hardening: a session org with NO vt_clinics row must never mint
// a clinic as a side effect of sign-in — except the deliberate ADMIN_EMAILS
// bootstrap. Existing users keep working (their DB clinic wins regardless).
describe("decideJitClinicPolicy", () => {
  it("known clinic → proceed (mint path is a no-op there)", () => {
    expect(decideJitClinicPolicy({ clinicExists: true, adminEmail: false, hasExistingUser: false })).toBe("proceed");
    expect(decideJitClinicPolicy({ clinicExists: true, adminEmail: true, hasExistingUser: true })).toBe("proceed");
  });

  it("unknown org + admin allowlist email → proceed-mint (deliberate new-clinic bootstrap)", () => {
    expect(decideJitClinicPolicy({ clinicExists: false, adminEmail: true, hasExistingUser: false })).toBe("proceed-mint");
  });

  it("unknown org + existing vt_users row → proceed-existing (upsert keeps the DB clinic; no clinic row minted)", () => {
    expect(decideJitClinicPolicy({ clinicExists: false, adminEmail: false, hasExistingUser: true })).toBe("proceed-existing");
  });

  it("unknown org + no row + non-admin → block-clinicless (join-code screen takes over)", () => {
    expect(decideJitClinicPolicy({ clinicExists: false, adminEmail: false, hasExistingUser: false })).toBe("block-clinicless");
  });
});
