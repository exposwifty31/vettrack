import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const repoRoot = path.resolve(__dirname, "..");
const appointments = fs.readFileSync(path.join(repoRoot, "server", "routes", "appointments.ts"), "utf8");
const tasks = fs.readFileSync(path.join(repoRoot, "server", "routes", "tasks.ts"), "utf8");
const users = fs.readFileSync(path.join(repoRoot, "server", "routes", "users.ts"), "utf8");
const metrics = fs.readFileSync(path.join(repoRoot, "server", "routes", "metrics.ts"), "utf8");
const queue = fs.readFileSync(path.join(repoRoot, "server", "routes", "queue.ts"), "utf8");
const realtime = fs.readFileSync(path.join(repoRoot, "server", "routes", "realtime.ts"), "utf8");
const health = fs.readFileSync(path.join(repoRoot, "server", "routes", "health.ts"), "utf8");
const shifts = fs.readFileSync(path.join(repoRoot, "server", "routes", "shifts.ts"), "utf8");
const support = fs.readFileSync(path.join(repoRoot, "server", "routes", "support.ts"), "utf8");
const rooms = fs.readFileSync(path.join(repoRoot, "server", "routes", "rooms.ts"), "utf8");
const folders = fs.readFileSync(path.join(repoRoot, "server", "routes", "folders.ts"), "utf8");
const whatsapp = fs.readFileSync(path.join(repoRoot, "server", "routes", "whatsapp.ts"), "utf8");
const analytics = fs.readFileSync(path.join(repoRoot, "server", "routes", "analytics.ts"), "utf8");
const auditLogs = fs.readFileSync(path.join(repoRoot, "server", "routes", "audit-logs.ts"), "utf8");
const activity = fs.readFileSync(path.join(repoRoot, "server", "routes", "activity.ts"), "utf8");
const alertAcks = fs.readFileSync(path.join(repoRoot, "server", "routes", "alert-acks.ts"), "utf8");
const stability = fs.readFileSync(path.join(repoRoot, "server", "routes", "stability.ts"), "utf8");
const testRoute = fs.readFileSync(path.join(repoRoot, "server", "routes", "test.ts"), "utf8");
const storage = fs.readFileSync(path.join(repoRoot, "server", "routes", "storage.ts"), "utf8");
const push = fs.readFileSync(path.join(repoRoot, "server", "routes", "push.ts"), "utf8");
const equipment = fs.readFileSync(path.join(repoRoot, "server", "routes", "equipment.ts"), "utf8");
const equipmentRouteUtils = fs.readFileSync(
  path.join(repoRoot, "server", "routes", "equipment", "equipment-route-utils.ts"),
  "utf8",
);
const equipmentHandlersDir = path.join(repoRoot, "server", "routes", "equipment", "handlers");
const equipmentHandlerSources = fs
  .readdirSync(equipmentHandlersDir)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => fs.readFileSync(path.join(equipmentHandlersDir, name), "utf8"))
  .join("\n");
const equipmentErrorContractSource = equipment + equipmentRouteUtils + equipmentHandlerSources;

describe("Phase 5 route error contract checks (static)", () => {
  it("Appointments route emits requestId and structured validation errors", () => {
    expect(
      appointments.includes("resolveRequestId") &&
        appointments.includes("requestId") &&
        appointments.includes("code: \"VALIDATION_FAILED\"") &&
        appointments.includes("error: \"VALIDATION_FAILED\""),
    ).toBe(true);
  });

  it("Appointments service errors are mapped to contract", () => {
    expect(
      appointments.includes("sendServiceError(res, err, requestId)") &&
        appointments.includes("reason: err.code"),
    ).toBe(true);
  });

  it("Tasks route emits structured unauthorized and internal errors", () => {
    expect(
      tasks.includes("resolveRequestId") &&
        tasks.includes("apiError(") &&
        tasks.includes("code: \"UNAUTHORIZED\"") &&
        tasks.includes("code: \"INTERNAL_ERROR\""),
    ).toBe(true);
  });

  it("Tasks service failures include explicit reasons and requestId", () => {
    expect(
      tasks.includes("sendServiceError(res, err, requestId)") &&
        tasks.includes("reason: \"TASK_START_FAILED\"") &&
        tasks.includes("reason: \"TASK_COMPLETE_FAILED\""),
    ).toBe(true);
  });

  it("Users route emits standardized error schema with requestId", () => {
    expect(
      users.includes("resolveRequestId") &&
        users.includes("requestId") &&
        users.includes("code: \"UNAUTHORIZED\"") &&
        users.includes("code: \"FORBIDDEN\"") &&
        users.includes("code: \"NOT_FOUND\"") &&
        users.includes("code: \"INTERNAL_ERROR\""),
    ).toBe(true);
  });

  it("Metrics route emits standardized internal errors", () => {
    expect(
      metrics.includes("resolveRequestId") && metrics.includes("reason: \"METRICS_FETCH_FAILED\""),
    ).toBe(true);
  });

  it("Queue route emits standardized internal errors", () => {
    expect(
      queue.includes("resolveRequestId") && queue.includes("reason: \"QUEUE_DLQ_FETCH_FAILED\""),
    ).toBe(true);
  });

  it("Realtime route emits standardized validation and internal errors", () => {
    expect(
      realtime.includes("resolveRequestId") &&
        realtime.includes("code: \"MISSING_CLINIC_ID\"") &&
        realtime.includes("reason: \"REALTIME_SUBSCRIBE_FAILED\""),
    ).toBe(true);
  });

  it("Health data-integrity route emits standardized auth/internal errors", () => {
    expect(
      health.includes("resolveRequestId") &&
        health.includes("reason: \"INVALID_HEALTH_TOKEN\"") &&
        health.includes("reason: \"DATA_INTEGRITY_HEALTH_FAILED\""),
    ).toBe(true);
  });

  it("Shifts route emits standardized upload/import/list errors", () => {
    expect(
      shifts.includes("resolveRequestId") &&
        shifts.includes("reason: \"INVALID_CSV_UPLOAD\"") &&
        shifts.includes("reason: \"SHIFT_CSV_PREVIEW_FAILED\"") &&
        shifts.includes("reason: \"SHIFT_CSV_IMPORT_FAILED\"") &&
        shifts.includes("reason: \"SHIFTS_FETCH_FAILED\""),
    ).toBe(true);
  });

  it("Support route emits standardized ticket error contract", () => {
    expect(
      support.includes("resolveRequestId") &&
        support.includes("reason: \"SUPPORT_TICKET_CREATE_FAILED\"") &&
        support.includes("reason: \"SUPPORT_TICKETS_LIST_FAILED\"") &&
        support.includes("reason: \"SUPPORT_TICKETS_COUNT_FAILED\"") &&
        support.includes("reason: \"SUPPORT_TICKET_NOT_FOUND\""),
    ).toBe(true);
  });

  it("Rooms route emits standardized room error contract", () => {
    expect(
      rooms.includes("resolveRequestId") &&
        rooms.includes("reason: \"ROOM_NOT_FOUND\"") &&
        rooms.includes("reason: \"ROOM_NAME_CONFLICT\"") &&
        rooms.includes("reason: \"ROOM_NOT_EMPTY\"") &&
        rooms.includes("reason: \"ROOM_DELETE_FAILED\""),
    ).toBe(true);
  });

  it("Folders route emits standardized folder error contract", () => {
    expect(
      folders.includes("resolveRequestId") &&
        folders.includes("reason: \"FOLDERS_LIST_FAILED\"") &&
        folders.includes("reason: \"FOLDER_NAME_REQUIRED\"") &&
        folders.includes("reason: \"FOLDER_NOT_FOUND\"") &&
        folders.includes("reason: \"FOLDER_DELETE_FAILED\""),
    ).toBe(true);
  });

  it("WhatsApp route emits standardized alert error contract", () => {
    expect(
      whatsapp.includes("resolveRequestId") &&
        whatsapp.includes("reason: \"EQUIPMENT_NOT_FOUND\"") &&
        whatsapp.includes("reason: \"WHATSAPP_ALERT_CREATE_FAILED\""),
    ).toBe(true);
  });

  it("Analytics route emits standardized analytics error contract", () => {
    expect(
      analytics.includes("resolveRequestId") && analytics.includes("reason: \"ANALYTICS_FETCH_FAILED\""),
    ).toBe(true);
  });

  it("Audit logs route emits standardized audit error contract", () => {
    expect(
      auditLogs.includes("resolveRequestId") && auditLogs.includes("reason: \"AUDIT_LOGS_FETCH_FAILED\""),
    ).toBe(true);
  });

  it("Activity route emits standardized validation and internal errors", () => {
    expect(
      activity.includes("resolveRequestId") &&
        activity.includes("reason: \"INVALID_CURSOR\"") &&
        activity.includes("reason: \"ACTIVITY_FEED_FETCH_FAILED\"") &&
        activity.includes("reason: \"MY_SCAN_COUNT_FETCH_FAILED\""),
    ).toBe(true);
  });

  it("Alert-acks route emits standardized acknowledgment errors", () => {
    expect(
      alertAcks.includes("resolveRequestId") &&
        alertAcks.includes("reason: \"ALERT_ACKS_LIST_FAILED\"") &&
        alertAcks.includes("reason: \"MISSING_ALERT_ACK_FIELDS\"") &&
        // ALERT_ACK_DELETE_FAILED removed — DELETE endpoint replaced by PATCH /:id/resolve
        (alertAcks.includes("reason: \"ALERT_ACK_DELETE_FAILED\"") ||
          alertAcks.includes("reason: \"ALERT_RESOLVE_FAILED\"")),
    ).toBe(true);
  });

  it("Stability route emits standardized guard and validation errors (post-PR-6.10 light adoption)", () => {
    // Phase 6 PR 6.10 light adoption: the `requireNotProduction` 403
    // branch was migrated from the legacy envelope (`reason:
    // "NOT_AVAILABLE_IN_PRODUCTION"`) to the i18n-aware `apiError`.
    // Remaining 4xx branches in stability.ts (`TEST_RUN_ALREADY_IN_PROGRESS`,
    // `INVALID_TEST_MODE_ENABLED`) keep the legacy envelope until a
    // future migration PR.
    expect(
      stability.includes("resolveRequestId") &&
        stability.includes("reason: \"TEST_RUN_ALREADY_IN_PROGRESS\"") &&
        stability.includes("reason: \"INVALID_TEST_MODE_ENABLED\""),
    ).toBe(true);
  });

  it("Test route emits standardized scenario errors (post-PR-6.3 light adoption)", () => {
    // Phase 6 PR 6.3 light-adoption migration: the `requireNotProduction`
    // 403 (legacy `reason: "NOT_AVAILABLE_IN_PRODUCTION"`) and
    // `requireTestMode` 404 (legacy `reason: "TEST_MODE_DISABLED"`) gate
    // branches were migrated to the i18n-aware `apiError(req, res, key,
    // params?, status?)` helper. Those two branches no longer carry the
    // legacy `reason: "..."` envelope. The remaining route-level scenario
    // errors keep the legacy envelope until a future migration PR.
    expect(
      testRoute.includes("resolveRequestId") &&
        testRoute.includes("reason: \"EQUIPMENT_NOT_CHECKED_OUT_BY_USER\""),
    ).toBe(true);
  });

  it("Storage route emits standardized not-implemented errors", () => {
    expect(
      storage.includes("resolveRequestId") &&
        storage.includes("reason: \"OBJECT_STORAGE_NOT_CONFIGURED\"") &&
        storage.includes("reason: \"SIGNED_UPLOAD_URL_NOT_IMPLEMENTED\""),
    ).toBe(true);
  });

  it("Push route emits standardized subscription and test errors", () => {
    expect(
      push.includes("resolveRequestId") &&
        push.includes("reason: \"PUSH_NOT_CONFIGURED\"") &&
        push.includes("reason: \"ENDPOINT_REQUIRED\"") &&
        push.includes("reason: \"PUSH_SUBSCRIBE_SAVE_FAILED\"") &&
        push.includes("reason: \"PUSH_SUBSCRIPTION_NOT_FOUND\"") &&
        push.includes("reason: \"PUSH_TEST_FAILED\""),
    ).toBe(true);
  });

  it("Equipment route first slice emits standardized error contract", () => {
    expect(
      equipmentErrorContractSource.includes("resolveRequestId") &&
        equipmentErrorContractSource.includes("reason: \"MY_EQUIPMENT_FETCH_FAILED\"") &&
        equipmentErrorContractSource.includes("reason: \"EQUIPMENT_LIST_FAILED\"") &&
        equipmentErrorContractSource.includes("reason: \"EQUIPMENT_NOT_FOUND\"") &&
        equipmentErrorContractSource.includes("reason: \"EXPECTED_RETURN_MINUTES_ADMIN_ONLY\"") &&
        equipmentErrorContractSource.includes("reason: \"EQUIPMENT_RESTORE_FAILED\"") &&
        equipmentErrorContractSource.includes("reason: \"EQUIPMENT_CHECKOUT_FAILED\"") &&
        equipmentErrorContractSource.includes("reason: \"EQUIPMENT_RETURN_FAILED\"") &&
        equipmentErrorContractSource.includes("reason: \"EQUIPMENT_SCAN_FAILED\"") &&
        equipmentErrorContractSource.includes("reason: \"UNDO_TOKEN_INVALID_OR_EXPIRED\"") &&
        equipmentErrorContractSource.includes("reason: \"EQUIPMENT_IMPORT_FAILED\"") &&
        equipmentErrorContractSource.includes("reason: \"EQUIPMENT_BULK_MOVE_FAILED\"") &&
        equipmentErrorContractSource.includes("reason: \"EQUIPMENT_BULK_VERIFY_FAILED\""),
    ).toBe(true);
  });
});
