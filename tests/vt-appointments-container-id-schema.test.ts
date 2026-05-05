/**
 * Schema/migration regression test for vt_appointments.container_id.
 *
 * Reproduces the mismatch that caused:
 *   ERROR: column "container_id" does not exist   (table: vt_appointments)
 *
 * Does NOT require a database — verifies via static source analysis that:
 *   1. The Drizzle schema declares container_id on vt_appointments
 *   2. Migration 119 adds the column with IF NOT EXISTS guard
 *   3. All three query sites that reference appointments.containerId are present
 *      in source (regression guard: if column is removed, these should go too)
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const schemaSource = fs.readFileSync(
  path.resolve(__dirname, "../server/db.ts"),
  "utf8",
);

const migrationSource = fs.readFileSync(
  path.resolve(__dirname, "../migrations/119_vt_appointments_container_id.sql"),
  "utf8",
);

const validationSource = fs.readFileSync(
  path.resolve(__dirname, "../server/lib/dispense-order-validation.ts"),
  "utf8",
);

const workerSource = fs.readFileSync(
  path.resolve(__dirname, "../server/workers/inventory-deduction.worker.ts"),
  "utf8",
);

const appointmentsServiceSource = fs.readFileSync(
  path.resolve(__dirname, "../server/services/appointments.service.ts"),
  "utf8",
);

// ---------------------------------------------------------------------------
// 1. Drizzle schema declares the column
// ---------------------------------------------------------------------------

describe("Drizzle schema — vt_appointments.container_id", () => {
  it('containerId column is defined as text("container_id")', () => {
    expect(schemaSource).toContain('containerId: text("container_id")');
  });

  it("column is nullable (no .notNull() call on containerId line)", () => {
    const line = schemaSource
      .split("\n")
      .find((l) => l.includes('containerId: text("container_id")'));
    expect(line).toBeTruthy();
    expect(line).not.toContain(".notNull()");
  });

  it("schema comment explains the domain purpose (medication billing/deduction)", () => {
    expect(schemaSource).toContain("inventory container for billing");
  });
});

// ---------------------------------------------------------------------------
// 2. Migration 119 adds the column safely
// ---------------------------------------------------------------------------

describe("Migration 119 — ADD COLUMN IF NOT EXISTS container_id", () => {
  it("targets vt_appointments", () => {
    expect(migrationSource).toContain("vt_appointments");
  });

  it("uses ADD COLUMN IF NOT EXISTS (safe for repeated runs)", () => {
    expect(migrationSource).toMatch(/ADD COLUMN IF NOT EXISTS\s+container_id/i);
  });

  it("column is TEXT (matches Drizzle text() type)", () => {
    expect(migrationSource).toMatch(/container_id\s+TEXT/i);
  });

  it("no NOT NULL constraint (nullable, existing rows unaffected)", () => {
    const addLine = migrationSource
      .split("\n")
      .find((l) => /ADD COLUMN IF NOT EXISTS\s+container_id/i.test(l));
    expect(addLine).toBeTruthy();
    expect(addLine!.toUpperCase()).not.toContain("NOT NULL");
  });

  it("creates a partial index to cover the containerId filter query", () => {
    expect(migrationSource).toContain("idx_vt_appointments_container");
    expect(migrationSource).toContain("WHERE container_id IS NOT NULL");
  });
});

// ---------------------------------------------------------------------------
// 3. Query sites that reference appointments.containerId
//    (regression guard — these must stay in sync with the schema column)
// ---------------------------------------------------------------------------

describe("Query site — dispense-order-validation.ts", () => {
  it("selects appointments.containerId in the orphan-check query", () => {
    expect(validationSource).toContain("appointments.containerId");
  });

  it("filters on appointments.containerId in the WHERE clause", () => {
    expect(validationSource).toContain("eq(appointments.containerId, containerId)");
  });
});

describe("Query site — inventory-deduction.worker.ts", () => {
  it("selects containerId from appointments for the deduction job", () => {
    expect(workerSource).toContain("containerId: appointments.containerId");
  });
});

describe("Query site — appointments.service.ts", () => {
  it("uses resolveMedicationTaskContainerId helper (column + metadata fallback)", () => {
    expect(appointmentsServiceSource).toContain("resolveMedicationTaskContainerId");
  });

  it("prefers persisted column over legacy metadata.containerId", () => {
    expect(appointmentsServiceSource).toContain("Prefer persisted column; fall back to legacy metadata.containerId");
  });
});
