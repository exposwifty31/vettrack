/**
 * The preflight is a merge-blocking gate, so its own branches need tests —
 * a guard that has only ever seen good input is untested.
 *
 * Only the pure predicates are exercised here. The I/O half (pg connect) is
 * covered by the CI step itself: if the database were unreachable there, the
 * preflight fails the job, which is the behavior under test.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateDatabaseUrl,
  evaluateSchema,
} from "../scripts/ci/db-integration-preflight.mjs";

describe("evaluateDatabaseUrl", () => {
  it("refuses an unset DATABASE_URL", () => {
    const verdict = evaluateDatabaseUrl(undefined);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/unset/i);
  });

  it("refuses an empty DATABASE_URL", () => {
    expect(evaluateDatabaseUrl("").ok).toBe(false);
  });

  // A whitespace-only value is the shape a misconfigured CI secret takes —
  // present to `if (process.env.X)` but useless to pg.
  it("refuses a whitespace-only DATABASE_URL", () => {
    expect(evaluateDatabaseUrl("   ").ok).toBe(false);
  });

  it("accepts a real connection string", () => {
    const verdict = evaluateDatabaseUrl("postgresql://vettrack:vettrack@localhost:5432/vettrack_test");
    expect(verdict.ok).toBe(true);
    expect(verdict.message).toBe("");
  });
});

describe("evaluateSchema", () => {
  // The drift case: database up, migrations 181-184 not applied. Without this
  // branch the doctor-gate suite runs and fails deep inside itself instead.
  it("refuses when vt_clinical_check_ins is absent", () => {
    const verdict = evaluateSchema(0);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/181-184/);
  });

  it("accepts exactly one matching row", () => {
    expect(evaluateSchema(1).ok).toBe(true);
  });

  // Defensive: anything other than exactly one row is not a state we understand,
  // so it must refuse rather than round up to ok.
  it("refuses an unexpected row count", () => {
    expect(evaluateSchema(2).ok).toBe(false);
  });
});
