/**
 * Billing / ledger / leakage types (Slice 6e).
 * No imports from ./index.ts.
 */

export interface BillingLedgerEntry {
  id: string;
  clinicId: string;
  animalId: string;
  itemType: "EQUIPMENT" | "CONSUMABLE";
  itemId: string;
  quantity: number;
  unitPriceCents: number;
  totalAmountCents: number;
  idempotencyKey: string;
  status: "pending" | "synced" | "voided";
  createdAt: string;
}

export interface BillingItem {
  id: string;
  clinicId: string;
  code: string;
  description: string;
  unitPriceCents: number;
  chargeKind: "per_scan_hour" | "per_unit";
  createdAt: string;
}

export interface BillingSummary {
  totalCents: number;
  pendingCents: number;
  syncedCents: number;
  voidedCents: number;
  byType: {
    EQUIPMENT: number;
    CONSUMABLE: number;
  };
  byDay: Array<{
    date: string;
    totalCents: number;
  }>;
}

export interface LeakageReportItem {
  containerId: string;
  containerName: string;
  unitPriceCents: number;
  dispensedQty: number;
  billedQty: number;
  gapQty: number;
  gapValueCents: number;
  leakagePct: number;
}

export interface LeakageReport {
  from: string;
  to: string;
  summary: {
    totalDispensedQty: number;
    totalBilledQty: number;
    totalGapQty: number;
    totalGapValueCents: number;
    overallLeakagePct: number;
  };
  items: LeakageReportItem[];
}

export interface ManualBillingRequest {
  inventoryLogId: string;
  itemId: string;
  quantity: number;
  unitPriceCents: number;
  animalId?: string;
}
