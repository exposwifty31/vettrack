import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const contractPath = path.join(repoRoot, "docs", "architecture", "routes-contract.json");

/** Mount paths in registration order (Slice 7 baseline, full platform / non-pilot). */
const EXPECTED_MOUNT_PATHS = [
  "/api/users",
  "/api/realtime",
  "/api/queue",
  "/api/metrics",
  "/api/storage",
  "/api/uploads",
  "/api/push",
  "/api/support",
  "/api/audit-logs",
  "/api/integrations",
  "/api/test",
  "/api/health",
  "/api/health/ready",
  "/health",
  "/api/equipment",
  "/api/equipment-intelligence",
  "/api",
  "/api",
  "/api/rooms",
  "/api/folders",
  "/api/returns",
  "/api/alert-acks",
  "/api/activity",
  "/api/home",
  "/api/display",
  "/api/code-blue",
  "/api/crash-cart",
  "/api/er",
  "/api/pilot",
  "/api/admin",
  "/api/admin",
  "/api/admin",
  "/api/admin",
  "/api/stability",
  "/api/formulary",
  "/api/forecast",
  "/api/analytics",
  "/api/shifts",
  "/api/appointments",
  "/api/tasks",
  "/api/shift-handover",
  "/api/shift-handover/patient-handoffs",
  "/api/containers",
  "/api/restock",
  "/api/medication-tasks",
  "/api/billing",
  "/api/inventory-items",
  "/api/procurement",
  "/api/animals",
  "/api/patients",
  "/api/clinical",
  "/api/dispense",
  "/api/shift-chat",
  "/api/whatsapp",
];

const envBackup = {
  PILOT_MODE: process.env.PILOT_MODE,
  ALLOW_EQUIPMENT_PILOT_MODE: process.env.ALLOW_EQUIPMENT_PILOT_MODE,
};

function restorePilotEnv(): void {
  if (envBackup.PILOT_MODE === undefined) {
    delete process.env.PILOT_MODE;
  } else {
    process.env.PILOT_MODE = envBackup.PILOT_MODE;
  }
  if (envBackup.ALLOW_EQUIPMENT_PILOT_MODE === undefined) {
    delete process.env.ALLOW_EQUIPMENT_PILOT_MODE;
  } else {
    process.env.ALLOW_EQUIPMENT_PILOT_MODE = envBackup.ALLOW_EQUIPMENT_PILOT_MODE;
  }
}

/** Mainline default: pilot route registration off unless both ALLOW and PILOT_MODE are "true". */
function useFullPlatformRouteRegistration(): void {
  delete process.env.PILOT_MODE;
  delete process.env.ALLOW_EQUIPMENT_PILOT_MODE;
}

describe("Slice 7 — routes registration contract lock", () => {
  it("routes-contract.json baseline counts unchanged", () => {
    const contract = JSON.parse(fs.readFileSync(contractPath, "utf8")) as {
      routeCount: number;
      pilotRegistration: { gatedRouteCount: number; guard: string };
    };
    expect(contract.routeCount).toBe(320);
    expect(contract.pilotRegistration.gatedRouteCount).toBe(110);
    expect(contract.pilotRegistration.guard).toBe("!isPilotMode");
  });

  describe("registerApiRoutes runtime mount order", () => {
    beforeEach(() => {
      useFullPlatformRouteRegistration();
      vi.resetModules();
    });

    afterEach(() => {
      restorePilotEnv();
      vi.resetModules();
    });

    it("records app.use paths in registration order (non-pilot)", async () => {
      const { registerApiRoutes } = await import("../server/app/routes.js");
      const calls: string[] = [];
      const app = {
        use(path: string, ..._routers: unknown[]) {
          calls.push(path);
          return app;
        },
      } as unknown as Express;

      registerApiRoutes(app);

      expect(calls).toEqual(EXPECTED_MOUNT_PATHS);
    });

    it("pilot guard preserved: gated mounts omitted when runtime pilot is on", async () => {
      process.env.ALLOW_EQUIPMENT_PILOT_MODE = "true";
      process.env.PILOT_MODE = "true";
      vi.resetModules();

      const { registerApiRoutes } = await import("../server/app/routes.js");
      const calls: string[] = [];
      const app = {
        use(path: string, ..._routers: unknown[]) {
          calls.push(path);
          return app;
        },
      } as unknown as Express;

      registerApiRoutes(app);

      expect(calls).not.toContain("/api/analytics");
      expect(calls.at(-1)).toBe("/api/forecast");
    });
  });
});
