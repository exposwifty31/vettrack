/**
 * Inventory deduction queue — legacy producer stub (billing schema removed).
 */
import { describe, it, expect, vi } from "vitest";

const mockEnqueueJob = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "job-1" }));

vi.mock("../../server/jobs/enqueue.js", () => ({
  enqueueJob: mockEnqueueJob,
}));

import {
  INVENTORY_DEDUCTION_JOB_NAME,
  inventoryDeductionQueue,
  type InventoryDeductionJobData,
} from "../../server/queues/inventory-deduction.queue.js";

const BASE_PAYLOAD: InventoryDeductionJobData = {
  taskId: "task-1",
  containerId: "container-1",
  requiredVolumeMl: 2.5,
  clinicId: "clinic-a",
  animalId: "animal-1",
};

describe("inventory-deduction.queue module", () => {
  it("exposes queue constants from the queue module path (no worker re-export)", async () => {
    vi.resetModules();
    const queueMod = await import("../../server/queues/inventory-deduction.queue.js");
    expect(queueMod.INVENTORY_DEDUCTION_QUEUE_NAME).toBe("inventory-deduction");
    expect(queueMod.INVENTORY_DEDUCTION_JOB_NAME).toBe("inventory-deduction");
    expect(typeof queueMod.inventoryDeductionQueue.add).toBe("function");
  });
});

describe("inventoryDeductionQueue.add — disabled producer stub", () => {
  it("does not call enqueueJob (deduction runs inline at completion)", async () => {
    await inventoryDeductionQueue.add(BASE_PAYLOAD);
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it("accepts optional BullMQ options as a no-op", async () => {
    await inventoryDeductionQueue.add(BASE_PAYLOAD, { jobId: "deduct-task-1", delay: 5000 });
    expect(mockEnqueueJob).not.toHaveBeenCalled();
    expect(INVENTORY_DEDUCTION_JOB_NAME).toBe("inventory-deduction");
  });
});
