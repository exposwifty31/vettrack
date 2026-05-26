/**
 * Medication task completion (production /api/tasks path) must insert inventory job
 * in the same DB transaction as billing + task status.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const serviceSource = readFileSync("server/services/appointments.service.ts", "utf8");

describe("completeTask inventory job transaction", () => {
  it("inserts vt_inventory_jobs inside the completion transaction", () => {
    const fnStart = serviceSource.indexOf("const completionIdempotencyKey = ");
    const fnEnd = serviceSource.indexOf("const serialized = serializeAppointment(updated)", fnStart);
    const block = serviceSource.slice(fnStart, fnEnd);

    expect(block).toMatch(
      /await db\.transaction\(async \(tx\) => \{[\s\S]*tx[\s\S]*\.insert\(inventoryJobs\)[\s\S]*\}\);/,
    );
    expect(block).not.toMatch(
      /\}\);\s*\n\s*let inventoryJobInserted[\s\S]*await db\.insert\(inventoryJobs\)/,
    );
  });
});
