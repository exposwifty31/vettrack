import type { InventoryDeductionJobData } from "../queues/inventory-deduction.queue.js";

/** Billing/inventory-jobs removed — no-op processor kept for job-runtime wiring compatibility. */
export async function processInventoryDeductionJob(
  _jobData: InventoryDeductionJobData,
): Promise<void> {
  return;
}

/** @deprecated Inventory deduction runs inline at task/dispense completion. */
export async function startInventoryDeductionWorker(): Promise<void> {
  console.warn("[inventory-deduction] worker disabled (billing schema removed)");
}
