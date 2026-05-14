/**
 * Phase 2.5 PR 1 — shared authority type-level tests.
 *
 * These tests are compile-checks, not runtime assertions. They confirm:
 *   - OperationalRole accepts null and each non-"unknown" value from
 *     DoctorOperationalShiftRole, but rejects "unknown".
 *   - AuthorityReason includes the new Phase 2.5 values.
 *   - AuthoritySource includes "check_in".
 *
 * No new runtime behaviour is introduced — the resolver still emits the
 * Phase 2A subset of values. PR 1 only widens the unions.
 */
import { describe, expect, it } from "vitest";
import type {
  AuthorityReason,
  AuthoritySource,
  OperationalRole,
} from "../shared/authority.js";
import type { DoctorOperationalShiftRole } from "../shared/doctor-operational-shift.js";

// Compile-time helper: forces TS to error if `T` is not assignable.
function assignable<T>(_value: T): void {
  // no-op at runtime; the type parameter is what matters.
}

describe("OperationalRole (Phase 2.5 widening)", () => {
  it("accepts null", () => {
    const value: OperationalRole = null;
    assignable<OperationalRole>(value);
    expect(value).toBeNull();
  });

  it("accepts each DoctorOperationalShiftRole except 'unknown'", () => {
    const admission: OperationalRole = "admission";
    const ward: OperationalRole = "ward";
    const seniorLead: OperationalRole = "senior_lead";
    const nightAdmissionOnly: OperationalRole = "night_admission_only";
    const nightSeniorNoAdmission: OperationalRole = "night_senior_no_admission";

    assignable<OperationalRole>(admission);
    assignable<OperationalRole>(ward);
    assignable<OperationalRole>(seniorLead);
    assignable<OperationalRole>(nightAdmissionOnly);
    assignable<OperationalRole>(nightSeniorNoAdmission);

    expect([
      admission,
      ward,
      seniorLead,
      nightAdmissionOnly,
      nightSeniorNoAdmission,
    ]).toEqual([
      "admission",
      "ward",
      "senior_lead",
      "night_admission_only",
      "night_senior_no_admission",
    ]);
  });

  it("rejects 'unknown'", () => {
    // The "unknown" sentinel from DoctorOperationalShiftRole must NOT be
    // assignable to OperationalRole. If this line ever compiles, the type
    // widening regressed and the @ts-expect-error must be removed —
    // intentionally fail compilation here to surface that regression.
    // @ts-expect-error — "unknown" is excluded from OperationalRole
    const bad: OperationalRole = "unknown";
    // The runtime value is irrelevant; this assertion exists only so the
    // declaration above is not removed by an aggressive bundler.
    expect(bad as unknown as string).toBe("unknown");
  });

  it("DoctorOperationalShiftRole is the source of truth for the widening domain", () => {
    // Type-only check: every non-"unknown" DoctorOperationalShiftRole is a
    // valid OperationalRole.
    type NonUnknown = Exclude<DoctorOperationalShiftRole, "unknown">;
    const sample: NonUnknown = "admission";
    assignable<OperationalRole>(sample);
    expect(sample).toBe("admission");
  });
});

describe("AuthorityReason (Phase 2.5 additions)", () => {
  it("accepts the new Phase 2.5 reason codes", () => {
    const checkedIn: AuthorityReason = "CHECKED_IN";
    const cached: AuthorityReason = "CACHED";
    const notCheckedIn: AuthorityReason = "NOT_CHECKED_IN";
    const checkedInNoOpRole: AuthorityReason = "CHECKED_IN_NO_OPROLE";

    assignable<AuthorityReason>(checkedIn);
    assignable<AuthorityReason>(cached);
    assignable<AuthorityReason>(notCheckedIn);
    assignable<AuthorityReason>(checkedInNoOpRole);

    expect([checkedIn, cached, notCheckedIn, checkedInNoOpRole]).toEqual([
      "CHECKED_IN",
      "CACHED",
      "NOT_CHECKED_IN",
      "CHECKED_IN_NO_OPROLE",
    ]);
  });
});

describe("AuthoritySource (Phase 2.5 additions)", () => {
  it("accepts 'check_in'", () => {
    const value: AuthoritySource = "check_in";
    assignable<AuthoritySource>(value);
    expect(value).toBe("check_in");
  });
});
