/**
 * Inventory management-console read rows (Phase 7d). Clinic-scoped, read-only
 * oversight views: restock sessions (B3) and low-stock items (B4).
 */
export type RestockSessionRow = {
  id: string;
  containerName: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
};

export type LowStockRow = {
  itemId: string;
  label: string;
  parLevel: number;
  onHand: number;
  /** parLevel − onHand (always > 0 for a low-stock row). */
  short: number;
};
