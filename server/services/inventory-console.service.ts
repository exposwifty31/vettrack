import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, restockSessions, containers, inventoryItems, containerItems } from "../db.js";
import type { RestockSessionRow, RestockSessionStatus, LowStockRow } from "../../shared/inventory-console.js";

const LIST_LIMIT = 100;

/**
 * Clinic-scoped restock-session oversight list for the management console (B3).
 * All sessions across the clinic (not just the caller's own), newest-first.
 */
export async function listRestockSessionsForClinic(clinicId: string): Promise<RestockSessionRow[]> {
  const rows = await db
    .select({
      id: restockSessions.id,
      containerName: containers.name,
      status: restockSessions.status,
      startedAt: restockSessions.startedAt,
      finishedAt: restockSessions.finishedAt,
    })
    .from(restockSessions)
    .innerJoin(containers, eq(containers.id, restockSessions.containerId))
    .where(eq(restockSessions.clinicId, clinicId))
    .orderBy(desc(restockSessions.startedAt))
    .limit(LIST_LIMIT);

  return rows.map((r) => ({
    id: r.id,
    containerName: r.containerName,
    // DB text column; the schema constrains it to the lifecycle set.
    status: r.status as RestockSessionStatus,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
  }));
}

/**
 * Clinic-scoped low-stock aggregate for the management console (B4). An item is
 * low-stock when it has a par level and the summed on-hand across its containers is
 * below it. Most-short first.
 */
export async function listLowStockItems(clinicId: string): Promise<LowStockRow[]> {
  const onHand = sql<number>`COALESCE(SUM(${containerItems.quantity}), 0)::int`;
  const rows = await db
    .select({
      itemId: inventoryItems.id,
      label: inventoryItems.label,
      parLevel: inventoryItems.parLevel,
      onHand,
    })
    .from(inventoryItems)
    .leftJoin(
      containerItems,
      and(eq(containerItems.itemId, inventoryItems.id), eq(containerItems.clinicId, clinicId)),
    )
    .where(
      and(
        eq(inventoryItems.clinicId, clinicId),
        eq(inventoryItems.isActive, true),
        isNotNull(inventoryItems.parLevel),
      ),
    )
    .groupBy(inventoryItems.id, inventoryItems.label, inventoryItems.parLevel)
    .having(sql`COALESCE(SUM(${containerItems.quantity}), 0) < ${inventoryItems.parLevel}`)
    .orderBy(sql`(${inventoryItems.parLevel} - COALESCE(SUM(${containerItems.quantity}), 0)) DESC`)
    .limit(LIST_LIMIT);

  return rows.map((r) => {
    const parLevel = r.parLevel ?? 0;
    const onHandN = Number(r.onHand ?? 0);
    return { itemId: r.itemId, label: r.label, parLevel, onHand: onHandN, short: parLevel - onHandN };
  });
}
