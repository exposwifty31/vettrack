export const INVENTORY_DEDUCTION_QUEUE_NAME = "inventory-deduction";
export const INVENTORY_DEDUCTION_JOB_NAME = "inventory-deduction";

export interface InventoryDeductionJobData {
  taskId: string;
  containerId: string;
  requiredVolumeMl: number;
  clinicId: string;
  animalId: string | null;
}

export { inventoryDeductionQueue } from "../workers/inventory-deduction.worker.js";
