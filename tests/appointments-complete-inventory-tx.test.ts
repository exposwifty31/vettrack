/**
 * Service task completion no longer deducts medication inventory in completeTask.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const serviceSource = readFileSync("server/services/appointments.service.ts", "utf8");

describe("completeTask (service tasks only)", () => {
  it("does not call deductMedicationInventoryInTx", () => {
    expect(serviceSource).not.toContain("deductMedicationInventoryInTx");
  });

  it("updates appointment status in a direct update (no medication completion transaction)", () => {
    const fnStart = serviceSource.indexOf("export async function completeTask");
    const fnEnd = serviceSource.indexOf("export async function getTasksForTechnician", fnStart);
    const block = serviceSource.slice(fnStart, fnEnd);
    expect(block).toContain('.update(appointments)');
    expect(block).not.toContain("medication-task-complete:");
  });
});
