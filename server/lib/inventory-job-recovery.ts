/** Billing inventory jobs removed — recovery is a no-op. */
export async function recoverPendingInventoryJobs(
  _clinicId?: string,
): Promise<{ enqueued: number; skipped: number }> {
  return { enqueued: 0, skipped: 0 };
}
