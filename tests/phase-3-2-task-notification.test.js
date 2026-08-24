import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const repoRoot = path.resolve(__dirname, "..");
const taskNotif = fs.readFileSync(path.join(repoRoot, "server", "lib", "task-notification.ts"), "utf8");
// Service source spans scheduling.service.ts + task-lifecycle.service.ts (ADR-002
// split — see docs/architecture/adr-002-appointments-service-split.md).
const serviceFile = [
  fs.readFileSync(path.join(repoRoot, "server", "services", "scheduling.service.ts"), "utf8"),
  fs.readFileSync(path.join(repoRoot, "server", "services", "task-lifecycle.service.ts"), "utf8"),
].join("\n");
const auditFile = fs.readFileSync(path.join(repoRoot, "server", "lib", "audit.ts"), "utf8");

describe("Phase 3.2 Task Notification Orchestration (static checks)", () => {
  it("task-notification.ts orchestrates pushes via existing helpers + dedupe", () => {
    expect(
      taskNotif.includes("export async function sendTaskNotification") &&
        taskNotif.includes("sendPushToUser") &&
        taskNotif.includes("sendPushToRole") &&
        taskNotif.includes("checkDedupe") &&
        taskNotif.includes("TASK_CREATED") &&
        taskNotif.includes("TASK_STARTED") &&
        taskNotif.includes("TASK_COMPLETED")
    ).toBe(true);
  });

  it("appointments.service wires task lifecycle to notifications", () => {
    expect(
      serviceFile.includes('sendTaskNotification("TASK_CREATED"') &&
        serviceFile.includes('sendTaskNotification("TASK_STARTED"') &&
        serviceFile.includes('sendTaskNotification("TASK_COMPLETED"')
    ).toBe(true);
  });

  it("Audit allows CRITICAL_NOTIFICATION_SENT", () => {
    expect(auditFile.includes("CRITICAL_NOTIFICATION_SENT")).toBe(true);
  });
});
