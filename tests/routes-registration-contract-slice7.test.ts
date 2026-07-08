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
  "/api/equipment", // equipmentRoutes
  "/api/equipment", // equipmentCopilotRoutes
  "/api/equipment", // equipmentInferenceRoutes
  "/api",
  "/api",
  "/api/rooms",
  "/api/folders",
  "/api/returns",
  "/api/alert-acks",
  "/api/activity",
  "/api/home",
  "/api/display",
  "/api/equipment-board",
  "/api/code-blue",
  "/api/crash-cart",
  "/api/admin",
  "/api/admin",
  "/api/admin",
  "/api/admin", // adminRfidReadersRoutes (7c)
  "/api/admin", // adminEquipmentGovernanceRoutes (7c)
  "/api/admin/cursor-bug-fixer",
  "/api/stability",
  "/api/platform",
  "/api/analytics",
  "/api/shifts",
  "/api/shift-adjustments",
  "/api/appointments",
  "/api/tasks",
  "/api/containers",
  "/api/restock",
  "/api/inventory-items",
  "/api/procurement",
  "/api/clinical",
  "/api/dispense",
  "/api/shift-chat",
  "/api/whatsapp",
];

describe("Slice 7 — routes registration contract lock", () => {
  describe("registerApiRoutes runtime mount order", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      vi.resetModules();
    });

    it("records app.use paths in registration order", async () => {
      const { registerApiRoutes } = await import("../server/app/routes.js");
      const calls: Array<{ path: string; router: unknown }> = [];
      const app = {
        use(path: string, ...routers: unknown[]) {
          calls.push({ path, router: routers[0] });
          return app;
        },
      } as unknown as Express;

      registerApiRoutes(app);

      expect(calls.map((c) => c.path)).toEqual(EXPECTED_MOUNT_PATHS);
    }, 15_000);

    it("mounts equipmentInferenceRoutes specifically at /api/equipment", async () => {
      const { registerApiRoutes } = await import("../server/app/routes.js");
      const calls: Array<{ path: string; router: unknown }> = [];
      const app = {
        use(path: string, ...routers: unknown[]) {
          calls.push({ path, router: routers[0] });
          return app;
        },
      } as unknown as Express;

      registerApiRoutes(app);

      const inferenceMount = calls.find(
        (c) =>
          c.path === "/api/equipment" &&
          (c.router as Record<string, unknown>)._vtRouterId === "equipment-inference",
      );
      expect(inferenceMount).toBeDefined();
    }, 15_000);
  });
});
