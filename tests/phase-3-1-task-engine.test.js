import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const repoRoot = path.resolve(__dirname, "..");
const migration030 = fs.readFileSync(path.join(repoRoot, "migrations", "030_appointments_task_engine.sql"), "utf8");
// Service source spans scheduling.service.ts + task-lifecycle.service.ts (ADR-002
// split — see docs/architecture/adr-002-appointments-service-split.md).
const serviceFile = [
  fs.readFileSync(path.join(repoRoot, "server", "services", "scheduling.service.ts"), "utf8"),
  fs.readFileSync(path.join(repoRoot, "server", "services", "task-lifecycle.service.ts"), "utf8"),
].join("\n");
const adapterFile = fs.readFileSync(path.join(repoRoot, "server", "domain", "service-task.adapter.ts"), "utf8");
const tasksRoute = fs.readFileSync(path.join(repoRoot, "server", "routes", "tasks.ts"), "utf8");
const auditFile = fs.readFileSync(path.join(repoRoot, "server", "lib", "audit.ts"), "utf8");
const serverIndex = fs.readFileSync(path.join(repoRoot, "server", "index.ts"), "utf8");
const appRoutesPath = path.join(repoRoot, "server", "app", "routes.ts");
const appRoutes = fs.existsSync(appRoutesPath) ? fs.readFileSync(appRoutesPath, "utf8") : "";

describe("Phase 3.1 Task Engine (static checks)", () => {
  it("Migration 030 adds task statuses and nullable vet_id", () => {
    expect(
      migration030.includes("vt_appointments") &&
        migration030.includes("pending") &&
        migration030.includes("assigned") &&
        migration030.includes("ALTER COLUMN vet_id DROP NOT NULL")
    ).toBe(true);
  });

  it("Appointment service exposes task lifecycle + queries + isolation errors", () => {
    expect(
      serviceFile.includes("export async function startTask") &&
        serviceFile.includes("export async function completeTask") &&
        serviceFile.includes("getTasksForTechnician") &&
        serviceFile.includes("getActiveTasks") &&
        serviceFile.includes("getTodayTasks") &&
        serviceFile.includes("TASK_NOT_OWNED_BY_TECH")
    ).toBe(true);
  });

  it("Task changes emit audit events", () => {
    expect(serviceFile.includes("task_created") && serviceFile.includes("auditTaskChange")).toBe(true);
  });

  it("Service-task adapter defines canonical task status + isTaskActive", () => {
    expect(
      adapterFile.includes("isTaskActive") &&
        adapterFile.includes("dbStatusToServiceStatus") &&
        adapterFile.includes("export type ServiceTaskStatus")
    ).toBe(true);
  });

  it("Audit types include critical override and task completion", () => {
    expect(auditFile.includes("CRITICAL_TASK_EXECUTED") && auditFile.includes("task_completed")).toBe(true);
  });

  it("Tasks routes expose start, complete, me, active", () => {
    expect(
      tasksRoute.includes('"/:id/start"') &&
        tasksRoute.includes('"/:id/complete"') &&
        tasksRoute.includes('router.get("/me"') &&
        tasksRoute.includes('router.get("/active"')
    ).toBe(true);
  });

  it("Tasks API mounted under /api/tasks", () => {
    expect(
      serverIndex.includes("registerApiRoutes(app);") || appRoutes.includes('app.use("/api/tasks", tasksRoutes);')
    ).toBe(true);
  });
});
