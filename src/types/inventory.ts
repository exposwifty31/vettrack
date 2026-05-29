/**
 * Inventory, containers, procurement, restock types (Slice 6f).
 * No imports from ./index.ts.
 */

export interface InventoryContainer {
  id: string;
  clinicId: string;
  name: string;
  department: string;
  targetQuantity: number;
  currentQuantity: number;
  roomId: string | null;
  billingItemId: string | null;
  nfcTagId: string | null;
  supplyTargets?: Array<{
    code: string;
    label: string;
    targetUnits: number;
  }>;
}

export interface RestockSession {
  id: string;
  clinicId: string;
  containerId: string;
  ownedByUserId: string;
  status: "active" | "finished";
  startedAt: string;
  finishedAt: string | null;
}

export interface RestockContainerLine {
  itemId: string | null;
  code: string;
  label: string;
  nfcTagId: string | null;
  expected: number;
  actual: number;
  missing: number;
  sessionObservedQuantity: number | null;
}

export interface RestockContainerView {
  container: InventoryContainer;
  lines: RestockContainerLine[];
  activeSession: RestockSession | null;
}

export interface RestockFinishSummary {
  session: RestockSession;
  totalAdded: number;
  totalRemoved: number;
  itemsMissingCount: number;
}

export const INVENTORY_ITEM_CATEGORIES = [
  "IV Access",
  "Syringes",
  "Fluid Lines",
  "Urinary",
  "Wound Care",
  "Monitoring",
  "Feeding",
  "Other",
] as const;

export type InventoryItemCategory = (typeof INVENTORY_ITEM_CATEGORIES)[number];

export interface InventoryItem {
  id: string;
  clinicId: string;
  code: string;
  label: string;
  nfcTagId: string | null;
  category: string | null;
  isBillable: boolean;
  minimumDispenseToCapture: number;
  createdAt: string;
}

export type PurchaseOrderStatus = "draft" | "ordered" | "partial" | "received" | "cancelled";

export interface PurchaseOrderLine {
  id: string;
  purchaseOrderId: string;
  clinicId: string;
  itemId: string;
  itemLabel?: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitPriceCents: number;
  createdAt: string;
}

export interface PurchaseOrder {
  id: string;
  clinicId: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  orderedAt: string | null;
  expectedAt: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lines?: PurchaseOrderLine[];
}

export interface ConsumablesReportEvent {
  id: string;
  containerId: string;
  itemLabel: string;
  quantity: number;
  animalName: string | null;
  takenByDisplayName: string;
  takenAt: string;
  containerName: string;
  isEmergency: boolean;
  pendingCompletion: boolean;
}

export interface UserActivityEntry {
  userId: string;
  userName: string;
  dispensedCount: number;
  billedCount: number;
  captureRatePercent: number;
}

export interface ConsumablesReport {
  totalEvents: number;
  unlinkedCount: number;
  unlinkedPct: number;
  pendingEmergencies: number;
  /** Containers with dispenses in the window that have no matching billing entry. */
  unBilledCount: number;
  byItem: Array<{ itemId: string; label: string; totalQuantity: number }>;
  byAnimal: Array<{ animalId: string | null; animalName: string | null; totalEvents: number }>;
  byUser: Array<{ userId: string; displayName: string; totalEvents: number }>;
  userActivity: UserActivityEntry[];
  events: ConsumablesReportEvent[];
}

export interface InventoryContainerWithItems extends InventoryContainer {
  items: Array<{
    id: string;
    itemId: string;
    quantity: number;
    label: string | null;
    code: string | null;
  }>;
}

export interface InventoryJob {
  id: string;
  clinicId: string;
  taskId: string;
  containerId: string;
  requiredVolumeMl: string;
  animalId: string | null;
  status: "pending" | "processing" | "resolved" | "failed";
  retryCount: number;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}
