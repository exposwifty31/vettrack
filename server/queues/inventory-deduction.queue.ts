import type { JobsOptions } from "bullmq";

/**
 * Legacy queue name — billing/inventory jobs removed; producer is a no-op.
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
    _data: InventoryDeductionJobData,
    _options?: JobsOptions,
  ): Promise<void> {
    return;
  },
};
