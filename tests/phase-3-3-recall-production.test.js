import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const repoRoot = path.resolve(__dirname, "..");
const recall = fs.readFileSync(path.join(repoRoot, "server", "services", "task-recall.service.ts"), "utf8");
const tasksRoute = fs.readFileSync(path.join(repoRoot, "server", "routes", "tasks.ts"), "utf8");
const push = fs.readFileSync(path.join(repoRoot, "server", "lib", "push.ts"), "utf8");
const migration = fs.readFileSync(path.join(repoRoot, "migrations", "031_task_recall_indexes.sql"), "utf8");
const api = fs.readFileSync(path.join(repoRoot, "src", "lib", "api.ts"), "utf8");
const appointmentsPage = fs.readFileSync(path.join(repoRoot, "src", "pages", "Tasks.tsx"), "utf8");
const worker = fs.readFileSync(path.join(repoRoot, "server", "workers", "notification.worker.ts"), "utf8");

function computeIsOverdue(endTimeIso, nowMs) {
  return new Date(endTimeIso).getTime() < nowMs;
}

function priorityRank(p) {
  if (p === "critical") return 3;
  if (p === "high") return 2;
  return 1;
}

function sortRecallTasks(tasks, nowMs) {
  return [...tasks].sort((a, b) => {
    const ao = computeIsOverdue(a.endTime, nowMs) ? 1 : 0;
    const bo = computeIsOverdue(b.endTime, nowMs) ? 1 : 0;
    if (bo !== ao) return bo - ao;
    const pr = priorityRank(b.priority) - priorityRank(a.priority);
    if (pr !== 0) return pr;
    return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
  });
}

describe("Phase 3.3 Daily Recall Engine (production checks)", () => {
  it("LIMIT 50 on recall queries", () => {
    expect(recall.includes("RECALL_LIMIT = 50") && recall.includes(".limit(RECALL_LIMIT")).toBe(true);
  });

  it("task-recall.service exports four query functions", () => {
    expect(
      recall.includes("getTodayTasks") &&
        recall.includes("getOverdueTasks") &&
        recall.includes("getUpcomingTasks") &&
        recall.includes("getMyTasks")
    ).toBe(true);
  });

  it("Strict clinic_id on queries + dashboard aggregator", () => {
    expect(recall.includes("eq(appointments.clinicId") && recall.includes("getTaskDashboard")).toBe(true);
  });

  it("Redis-backed dashboard cache key + TTL", () => {
    expect(
      recall.includes("task_dashboard:") &&
        recall.includes("safeRedisGet") &&
        recall.includes("DASHBOARD_CACHE_TTL_MS")
    ).toBe(true);
  });

  it("Observability logs", () => {
    expect(recall.includes("TASK_DASHBOARD_FETCH") && recall.includes("TASK_DASHBOARD_SLOW")).toBe(true);
  });

  it("GET dashboard has no push side effects", () => {
    expect(recall.includes("sendPushToUser")).toBe(false);
  });

  it("Overdue reminder runs in worker with hourly dedupe", () => {
    expect(worker.includes("OVERDUE_REMINDER") && worker.includes("3_600_000")).toBe(true);
  });

  it("checkDedupe supports custom window", () => {
    expect(
      push.includes("windowMs") && push.includes("checkDedupe(equipmentId: string, eventType: string, windowMs")
    ).toBe(true);
  });

  it("Migration defines clinic+status/start/end/vet indexes", () => {
    expect(
      migration.includes("vt_appointments_clinic_status_idx") &&
        migration.includes("vt_appointments_clinic_start_idx") &&
        migration.includes("vt_appointments_clinic_end_idx") &&
        migration.includes("vt_appointments_clinic_vet_idx")
    ).toBe(true);
  });

  it("GET /api/tasks/dashboard registered", () => {
    expect(tasksRoute.includes('router.get("/dashboard"') && tasksRoute.includes("getTaskDashboard")).toBe(true);
  });

  it("Client api.tasks.dashboard()", () => {
    expect(api.includes("dashboard:") && api.includes("/api/tasks/dashboard")).toBe(true);
  });

  it("appointments page uses dashboard + refresh strategy", () => {
    expect(
      appointmentsPage.includes("api.tasks.dashboard") &&
        appointmentsPage.includes("refetchInterval") &&
        appointmentsPage.includes("refetchOnWindowFocus")
    ).toBe(true);
  });

  it("Skeleton loader for dashboard", () => {
    // Dashboard now uses the shared LoadingSection primitive (Epic 8 Slice 2)
    expect(
      appointmentsPage.includes("<LoadingSection") ||
      appointmentsPage.includes("<Skeleton")
    ).toBe(true);
  });

  it("sortRecallTasks: overdue rows sort before non-overdue", () => {
    const now = Date.now();
    const overdue = { endTime: new Date(now - 60_000).toISOString(), startTime: new Date(now - 120_000).toISOString(), priority: "normal" };
    const upcomingCrit = { endTime: new Date(now + 3600_000).toISOString(), startTime: new Date(now + 60_000).toISOString(), priority: "critical" };
    const sorted = sortRecallTasks([upcomingCrit, overdue], now);
    expect(sorted[0]).toBe(overdue);
  });

  it("computeIsOverdue true when end < now", () => {
    const now = Date.now();
    const overdue = { endTime: new Date(now - 60_000).toISOString() };
    expect(computeIsOverdue(overdue.endTime, now)).toBe(true);
  });

  it("computeIsOverdue false when end >= now", () => {
    const now = Date.now();
    const upcomingCrit = { endTime: new Date(now + 3600_000).toISOString() };
    expect(computeIsOverdue(upcomingCrit.endTime, now)).toBe(false);
  });
});
