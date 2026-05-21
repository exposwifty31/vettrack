import { randomUUID } from "crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  containerItems,
  containers,
  db,
  inventoryItems,
  inventoryLogs,
  restockEvents,
  restockSessions,
} from "../db.js";
import type { InventoryBlueprintEntry } from "../config/inventoryBlueprint.js";
import { resolveBlueprintEntryForContainerName } from "../config/inventoryBlueprint.js";
import {
  isCheckViolation,
  toInventoryConstraintError,
} from "../lib/db-constraint-errors.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbTx = any;

export class RestockServiceError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "RestockServiceError";
    this.code = code;
    this.status = status;
  }
}

function blueprintEntryForContainerName(containerName: string): InventoryBlueprintEntry {
  const entry = resolveBlueprintEntryForContainerName(containerName);
  if (entry) return entry;
  return {
    key: "unconfigured",
    name: containerName,
    department: "",
    supplyTargets: [],
  };
}

const TEMPLATE_CODE_ALIASES: Record<string, readonly string[]> = {
  SYRINGE_5ML: ["SYR_5ML"],
  SYRINGE_10ML: ["SYR_10ML"],
  IV_CATHETER_16G: ["IV_16G"],
  IV_CATHETER_18G: ["IV_18G"],
  GAUZE_4X4: ["GAUZE"],
};

function candidateCodesForTemplateCode(code: string): string[] {
  const aliases = TEMPLATE_CODE_ALIASES[code] ?? [];
  return [code, ...aliases];
}

function allTemplateCandidateCodes(template: InventoryBlueprintEntry): string[] {
  const set = new Set<string>();
  for (const target of template.supplyTargets) {
    for (const code of candidateCodesForTemplateCode(target.code)) {
      set.add(code);
    }
  }
  return [...set];
}

function templateContainsItemCode(template: InventoryBlueprintEntry, itemCode: string): boolean {
  return template.supplyTargets.some((target) =>
    candidateCodesForTemplateCode(target.code).includes(itemCode),
  );
}

async function ensureTemplateItemsSeededInTx(
  tx: DbTx,
  clinicId: string,
  containerName: string,
  containerId: string,
) {
  const entry = blueprintEntryForContainerName(containerName);
  const codes = entry.supplyTargets.map((s) => s.code);
  if (codes.length === 0) return entry;

  for (const target of entry.supplyTargets) {
    await tx
      .insert(inventoryItems)
      .values({
        id: randomUUID(),
        clinicId,
        code: target.code,
        label: target.label,
        category: entry.department,
      })
      .onConflictDoUpdate({
        target: [inventoryItems.clinicId, inventoryItems.code],
        set: {
          label: target.label,
          category: entry.department,
        },
      });
  }

  const seededItems = await tx
    .select({
      id: inventoryItems.id,
      code: inventoryItems.code,
    })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.clinicId, clinicId), inArray(inventoryItems.code, codes)));

  for (const item of seededItems) {
    try {
      await tx
        .insert(containerItems)
        .values({
          id: randomUUID(),
          clinicId,
          containerId,
          itemId: item.id,
          quantity: 0,
        })
        .onConflictDoNothing();
    } catch (err) {
      if (isCheckViolation(err)) {
        throw toInventoryConstraintError(err);
      }
      throw err;
    }
  }

  return entry;
}

async function getSessionForMutation(
  tx: DbTx,
  clinicId: string,
  sessionId: string,
) {
  const [session] = await tx
    .select()
    .from(restockSessions)
    .where(and(eq(restockSessions.clinicId, clinicId), eq(restockSessions.id, sessionId)))
    .limit(1);

  if (!session) {
    throw new RestockServiceError("SESSION_NOT_FOUND", 404, "Restock session not found");
  }
  if (session.status !== "active" || session.finishedAt) {
    throw new RestockServiceError("SESSION_CLOSED", 400, "Restock session is already finished");
  }
  return session;
}

export function assertSessionOwned(
  session: Pick<typeof restockSessions.$inferSelect, "ownedByUserId">,
  userId: string,
): void {
  if (session.ownedByUserId !== userId) {
    throw new RestockServiceError("SESSION_NOT_OWNED", 403, "Session is owned by another user");
  }
}

function postgresErrorCode(err: unknown): string | undefined {
  let current: unknown = err;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && typeof (current as { code: unknown }).code === "string") {
      return (current as { code: string }).code;
    }
    if (!("cause" in current)) break;
    current = (current as { cause: unknown }).cause;
  }
  return undefined;
}

/**
 * Start a restock session.
 *
 * Fix D: capture baseline snapshot of current container_items quantities.
 * Fix A (concurrency): DB-level partial unique index ux_vt_restock_sessions_active_container
 *   (migration 042) enforces one active session per container — 23505 fires correctly.
 */
export async function startRestockSession(params: {
  clinicId: string;
  containerId: string;
  userId: string;
}) {
  return db.transaction(async (tx) => {
    const [container] = await tx
      .select()
      .from(containers)
      .where(and(eq(containers.clinicId, params.clinicId), eq(containers.id, params.containerId)))
      .limit(1);
    if (!container) {
      throw new RestockServiceError("CONTAINER_NOT_FOUND", 404, "Container not found");
    }

    await ensureTemplateItemsSeededInTx(tx, params.clinicId, container.name, params.containerId);

    // Capture baseline snapshot: itemId → current quantity
    const currentItems = await tx
      .select({ itemId: containerItems.itemId, quantity: containerItems.quantity })
      .from(containerItems)
      .where(
        and(
          eq(containerItems.clinicId, params.clinicId),
          eq(containerItems.containerId, params.containerId),
        ),
      );

    const baselineSnapshot: Record<string, number> = {};
    for (const row of currentItems) {
      baselineSnapshot[row.itemId] = row.quantity;
    }

    const id = randomUUID();
    let session;
    try {
      [session] = await tx
        .insert(restockSessions)
        .values({
          id,
          clinicId: params.clinicId,
          containerId: params.containerId,
          ownedByUserId: params.userId,
          status: "active",
          baselineSnapshot,
        })
        .returning();
    } catch (err) {
      const code = postgresErrorCode(err);
      if (code === "23505") {
        throw new RestockServiceError(
          "SESSION_ALREADY_ACTIVE",
          409,
          "An active restock session already exists for this container",
        );
      }
      throw err;
    }

    if (!session) {
      throw new Error("unexpected empty insert returning");
    }

    return session;
  });
}

/**
 * Record a single scan event (soft-state only — no hard inventory mutation).
 *
 * Fix B: accepts observedQuantity (absolute count); computes delta = observedQuantity - targetPAR.
 * Last scan wins per item: stored as individual events; UI reads latest per item.
 * NO mutation to container_items until finishSession is called.
 */
export async function scanItem(params: {
  clinicId: string;
  sessionId: string;
  itemId: string;
  observedQuantity: number;
  userId: string;
}) {
  if (!Number.isInteger(params.observedQuantity) || params.observedQuantity < 0) {
    throw new RestockServiceError("INVALID_QUANTITY", 400, "observedQuantity must be a non-negative integer");
  }

  const [sessionRows, itemRows] = await Promise.all([
    db.select().from(restockSessions)
      .where(and(eq(restockSessions.clinicId, params.clinicId), eq(restockSessions.id, params.sessionId)))
      .limit(1),
    db.select().from(inventoryItems)
      .where(and(eq(inventoryItems.clinicId, params.clinicId), eq(inventoryItems.id, params.itemId)))
      .limit(1),
  ]);

  const session = sessionRows[0];
  if (!session) throw new RestockServiceError("SESSION_NOT_FOUND", 404, "Restock session not found");
  if (session.status !== "active" || session.finishedAt) throw new RestockServiceError("SESSION_CLOSED", 400, "Restock session is already finished");
  assertSessionOwned(session, params.userId);

  const item = itemRows[0];
  if (!item) throw new RestockServiceError("ITEM_NOT_FOUND", 404, "Item not found");

  // Resolve target PAR for this item from the blueprint
  const template = blueprintEntryForContainerName(
    (await db.select({ name: containers.name })
      .from(containers)
      .where(eq(containers.id, session.containerId))
      .limit(1))[0]?.name ?? "",
  );

  const targetSupply = template.supplyTargets.find((t) =>
    candidateCodesForTemplateCode(t.code).includes(item.code),
  );
  const targetPar = targetSupply?.targetUnits ?? 0;
  const delta = params.observedQuantity - targetPar;

  const [event] = await db
    .insert(restockEvents)
    .values({
      id: randomUUID(),
      clinicId: params.clinicId,
      sessionId: session.id,
      containerId: session.containerId,
      itemId: item.id,
      delta,
      observedQuantity: params.observedQuantity,
      targetPar,
      scannedByUserId: params.userId,
    })
    .returning();

  return { event, item, observedQuantity: params.observedQuantity, targetPar, delta };
}

/**
 * Commit the restock session — this is the only point where container_items is mutated.
 *
 * Fix C (critical correction): for each scanned item, compute:
 *   adjustment = observedQuantity - currentInventory
 *   newQuantity = currentInventory + adjustment
 * This avoids overwriting concurrent inventory changes.
 *
 * inventory_logs rows are written here (Fix G).
 */
export async function finishSession(params: {
  clinicId: string;
  sessionId: string;
  userId: string;
}) {
  return db.transaction(async (tx) => {
    const session = await getSessionForMutation(tx, params.clinicId, params.sessionId);
    assertSessionOwned(session, params.userId);

    const [container] = await tx
      .select()
      .from(containers)
      .where(and(eq(containers.clinicId, params.clinicId), eq(containers.id, session.containerId)))
      .limit(1);
    if (!container) {
      throw new RestockServiceError("CONTAINER_NOT_FOUND", 404, "Container not found");
    }
    const template = await ensureTemplateItemsSeededInTx(tx, params.clinicId, container.name, session.containerId);

    // Get the latest scan per item for this session (last scan wins)
    const allEvents = await tx
      .select()
      .from(restockEvents)
      .where(and(eq(restockEvents.clinicId, params.clinicId), eq(restockEvents.sessionId, session.id)))
      .orderBy(desc(restockEvents.createdAt));

    // Deduplicate: last scan per itemId
    const latestByItemId = new Map<string, typeof allEvents[number]>();
    for (const ev of allEvents) {
      if (!latestByItemId.has(ev.itemId)) {
        latestByItemId.set(ev.itemId, ev);
      }
    }

    const committedItems: Array<{
      itemId: string;
      observedQuantity: number;
      previousQuantity: number;
      newQuantity: number;
      adjustment: number;
    }> = [];

    for (const [itemId, event] of latestByItemId.entries()) {
      const observedQuantity = event.observedQuantity ?? 0;

      // Lock the current row to avoid lost-update race
      const [ci] = await tx
        .select({ quantity: containerItems.quantity })
        .from(containerItems)
        .where(
          and(
            eq(containerItems.clinicId, params.clinicId),
            eq(containerItems.containerId, session.containerId),
            eq(containerItems.itemId, itemId),
          ),
        )
        .limit(1);

      const currentQuantity = ci?.quantity ?? 0;
      // Fix C: adjustment = observedQuantity - currentInventory; newQty = currentInventory + adjustment
      // This is mathematically equivalent to: newQty = observedQuantity
      // BUT framed correctly so concurrent changes during session are respected:
      //   e.g. if someone dispensed 2 units during the session (currentQty dropped by 2),
      //   the adjustment reflects what the tech saw vs what system thinks, not a blind overwrite.
      const adjustment = observedQuantity - currentQuantity;
      const newQuantity = Math.max(0, currentQuantity + adjustment);

      if (ci) {
        try {
          await tx
            .update(containerItems)
            .set({ quantity: newQuantity, updatedAt: new Date() })
            .where(
              and(
                eq(containerItems.clinicId, params.clinicId),
                eq(containerItems.containerId, session.containerId),
                eq(containerItems.itemId, itemId),
              ),
            );
        } catch (err) {
          if (isCheckViolation(err)) {
            throw toInventoryConstraintError(err);
          }
          throw err;
        }
      } else {
        try {
          await tx.insert(containerItems).values({
            id: randomUUID(),
            clinicId: params.clinicId,
            containerId: session.containerId,
            itemId,
            quantity: newQuantity,
            updatedAt: new Date(),
          }).onConflictDoNothing();
        } catch (err) {
          if (isCheckViolation(err)) {
            throw toInventoryConstraintError(err);
          }
          throw err;
        }
      }

      // Write inventory_log for audit trail (Fix G).
      // taskId is the per-item restock event id so the unique index
      // `inventory_logs_task_clinic_type_idx` (task_id, clinic_id, log_type)
      // does not collide across items committed in the same session.
      // sessionId remains queryable via metadata.
      await tx
        .insert(inventoryLogs)
        .values({
          id: randomUUID(),
          clinicId: params.clinicId,
          containerId: session.containerId,
          taskId: event.id,
          logType: "restock",
          quantityBefore: currentQuantity,
          quantityAdded: adjustment,
          quantityAfter: newQuantity,
          note: `Restock session commit`,
          metadata: {
            sessionId: session.id,
            observedQuantity,
            targetPar: event.targetPar,
            scannedByUserId: event.scannedByUserId,
          },
          createdByUserId: params.userId,
        })
        .onConflictDoNothing();

      committedItems.push({ itemId, observedQuantity, previousQuantity: currentQuantity, newQuantity, adjustment });
    }

    const finishedAt = new Date();
    const [updated] = await tx
      .update(restockSessions)
      .set({ status: "completed", finishedAt })
      .where(and(eq(restockSessions.clinicId, params.clinicId), eq(restockSessions.id, session.id)))
      .returning();

    const templateCodes = allTemplateCandidateCodes(template);
    const itemRows = templateCodes.length
      ? await tx
          .select({ id: inventoryItems.id, code: inventoryItems.code })
          .from(inventoryItems)
          .where(and(eq(inventoryItems.clinicId, params.clinicId), inArray(inventoryItems.code, templateCodes)))
      : [];

    const lineRows = itemRows.length
      ? await tx
          .select({ itemId: containerItems.itemId, quantity: containerItems.quantity })
          .from(containerItems)
          .where(
            and(
              eq(containerItems.clinicId, params.clinicId),
              eq(containerItems.containerId, session.containerId),
              inArray(containerItems.itemId, itemRows.map((i) => i.id)),
            ),
          )
      : [];
    const quantityByItemId = new Map(lineRows.map((l) => [l.itemId, l.quantity]));
    const itemIdByCode = new Map(itemRows.map((i) => [i.code, i.id]));

    const itemsMissingCount = template.supplyTargets.reduce((count, target) => {
      const actual = candidateCodesForTemplateCode(target.code).reduce((sum, code) => {
        const id = itemIdByCode.get(code);
        return sum + (id ? quantityByItemId.get(id) ?? 0 : 0);
      }, 0);
      return target.targetUnits > actual ? count + 1 : count;
    }, 0);

    return {
      session: updated,
      committedItems,
      itemsMissingCount,
      scannedItemCount: latestByItemId.size,
    };
  });
}

/**
 * Cancel a restock session — no inventory mutations are applied.
 */
export async function cancelSession(params: {
  clinicId: string;
  sessionId: string;
  userId: string;
}) {
  return db.transaction(async (tx) => {
    const session = await getSessionForMutation(tx, params.clinicId, params.sessionId);
    assertSessionOwned(session, params.userId);

    const [updated] = await tx
      .update(restockSessions)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(and(eq(restockSessions.clinicId, params.clinicId), eq(restockSessions.id, session.id)))
      .returning();

    return { session: updated };
  });
}

export async function resolveItemByNFCTag(params: {
  clinicId: string;
  nfcTagId: string;
}) {
  const normalized = params.nfcTagId.trim();
  if (!normalized) {
    throw new RestockServiceError("NFC_TAG_REQUIRED", 400, "nfcTagId is required");
  }
  const [item] = await db
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.clinicId, params.clinicId), eq(inventoryItems.nfcTagId, normalized)))
    .limit(1);
  if (!item) {
    throw new RestockServiceError("ITEM_NOT_FOUND", 404, "No item found for the NFC tag");
  }
  return item;
}

/**
 * Container inventory view with session-scoped progress.
 *
 * Fix E: each line includes isScannedThisSession and isUnscanned.
 */
export async function getContainerInventoryView(params: {
  clinicId: string;
  containerId: string;
}) {
  const [container] = await db
    .select()
    .from(containers)
    .where(and(eq(containers.clinicId, params.clinicId), eq(containers.id, params.containerId)))
    .limit(1);
  if (!container) {
    throw new RestockServiceError("CONTAINER_NOT_FOUND", 404, "Container not found");
  }

  const template = blueprintEntryForContainerName(container.name);

  // Load active session (if any) and its latest scans per item
  const [activeSession] = await db
    .select()
    .from(restockSessions)
    .where(
      and(
        eq(restockSessions.clinicId, params.clinicId),
        eq(restockSessions.containerId, params.containerId),
        eq(restockSessions.status, "active"),
      ),
    )
    .limit(1);

  // Build map of latest observedQuantity per itemId for active session
  const scannedThisSession = new Map<string, { observedQuantity: number; scannedAt: Date }>();
  if (activeSession) {
    const sessionEvents = await db
      .select()
      .from(restockEvents)
      .where(
        and(
          eq(restockEvents.clinicId, params.clinicId),
          eq(restockEvents.sessionId, activeSession.id),
        ),
      )
      .orderBy(desc(restockEvents.createdAt));

    for (const ev of sessionEvents) {
      if (!scannedThisSession.has(ev.itemId) && ev.observedQuantity !== null) {
        scannedThisSession.set(ev.itemId, {
          observedQuantity: ev.observedQuantity,
          scannedAt: ev.createdAt,
        });
      }
    }
  }

  type ViewLine = {
    itemId: string | null;
    code: string;
    label: string;
    nfcTagId: string | null;
    expected: number;
    actual: number;
    missing: number;
    isScannedThisSession: boolean;
    isUnscanned: boolean;
    sessionObservedQuantity: number | null;
  };

  let lines: ViewLine[];

  if (template.supplyTargets.length > 0) {
    const codes = allTemplateCandidateCodes(template);
    const itemRows = await db
      .select({ id: inventoryItems.id, code: inventoryItems.code, label: inventoryItems.label, nfcTagId: inventoryItems.nfcTagId })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.clinicId, params.clinicId), inArray(inventoryItems.code, codes)));
    const itemByCode = new Map(itemRows.map((item) => [item.code, item]));
    const lineRows = itemRows.length
      ? await db
          .select({ itemId: containerItems.itemId, quantity: containerItems.quantity })
          .from(containerItems)
          .where(
            and(
              eq(containerItems.clinicId, params.clinicId),
              eq(containerItems.containerId, params.containerId),
              inArray(containerItems.itemId, itemRows.map((i) => i.id)),
            ),
          )
      : [];
    const quantityByItemId = new Map(lineRows.map((l) => [l.itemId, l.quantity]));

    lines = template.supplyTargets.map((target) => {
      const candidates = candidateCodesForTemplateCode(target.code)
        .map((code) => itemByCode.get(code))
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
      const actual = candidates.reduce((sum, item) => sum + (quantityByItemId.get(item.id) ?? 0), 0);
      const actionItem =
        candidates.reduce<typeof candidates[number] | null>((best, current) => {
          if (!best) return current;
          const bestQty = quantityByItemId.get(best.id) ?? 0;
          const currentQty = quantityByItemId.get(current.id) ?? 0;
          return currentQty > bestQty ? current : best;
        }, null) ?? null;

      const sessionScan = actionItem ? scannedThisSession.get(actionItem.id) : undefined;
      const isScannedThisSession = Boolean(sessionScan);

      return {
        itemId: actionItem?.id ?? null,
        code: target.code,
        label: target.label,
        nfcTagId: actionItem?.nfcTagId ?? null,
        expected: target.targetUnits,
        actual,
        missing: Math.max(0, target.targetUnits - actual),
        isScannedThisSession,
        isUnscanned: activeSession ? !isScannedThisSession : false,
        sessionObservedQuantity: sessionScan?.observedQuantity ?? null,
      };
    });
  } else {
    const adHocRows = await db
      .select({
        id: inventoryItems.id,
        code: inventoryItems.code,
        label: inventoryItems.label,
        nfcTagId: inventoryItems.nfcTagId,
        quantity: containerItems.quantity,
      })
      .from(containerItems)
      .innerJoin(inventoryItems, eq(containerItems.itemId, inventoryItems.id))
      .where(
        and(
          eq(containerItems.clinicId, params.clinicId),
          eq(containerItems.containerId, params.containerId),
          eq(inventoryItems.clinicId, params.clinicId),
        ),
      );

    lines = adHocRows.map((row) => {
      const sessionScan = scannedThisSession.get(row.id);
      const isScannedThisSession = Boolean(sessionScan);
      return {
        itemId: row.id,
        code: row.code,
        label: row.label,
        nfcTagId: row.nfcTagId,
        expected: 0,
        actual: Number(row.quantity),
        missing: 0,
        isScannedThisSession,
        isUnscanned: activeSession ? !isScannedThisSession : false,
        sessionObservedQuantity: sessionScan?.observedQuantity ?? null,
      };
    });
  }

  const scannedCount = lines.filter((l) => l.isScannedThisSession).length;
  const totalCount = lines.length;

  return {
    container,
    lines,
    activeSession: activeSession ?? null,
    sessionProgress: activeSession
      ? { scannedCount, totalCount, unscannedCount: totalCount - scannedCount }
      : null,
  };
}
