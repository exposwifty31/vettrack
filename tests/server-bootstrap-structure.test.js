import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readIfExists(target) {
  if (!fs.existsSync(target)) return "";
  return fs.readFileSync(target, "utf8");
}

const repoRoot = path.resolve(__dirname, "..");
const indexServer = readIfExists(path.join(repoRoot, "server", "index.ts"));
const routesModule = readIfExists(path.join(repoRoot, "server", "app", "routes.ts"));
const schedulerModule = readIfExists(path.join(repoRoot, "server", "app", "start-schedulers.ts"));
const appModule = readIfExists(path.join(repoRoot, "server", "app", "create-app.ts"));

const routeSources = `${indexServer}\n${routesModule}\n${appModule}`;
const schedulerSources = `${indexServer}\n${schedulerModule}`;

describe("Server Bootstrap Structure", () => {
  for (const prefix of [
    "/api/users",
    "/api/equipment",
    "/api/analytics",
    "/api/activity",
    "/api/metrics",
    "/api/folders",
    "/api/alert-acks",
    "/api/rooms",
    "/api/support",
    "/api/push",
    "/api/whatsapp",
    "/api/audit-logs",
    "/api/storage",
    "/api/shifts",
    "/api/appointments",
    "/api/tasks",
    "/api/realtime",
    "/api/queue",
    "/health",
  ]) {
    it(`Route prefix exists: ${prefix}`, () => {
      expect(routeSources).toContain(`"${prefix}"`);
    });
  }

  it("System watchdog is scheduled", () => {
    expect(schedulerSources.includes("startSystemWatchdog")).toBe(true);
  });

  it("Notification scheduler is started", () => {
    expect(schedulerSources.includes("startScheduledNotificationProcessor")).toBe(true);
  });

  it("Role notification scheduler is started", () => {
    expect(schedulerSources.includes("startSmartRoleNotificationScheduler")).toBe(true);
  });

  it("Access denied metrics scheduler is started", () => {
    expect(schedulerSources.includes("startAccessDeniedMetricsWindowScheduler")).toBe(true);
  });

  it("Cleanup scheduler is started", () => {
    expect(schedulerSources.includes("startCleanupScheduler")).toBe(true);
  });
});
