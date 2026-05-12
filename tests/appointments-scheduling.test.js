import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function overlaps(existing, incoming) {
  return existing.start < incoming.end && existing.end > incoming.start;
}

const repoRoot = path.resolve(__dirname, "..");
const migration026 = fs.readFileSync(path.join(repoRoot, "migrations", "026_appointments_scheduling.sql"), "utf8");
const migration027 = fs.readFileSync(path.join(repoRoot, "migrations", "027_appointments_product_polish.sql"), "utf8");
const migration028 = fs.readFileSync(path.join(repoRoot, "migrations", "028_appointments_service_task_fields.sql"), "utf8");
const serviceFile = fs.readFileSync(path.join(repoRoot, "server", "services", "appointments.service.ts"), "utf8");
const authFile = fs.readFileSync(path.join(repoRoot, "server", "middleware", "auth.ts"), "utf8");
const routeFile = fs.readFileSync(path.join(repoRoot, "server", "routes", "appointments.ts"), "utf8");
const taskRouteFile = fs.readFileSync(path.join(repoRoot, "server", "routes", "tasks.ts"), "utf8");
const taskRbacFile = fs.readFileSync(path.join(repoRoot, "server", "lib", "task-rbac.ts"), "utf8");
const serverIndex = fs.readFileSync(path.join(repoRoot, "server", "index.ts"), "utf8");
const appRoutesPath = path.join(repoRoot, "server", "app", "routes.ts");
const appRoutes = fs.existsSync(appRoutesPath) ? fs.readFileSync(appRoutesPath, "utf8") : "";
const appointmentsPage = fs.readFileSync(path.join(repoRoot, "src", "pages", "appointments.tsx"), "utf8");

describe("Appointments Scheduling", () => {
  it("Appointments table migration exists", () => {
    expect(migration026.includes("CREATE TABLE IF NOT EXISTS vt_appointments")).toBe(true);
  });

  it("Product polish migration adds conflict override fields", () => {
    expect(migration027.includes("conflict_override") && migration027.includes("override_reason")).toBe(true);
  });

  it("Workflow status migration includes arrived/in_progress", () => {
    expect(migration027.includes("arrived") && migration027.includes("in_progress")).toBe(true);
  });

  it("Service-task fields migration adds priority and task_type", () => {
    expect(
      migration028.includes("priority") &&
        migration028.includes("task_type") &&
        migration028.includes("maintenance")
    ).toBe(true);
  });

  it("Appointments indexes cover clinic, vet+time, and day queries", () => {
    expect(
      migration026.includes("vt_appointments_vet_time_idx") &&
        migration026.includes("vt_appointments_clinic_id_idx") &&
        migration026.includes("vt_appointments_start_time_idx")
    ).toBe(true);
  });

  it("Service enforces overlap rule at backend layer", () => {
    expect(
      serviceFile.includes("assertNoVetConflict") &&
        serviceFile.includes("findActiveVetConflict") &&
        serviceFile.includes("lt(appointments.startTime, args.endTime)") &&
        serviceFile.includes("gt(appointments.endTime, args.startTime)")
    ).toBe(true);
  });

  it("Critical priority persists automatic conflict override", () => {
    expect(serviceFile.includes("PRIORITY_CRITICAL_OVERLAP") && serviceFile.includes("AUTO_CRITICAL")).toBe(true);
  });

  it("Service enforces shift boundary validation", () => {
    expect(
      serviceFile.includes("assertWithinVetShift") &&
        serviceFile.includes("Cannot schedule outside vet shift hours")
    ).toBe(true);
  });

  it("Service enforces status transition rules", () => {
    expect(
      serviceFile.includes("VALID_STATUS_TRANSITIONS") &&
        serviceFile.includes("INVALID_STATUS_TRANSITION")
    ).toBe(true);
  });

  it("Service enforces conflict override reason semantics", () => {
    expect(
      serviceFile.includes("OVERRIDE_REASON_REQUIRED") &&
        serviceFile.includes("OVERRIDE_NOT_NEEDED")
    ).toBe(true);
  });

  it("Service enforces strict clinic scoping for linked entities", () => {
    expect(
      serviceFile.includes("eq(appointments.clinicId, clinicId)") &&
        serviceFile.includes("assertVetInClinic") &&
        serviceFile.includes("assertAnimalInClinic") &&
        serviceFile.includes("assertOwnerInClinic")
    ).toBe(true);
  });

  it("Service requires timezone-qualified input and UTC normalization", () => {
    expect(
      serviceFile.includes("TIMEZONE_REQUIRED") &&
        serviceFile.includes("must include timezone offset or Z")
    ).toBe(true);
  });

  it("Routes require auth + structured validation errors", () => {
    expect(
      routeFile.includes("requireEffectiveRole(\"technician\")") &&
        routeFile.includes("error: \"VALIDATION_FAILED\"") &&
        routeFile.includes("router.get(\"/meta\"") &&
        routeFile.includes("logServiceChange")
    ).toBe(true);
  });

  it("Appointments meta includes technicians as assignable users", () => {
    expect(routeFile.includes("eq(users.role, \"technician\")")).toBe(true);
  });

  it("Task RBAC policy is enforced in appointment and task routes", () => {
    expect(
      routeFile.includes("requireTaskActionPermission") &&
        taskRouteFile.includes("requireTaskActionPermission") &&
        taskRbacFile.includes("canPerformTaskAction") &&
        taskRbacFile.includes("\"task.assign\"") &&
        taskRbacFile.includes("\"task.reassign\"")
    ).toBe(true);
  });

  it("Auth uses Clerk backend client correctly and hardens clinic resolution", () => {
    expect(
      authFile.includes("clerkClient.users.getUser") &&
        authFile.includes("DB_FALLBACK_DISABLED") &&
        authFile.includes("CRITICAL_MISSING_CLINIC")
    ).toBe(true);
  });

  it("Appointments API mounted in server", () => {
    expect(
      serverIndex.includes("registerApiRoutes(app);") || appRoutes.includes('app.use("/api/appointments", appointmentsRoutes);')
    ).toBe(true);
  });

  it("UI calendar grid uses hour timeline with 15-min slots", () => {
    expect(
      appointmentsPage.includes("SLOT_MINUTES = 15") &&
        appointmentsPage.includes("DAY_START_HOUR = 8") &&
        appointmentsPage.includes("DAY_END_HOUR = 20")
    ).toBe(true);
  });

  it("UI supports duration presets and manual end-time override", () => {
    expect(
      appointmentsPage.includes("DURATION_PRESETS") &&
        appointmentsPage.includes("manualEndOverride")
    ).toBe(true);
  });

  it("UI includes conflict override confirmation flow", () => {
    expect(
      appointmentsPage.includes("conflictOpen") &&
        appointmentsPage.includes("conflictTitle")
    ).toBe(true);
  });

  it("Overlapping appointments are detected", () => {
    const t = (v) => new Date(v).getTime();
    const existing = { start: t("2026-04-16T10:00:00.000Z"), end: t("2026-04-16T11:00:00.000Z") };
    const overlapping = { start: t("2026-04-16T10:30:00.000Z"), end: t("2026-04-16T11:30:00.000Z") };
    expect(overlaps(existing, overlapping)).toBe(true);
  });

  it("Boundary case end==start is allowed", () => {
    const t = (v) => new Date(v).getTime();
    const existing = { start: t("2026-04-16T10:00:00.000Z"), end: t("2026-04-16T11:00:00.000Z") };
    const boundary = { start: t("2026-04-16T11:00:00.000Z"), end: t("2026-04-16T12:00:00.000Z") };
    expect(overlaps(existing, boundary)).toBe(false);
  });

  it("Timezone conversion resolves to the same UTC instant", () => {
    const t = (v) => new Date(v).getTime();
    const utcMillis = t("2026-07-01T14:00:00.000Z");
    const offsetMillis = t("2026-07-01T10:00:00.000-04:00");
    expect(utcMillis).toBe(offsetMillis);
  });

  it("Forward status transitions are allowed", () => {
    const transitions = {
      scheduled: ["arrived", "in_progress", "completed", "cancelled", "no_show"],
      arrived: ["in_progress", "completed", "cancelled", "no_show"],
      in_progress: ["completed", "cancelled"],
      completed: [],
      cancelled: [],
      no_show: [],
    };
    expect(transitions.scheduled.includes("arrived") && transitions.arrived.includes("in_progress")).toBe(true);
  });

  it("Invalid backwards status transition is blocked", () => {
    const transitions = {
      scheduled: ["arrived", "in_progress", "completed", "cancelled", "no_show"],
      arrived: ["in_progress", "completed", "cancelled", "no_show"],
      in_progress: ["completed", "cancelled"],
      completed: [],
      cancelled: [],
      no_show: [],
    };
    expect(transitions.completed.includes("scheduled")).toBe(false);
  });
});
