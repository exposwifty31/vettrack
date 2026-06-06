/**
 * Phase 3 PR 3.2 — writer regression test.
 *
 * Task ownership is persisted on `vt_appointments.acknowledged_user_id`
 * (typed FK), not the legacy `metadata.acknowledgedBy` string.
 *
 * Allowed writers:
 *   - server/routes/admin-task-ownership.ts (admin confirm path)
 *   - server/workers/taskOwnershipBackfill.worker.ts (historical backfill)
 *   - server/workers/staleTaskOwnershipSweepWorker.ts (staleness clear)
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const ALLOWED_WRITERS = [
  path.join(REPO_ROOT, "server/routes/admin-task-ownership.ts"),
  path.join(REPO_ROOT, "server/workers/taskOwnershipBackfill.worker.ts"),
  path.join(REPO_ROOT, "server/workers/staleTaskOwnershipSweepWorker.ts"),
];

describe("acknowledgedUserId writer regression — inventory invariant", () => {
  it("appointments.service.ts does not assign metadata.acknowledgedBy", () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, "server/services/appointments.service.ts"),
      "utf-8",
    );
    expect(src).not.toMatch(/metadata\.acknowledgedBy\s*=(?!=)/);
  });

  it("admin confirm path sets acknowledgedUserId on appointments", () => {
    const src = fs.readFileSync(ALLOWED_WRITERS[0], "utf-8");
    expect(src).toMatch(/acknowledgedUserId:\s*confirmedUserId/);
    expect(src).toMatch(/acknowledgedAt:/);
  });

  it("backfill worker sets acknowledgedUserId from resolver userId", () => {
    const src = fs.readFileSync(ALLOWED_WRITERS[1], "utf-8");
    expect(src).toMatch(/acknowledgedUserId:\s*resolution\.userId/);
  });

  it("no unexpected server file assigns acknowledgedUserId on appointments", () => {
    const serverDir = path.join(REPO_ROOT, "server");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(p);
        } else if (entry.isFile() && /\.(ts|tsx|js)$/.test(entry.name)) {
          if (ALLOWED_WRITERS.includes(p)) continue;
          const content = fs.readFileSync(p, "utf-8");
          if (/\.set\(\{[^}]*acknowledgedUserId:/.test(content)) {
            offenders.push(p);
          }
        }
      }
    };
    walk(serverDir);
    expect(offenders).toEqual([]);
  });
});
