/**
 * Job Registry 1c-2 — inventory-deduction producer delegates to enqueueJob().
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

describe("inventoryDeductionQueue.add — enqueueJob delegation (1c-2)", () => {
  beforeEach(() => {
    mockEnqueueJob.mockClear();
  });

  it("calls enqueueJob with inventory-deduction kind and payload", async () => {
    await inventoryDeductionQueue.add(BASE_PAYLOAD);

    expect(mockEnqueueJob).toHaveBeenCalledTimes(1);
    expect(mockEnqueueJob.mock.calls[0]?.[0]).toBe(INVENTORY_DEDUCTION_JOB_NAME);
    expect(mockEnqueueJob).toHaveBeenCalledWith("inventory-deduction", BASE_PAYLOAD, undefined);
  });

  it("passes per-add BullMQ options through bullmq override", async () => {
    const options = { jobId: "deduct-task-1", delay: 5000 };

    await inventoryDeductionQueue.add(BASE_PAYLOAD, options);

    expect(mockEnqueueJob).toHaveBeenCalledWith("inventory-deduction", BASE_PAYLOAD, {
      bullmq: options,
    });
  });
});
