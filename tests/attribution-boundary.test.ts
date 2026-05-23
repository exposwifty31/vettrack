/**
 * Attribution boundary — unit contract tests.
 *
 * Rule: retrieval surfaces never expose staff names; audit surfaces (admin-only) always do.
 *
 * These tests verify the pure stripping logic used in:
 *   - GET /api/equipment/:id/logs   (staffName / staffRole)
 *   - GET /api/rooms/:id/activity   (userName)
 *
 * They run without a DB or HTTP server — they test the transformation inline.
 */

import { describe, it, expect } from "vitest";

// ── Helpers that mirror the route logic ──────────────────────────────────────

type RawScanLogRow = {
  id: string;
  clinicId: string;
  equipmentId: string;
  userId: string | null;
  userEmail: string;
  status: string;
  note: string | null;
  photoUrl: string | null;
  timestamp: Date;
  staffName: string | null;
  staffRole: string | null;
};

function stripScanLogAttribution(rows: RawScanLogRow[], isAdmin: boolean) {
  return isAdmin
    ? rows
    : rows.map(({ staffName: _sn, staffRole: _sr, ...rest }) => rest);
}

type RawActivityRow = {
  id: string;
  userId: string | null;
  userEmail: string;
  userName: string | null;
  equipmentId: string;
  equipmentName: string | null;
  status: string | null;
  note: string | null;
  timestamp: string;
};

function stripActivityAttribution(rows: RawActivityRow[], isAdmin: boolean) {
  return rows.map(({ userName, ...e }) => ({
    ...(isAdmin ? { userName } : {}),
    ...e,
  }));
}

// ── Test data ────────────────────────────────────────────────────────────────

const sampleScanRow: RawScanLogRow = {
  id: "log-1",
  clinicId: "clinic-a",
  equipmentId: "eq-1",
  userId: "user-1",
  userEmail: "tech@vet.com",
  status: "ok",
  note: null,
  photoUrl: null,
  timestamp: new Date("2025-01-01T10:00:00Z"),
  staffName: "Jane Tech",
  staffRole: "technician",
};

const sampleActivityRow: RawActivityRow = {
  id: "log-2",
  userId: "user-2",
  userEmail: "dr.smith@vet.com",
  userName: "Dr. Smith",
  equipmentId: "eq-2",
  equipmentName: "Defibrillator",
  status: "ok",
  note: null,
  timestamp: "2025-01-01T11:00:00Z",
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("attribution boundary — scan log endpoint", () => {
  it("admin caller receives staffName and staffRole", () => {
    const result = stripScanLogAttribution([sampleScanRow], true);
    expect(result[0]).toHaveProperty("staffName", "Jane Tech");
    expect(result[0]).toHaveProperty("staffRole", "technician");
  });

  it("non-admin caller does not receive staffName or staffRole", () => {
    const result = stripScanLogAttribution([sampleScanRow], false);
    expect(result[0]).not.toHaveProperty("staffName");
    expect(result[0]).not.toHaveProperty("staffRole");
  });

  it("non-admin response still contains operational fields", () => {
    const result = stripScanLogAttribution([sampleScanRow], false);
    const row = result[0];
    expect(row).toHaveProperty("id", "log-1");
    expect(row).toHaveProperty("userEmail", "tech@vet.com");
    expect(row).toHaveProperty("status", "ok");
    expect(row).toHaveProperty("timestamp");
  });

  it("handles null staffName / staffRole gracefully for both roles", () => {
    const nullRow: RawScanLogRow = { ...sampleScanRow, staffName: null, staffRole: null };
    const admin = stripScanLogAttribution([nullRow], true);
    const nonAdmin = stripScanLogAttribution([nullRow], false);
    expect(admin[0]).toHaveProperty("staffName", null);
    expect(nonAdmin[0]).not.toHaveProperty("staffName");
  });

  it("processes multiple rows correctly", () => {
    const rows = [sampleScanRow, { ...sampleScanRow, id: "log-99" }];
    const result = stripScanLogAttribution(rows, false);
    expect(result).toHaveLength(2);
    result.forEach((r) => {
      expect(r).not.toHaveProperty("staffName");
      expect(r).not.toHaveProperty("staffRole");
    });
  });
});

describe("attribution boundary — room activity endpoint", () => {
  it("admin caller receives userName", () => {
    const result = stripActivityAttribution([sampleActivityRow], true);
    expect(result[0]).toHaveProperty("userName", "Dr. Smith");
  });

  it("non-admin caller does not receive userName", () => {
    const result = stripActivityAttribution([sampleActivityRow], false);
    expect(result[0]).not.toHaveProperty("userName");
  });

  it("non-admin response still contains operational fields", () => {
    const result = stripActivityAttribution([sampleActivityRow], false);
    const row = result[0];
    expect(row).toHaveProperty("id", "log-2");
    expect(row).toHaveProperty("userEmail", "dr.smith@vet.com");
    expect(row).toHaveProperty("equipmentName", "Defibrillator");
    expect(row).toHaveProperty("status", "ok");
  });

  it("handles null userName gracefully", () => {
    const nullRow = { ...sampleActivityRow, userName: null };
    const admin = stripActivityAttribution([nullRow], true);
    const nonAdmin = stripActivityAttribution([nullRow], false);
    expect(admin[0]).toHaveProperty("userName", null);
    expect(nonAdmin[0]).not.toHaveProperty("userName");
  });
});
