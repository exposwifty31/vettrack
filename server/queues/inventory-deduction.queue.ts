import type { Job, JobsOptions } from "bullmq";

/**
 * Producer lives in this module (not inventory-deduction.worker) so imports of
 * constants/types for registry metadata do not evaluate the worker's db chain.
 */
export const INVENTORY_DEDUCTION_QUEUE_NAME = "inventory-deduction";
export const INVENTORY_DEDUCTION_JOB_NAME = "inventory-deduction";

export interface InventoryDeductionJobData {
  taskId: string;
  containerId: string;
  requiredVolumeMl: number;
  clinicId: string;
  animalId: string | null;
}

export const inventoryDeductionQueue = {
  async add(
    data: InventoryDeductionJobData,
    options?: JobsOptions,
  ): Promise<Job<InventoryDeductionJobData>> {
    const { enqueueJob } = await import("../jobs/enqueue.js");
    return enqueueJob(
      "inventory-deduction",
      data,
      options ? { bullmq: options } : undefined,
    );
  },
};
