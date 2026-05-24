import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const repoRoot = path.resolve(__dirname, "..");
const automation = fs.readFileSync(path.join(repoRoot, "server", "services", "task-automation.service.ts"), "utf8");
const queue = fs.readFileSync(path.join(repoRoot, "server", "lib", "queue.ts"), "utf8");
const migration = fs.readFileSync(path.join(repoRoot, "migrations", "032_automation_escalation_columns.sql"), "utf8");
const db = fs.readFileSync(path.join(repoRoot, "server", "schema", "tasks.ts"), "utf8");

describe("Phase 3.4.1 Automation safety (static checks)", () => {
  it("Escalation sets escalatedTo/escalatedAt only; vet_id preserved; empty returning skips", () => {
    expect(
      automation.includes("isNull(appointments.escalatedAt)") &&
        automation.includes("escalatedTo:") &&
        !automation.includes("vetId: adminId") &&
        automation.includes("db_idempotent_noop")
    ).toBe(true);
  });

  it("Auto-assign guarded by pending + null vetId in UPDATE WHERE", () => {
    expect(
      automation.includes("isNull(appointments.vetId)") &&
        automation.includes("eq(appointments.status, \"pending\")") &&
        automation.includes("TASK_AUTO_ASSIGNED")
    ).toBe(true);
  });

  it("Stuck rule uses explicit 30-minute cutoff Date vs updatedAt", () => {
    expect(
      automation.includes("THIRTY_MIN_MS") &&
        automation.includes("getStuckUpdatedBeforeCutoff") &&
        automation.includes("lt(appointments.updatedAt, cutoff)") &&
        automation.includes("lt(appointments.updatedAt, stuckCutoff)")
    ).toBe(true);
  });

  it("Automation queue jobId includes minute bucket for retries", () => {
    expect(
      queue.includes("auto-${payload.kind}-${payload.taskId}-${bucket}") &&
        queue.includes("const bucket = Math.floor(Date.now() / 60000)")
    ).toBe(true);
  });

  it("Migration adds automation integrity columns", () => {
    expect(
      migration.includes("escalated_to") &&
        migration.includes("escalated_at") &&
        migration.includes("stuck_notified_at") &&
        migration.includes("prestart_reminder_at")
    ).toBe(true);
  });

  it("Drizzle schema matches migration", () => {
    expect(db.includes("escalatedTo") && db.includes("stuckNotifiedAt")).toBe(true);
  });

  it("Stuck notify guarded by stuck_notified_at column", () => {
    expect(automation.includes("isNull(appointments.stuckNotifiedAt)")).toBe(true);
  });

  it("Pre-start guarded by prestart_reminder_at", () => {
    expect(automation.includes("isNull(appointments.prestartReminderAt)")).toBe(true);
  });
});
