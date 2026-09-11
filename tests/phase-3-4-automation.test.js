import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const repoRoot = path.resolve(__dirname, "..");
const automation = fs.readFileSync(path.join(repoRoot, "server", "services", "task-automation.service.ts"), "utf8");
const queue = fs.readFileSync(path.join(repoRoot, "server", "lib", "queue.ts"), "utf8");
const audit = fs.readFileSync(path.join(repoRoot, "server", "lib", "audit.ts"), "utf8");
const worker = fs.readFileSync(path.join(repoRoot, "server", "workers", "notification.worker.main.ts"), "utf8");
const envExample = fs.readFileSync(path.join(repoRoot, ".env.example"), "utf8");

describe("Phase 3.4 Automation Engine (static checks)", () => {
  it("task-automation.service exposes scan, execute, assignment helpers", () => {
    expect(
      automation.includes("scanAndEnqueueAutomationJobs") &&
        automation.includes("executeAutomationJob") &&
        automation.includes("getAvailableTechnician") &&
        automation.includes("getAdminUserIdForClinic")
    ).toBe(true);
  });

  it("DB columns + returning() for automation idempotency", () => {
    expect(
      automation.includes("escalatedAt") &&
        automation.includes("isNull(appointments.escalatedAt)") &&
        automation.includes("stuckNotifiedAt") &&
        automation.includes("prestartReminderAt") &&
        automation.includes(".returning")
    ).toBe(true);
  });

  it("Escalation + auto-assign enqueue execute jobs and audit types", () => {
    expect(
      automation.includes("TASK_ESCALATED") &&
        automation.includes("TASK_AUTO_ASSIGNED") &&
        automation.includes("enqueueAutomationExecuteJob")
    ).toBe(true);
  });

  it("Queue supports automation_execute + escalation rate limits", () => {
    expect(
      queue.includes("AutomationExecutePayload") &&
        queue.includes("enqueueAutomationExecuteJob") &&
        queue.includes("automation_execute") &&
        queue.includes("MAX_ESCALATION_ENQUEUE_PER_CLINIC_PER_MIN")
    ).toBe(true);
  });

  it("Audit types for automation events", () => {
    expect(
      audit.includes("TASK_ESCALATED") && audit.includes("TASK_AUTO_ASSIGNED") && audit.includes("TASK_STUCK_NOTIFIED")
    ).toBe(true);
  });

  it("Worker runs automation tick and processes automation_execute", () => {
    expect(
      worker.includes("automation_tick") &&
        worker.includes("scanAndEnqueueAutomationJobs") &&
        worker.includes("executeAutomationJob")
    ).toBe(true);
  });

  it("Feature flag for automation engine", () => {
    expect(
      automation.includes("ENABLE_AUTOMATION_ENGINE") && automation.includes("isAutomationEngineEnabled")
    ).toBe(true);
  });

  it(".env.example mentions automation / feature flag", () => {
    expect(envExample.includes("ENABLE_AUTOMATION_ENGINE") || envExample.includes("Automation")).toBe(true);
  });
});
