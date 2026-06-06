/**
 * inventory-deduction producer is a no-op — billing/inventory jobs removed from registry.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEnqueueJob = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "job-1" }));

vi.mock("../../server/jobs/enqueue.js", () => ({
  enqueueJob: mockEnqueueJob,
}));

import {
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

describe("inventoryDeductionQueue.add — no-op producer", () => {
  beforeEach(() => {
    mockEnqueueJob.mockClear();
  });

  it("does not delegate to enqueueJob", async () => {
    await inventoryDeductionQueue.add(BASE_PAYLOAD);

    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it("ignores per-add BullMQ options without enqueuing", async () => {
    const options = { jobId: "deduct-task-1", delay: 5000 };

    await inventoryDeductionQueue.add(BASE_PAYLOAD, options);

    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });
});
