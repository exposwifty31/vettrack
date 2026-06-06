/**
 * Phase 3 PR 3.2 — writer regression test.
 *
 * Task ownership now persists on `vt_appointments.acknowledged_user_id`
 * (not `metadata.acknowledgedBy`). Writers must stay centralized.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const APPOINTMENTS_SERVICE = path.join(REPO_ROOT, "server/services/appointments.service.ts");

describe("acknowledgedUserId writer regression — inventory invariant", () => {
  it("appointments.service.ts does not assign metadata.acknowledgedBy", () => {
    const src = fs.readFileSync(APPOINTMENTS_SERVICE, "utf-8");
    expect(src).not.toMatch(/metadata\.acknowledgedBy\s*=(?!=)/);
  });

  it("appointments.service.ts reads acknowledgedUserId for ownership observation", () => {
    const src = fs.readFileSync(APPOINTMENTS_SERVICE, "utf-8");
    expect(src).toContain("acknowledgedUserId");
  });

  it("only approved server files assign appointments.acknowledgedUserId", () => {
    const allowedWriters = new Set([
      path.join(REPO_ROOT, "server/routes/admin-task-ownership.ts"),
      path.join(REPO_ROOT, "server/workers/taskOwnershipBackfill.worker.ts"),
      path.join(REPO_ROOT, "server/workers/staleTaskOwnershipSweepWorker.ts"),
    ]);
    const serverDir = path.join(REPO_ROOT, "server");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(p);
        } else if (entry.isFile() && /\.(ts|tsx|js)$/.test(entry.name)) {
          const content = fs.readFileSync(p, "utf-8");
          if (/acknowledgedUserId\s*:/.test(content) && !allowedWriters.has(p) && p !== APPOINTMENTS_SERVICE) {
            if (/\.set\(\{[^}]*acknowledgedUserId/.test(content)) {
              offenders.push(p);
            }
          }
        }
      }
    };
    walk(serverDir);
    expect(offenders.sort()).toEqual([...allowedWriters].sort());
  });
});
