/**
 * VetTrack 2.0, Task 1.1 §4 — `RestockBurnReader` port.
 *
 * v1 trigger rule (deliberately simple, per the plan's own recommendation):
 * an active `vt_items` row with a non-null `reorderPoint` is "flagged" when
 * its current on-hand — summed across every `vt_container_items` row for
 * that item — is at or below `reorderPoint`. No burn-rate projection in v1
 * (deferred; the port name `RestockBurnReader` is kept per the plan even
 * though this v1 only implements the threshold rule, not a burn-rate
 * forecast).
 *
 * Items with a null `reorderPoint` or `isActive = false` are never
 * considered — matches the columns' own documented semantics
 * (`server/schema/inventory.ts`).
 *
 * Every query is `clinicId`-scoped (CLAUDE.md multi-tenancy rule) — a
 * clinic-B read never sees clinic-A's items or container rows.
 *
 * Citations: only OBSERVED DB rows are citable facts (never a derived
 * number like the summed `onHand` total) — each contributing
 * `vt_container_items` row, plus the `vt_items` row itself, is returned so
 * the composer (§4) can cite them. The composer decides which items to
 * actually cite (only `flagged === true` ones become part of a proposal).
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, inventoryItems, containerItems } from "../../db.js";

export interface RestockCitedContainerRow {
  id: string;
  containerId: string;
  quantity: number;
  updatedAt: Date;
}

export interface RestockItemReadResult {
  itemId: string;
  /** Explicit alias for `itemId` — the citable `vt_items` row id (kept distinct in the shape for citation clarity). */
  inventoryItemRowId: string;
  flagged: boolean;
  onHand: number;
  reorderPoint: number;
  parLevel: number | null;
  containerRows: RestockCitedContainerRow[];
}

export interface RestockBurnReadResult {
  items: RestockItemReadResult[];
}

export interface RestockBurnReader {
  read(clinicId: string): Promise<RestockBurnReadResult>;
}

export class DrizzleRestockBurnReader implements RestockBurnReader {
  async read(clinicId: string): Promise<RestockBurnReadResult> {
    const candidateItems = await db
      .select()
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.clinicId, clinicId),
          eq(inventoryItems.isActive, true),
          isNotNull(inventoryItems.reorderPoint),
        ),
      );

    if (candidateItems.length === 0) return { items: [] };

    const itemIds = candidateItems.map((item) => item.id);
    const rows = await db
      .select()
      .from(containerItems)
      .where(and(eq(containerItems.clinicId, clinicId), inArray(containerItems.itemId, itemIds)));

    const rowsByItem = new Map<string, RestockCitedContainerRow[]>();
    for (const row of rows) {
      const arr = rowsByItem.get(row.itemId) ?? [];
      arr.push({ id: row.id, containerId: row.containerId, quantity: row.quantity, updatedAt: row.updatedAt });
      rowsByItem.set(row.itemId, arr);
    }

    const items: RestockItemReadResult[] = candidateItems.map((item) => {
      const containerRows = rowsByItem.get(item.id) ?? [];
      const onHand = containerRows.reduce((sum, row) => sum + row.quantity, 0);
      const reorderPoint = item.reorderPoint as number; // non-null via the isNotNull filter above
      return {
        itemId: item.id,
        inventoryItemRowId: item.id,
        flagged: onHand <= reorderPoint,
        onHand,
        reorderPoint,
        parLevel: item.parLevel,
        containerRows,
      };
    });

    return { items };
  }
}

export interface InMemoryRestockBurnReaderSeed {
  items?: { id: string; clinicId: string; reorderPoint: number | null; parLevel: number | null; isActive: boolean }[];
  containerRows?: { id: string; clinicId: string; containerId: string; itemId: string; quantity: number; updatedAt: Date }[];
}

/** Test fake — mirrors the real reader's `clinicId`-scoping: rows seeded under a different clinic are never returned. */
export class InMemoryRestockBurnReader implements RestockBurnReader {
  constructor(private readonly seed: InMemoryRestockBurnReaderSeed = {}) {}

  async read(clinicId: string): Promise<RestockBurnReadResult> {
    const candidateItems = (this.seed.items ?? []).filter(
      (item) => item.clinicId === clinicId && item.isActive && item.reorderPoint != null,
    );

    const items: RestockItemReadResult[] = candidateItems.map((item) => {
      const containerRows = (this.seed.containerRows ?? [])
        .filter((row) => row.clinicId === clinicId && row.itemId === item.id)
        .map((row) => ({ id: row.id, containerId: row.containerId, quantity: row.quantity, updatedAt: row.updatedAt }));
      const onHand = containerRows.reduce((sum, row) => sum + row.quantity, 0);
      const reorderPoint = item.reorderPoint as number;
      return {
        itemId: item.id,
        inventoryItemRowId: item.id,
        flagged: onHand <= reorderPoint,
        onHand,
        reorderPoint,
        parLevel: item.parLevel,
        containerRows,
      };
    });

    return { items };
  }
}
