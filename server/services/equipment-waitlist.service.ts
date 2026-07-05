import { randomUUID } from "crypto";
import { and, asc, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import {
  db,
  equipment,
  equipmentWaitlist,
  users,
  type EquipmentWaitlistRow,
} from "../db.js";
import type { AuditDbExecutor } from "../lib/audit.js";
import { insertRealtimeDomainEvent } from "../lib/realtime-outbox.js";
import { isEquipmentFullyDeployable } from "./equipment-operational-state.service.js";
import { isPostgresUniqueViolation } from "../lib/pg-result.js";
import { EQUIPMENT_WAITLIST_RESERVATION_TTL_MINUTES } from "../../shared/equipment-waitlist.js";
import type { EquipmentWaitlistSnapshot } from "../../shared/equipment-waitlist.js";

export class EquipmentWaitlistError extends Error {
  constructor(
    readonly code:
      | "WAITLIST_NOT_IN_USE"
      | "WAITLIST_SELF_CHECKOUT"
      | "WAITLIST_ALREADY_JOINED"
      | "WAITLIST_NOT_ON_WAITLIST"
      | "WAITLIST_RESERVATION_HELD_BY_OTHER"
      | "EQUIPMENT_NOT_FOUND",
  ) {
    super(code);
    this.name = "EquipmentWaitlistError";
  }
}

type DbExecutor = AuditDbExecutor | typeof db;

const ACTIVE_STATUSES = ["waiting", "notified"] as const;

export function isWaitlistPromotionEligible(
  row: Pick<typeof equipment.$inferSelect, "checkedOutById" | "custodyState" | "deletedAt">,
): boolean {
  if (row.deletedAt) return false;
  if (row.checkedOutById) return false;
  if (row.custodyState === "checked_out") return false;
  return true;
}

export function isWaitlistJoinEligible(
  row: Pick<typeof equipment.$inferSelect, "checkedOutById" | "custodyState" | "deletedAt">,
  userId: string,
): boolean {
  if (row.deletedAt) return false;
  if (row.custodyState !== "checked_out" || !row.checkedOutById) return false;
  if (row.checkedOutById === userId) return false;
  return true;
}

async function loadEquipment(clinicId: string, equipmentId: string) {
  const [row] = await db
    .select()
    .from(equipment)
    .where(and(eq(equipment.id, equipmentId), eq(equipment.clinicId, clinicId), sql`${equipment.deletedAt} IS NULL`))
    .limit(1);
  return row ?? null;
}

/** Active `waiting` rows (excludes `notified`). Used for holder reminder copy (WTL-UX-02b). */
export async function countEquipmentWaitlistWaiting(
  clinicId: string,
  equipmentId: string,
): Promise<number> {
  return countWaiting(clinicId, equipmentId);
}

async function countWaiting(clinicId: string, equipmentId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(equipmentWaitlist)
    .where(
      and(
        eq(equipmentWaitlist.clinicId, clinicId),
        eq(equipmentWaitlist.equipmentId, equipmentId),
        eq(equipmentWaitlist.status, "waiting"),
      ),
    );
  return Number(row?.count ?? 0);
}

function reservationExpiresAt(now: Date): Date {
  return new Date(now.getTime() + EQUIPMENT_WAITLIST_RESERVATION_TTL_MINUTES * 60 * 1000);
}

export async function buildWaitlistSnapshot(
  clinicId: string,
  equipmentId: string,
  viewerUserId: string,
): Promise<EquipmentWaitlistSnapshot> {
  const rows = await db
    .select({
      id: equipmentWaitlist.id,
      userId: equipmentWaitlist.userId,
      status: equipmentWaitlist.status,
      joinedAt: equipmentWaitlist.joinedAt,
      reservationExpiresAt: equipmentWaitlist.reservationExpiresAt,
      displayName: users.displayName,
      email: users.email,
    })
    .from(equipmentWaitlist)
    .innerJoin(users, and(eq(users.id, equipmentWaitlist.userId), eq(users.clinicId, clinicId)))
    .where(
      and(
        eq(equipmentWaitlist.clinicId, clinicId),
        eq(equipmentWaitlist.equipmentId, equipmentId),
        inArray(equipmentWaitlist.status, [...ACTIVE_STATUSES]),
      ),
    )
    .orderBy(
      sql`CASE WHEN ${equipmentWaitlist.status} = 'notified' THEN 0 ELSE 1 END`,
      desc(equipmentWaitlist.priority),
      asc(equipmentWaitlist.joinedAt),
    );

  const activeRows = rows;
  const waitingOnly = activeRows.filter((r) => r.status === "waiting");
  const notified = activeRows.find((r) => r.status === "notified");

  let position = 0;
  const entries = activeRows.map((r) => {
    const entryStatus = r.status === "notified" ? "notified" as const : "waiting" as const;
    const pos = entryStatus === "waiting" ? ++position : 0;
    return {
      position: entryStatus === "notified" ? 0 : pos,
      userId: r.userId,
      displayName: r.displayName?.trim() || r.email,
      status: entryStatus,
      joinedAt: r.joinedAt.toISOString(),
      reservationExpiresAt: r.reservationExpiresAt?.toISOString() ?? null,
    };
  });

  const myRow = activeRows.find((r) => r.userId === viewerUserId);
  let myPosition: number | null = null;
  if (myRow?.status === "waiting") {
    myPosition = waitingOnly.findIndex((r) => r.userId === viewerUserId) + 1;
    if (myPosition === 0) myPosition = null;
  } else if (myRow?.status === "notified") {
    myPosition = 1;
  }

  return {
    equipmentId,
    queueSize: waitingOnly.length,
    myPosition,
    myStatus: (myRow?.status as EquipmentWaitlistSnapshot["myStatus"]) ?? null,
    reservationExpiresAt:
      myRow?.status === "notified" ? myRow.reservationExpiresAt?.toISOString() ?? null : null,
    notifiedUserId: notified?.userId ?? null,
    entries,
  };
}

export async function joinEquipmentWaitlist(
  clinicId: string,
  equipmentId: string,
  userId: string,
): Promise<EquipmentWaitlistSnapshot> {
  const eqRow = await loadEquipment(clinicId, equipmentId);
  if (!eqRow) throw new EquipmentWaitlistError("EQUIPMENT_NOT_FOUND");
  if (!isWaitlistJoinEligible(eqRow, userId)) {
    if (eqRow.checkedOutById === userId) throw new EquipmentWaitlistError("WAITLIST_SELF_CHECKOUT");
    throw new EquipmentWaitlistError("WAITLIST_NOT_IN_USE");
  }

  const now = new Date();
  const id = randomUUID();

  try {
    await db.transaction(async (tx) => {
      const [eqInTx] = await tx
        .select()
        .from(equipment)
        .where(
          and(
            eq(equipment.id, equipmentId),
            eq(equipment.clinicId, clinicId),
            sql`${equipment.deletedAt} IS NULL`,
          ),
        )
        .limit(1);

      if (!eqInTx) throw new EquipmentWaitlistError("EQUIPMENT_NOT_FOUND");
      if (!isWaitlistJoinEligible(eqInTx, userId)) {
        if (eqInTx.checkedOutById === userId) throw new EquipmentWaitlistError("WAITLIST_SELF_CHECKOUT");
        throw new EquipmentWaitlistError("WAITLIST_NOT_IN_USE");
      }

      await tx.insert(equipmentWaitlist).values({
        id,
        clinicId,
        equipmentId,
        userId,
        joinedAt: now,
        status: "waiting",
        createdAt: now,
        updatedAt: now,
      });

      const queueSize = await countWaitingInTx(tx, clinicId, equipmentId);
      const position = queueSize;

      await insertRealtimeDomainEvent(tx, {
        clinicId,
        type: "EQUIPMENT_WAITLIST_JOINED",
        payload: { equipmentId, userId, queueSize, position },
        category: "SYSTEM",
      });
    });
  } catch (err: unknown) {
    if (err instanceof EquipmentWaitlistError) throw err;
    if (isPostgresUniqueViolation(err)) throw new EquipmentWaitlistError("WAITLIST_ALREADY_JOINED");
    throw err;
  }

  return buildWaitlistSnapshot(clinicId, equipmentId, userId);
}

async function countWaitingInTx(tx: DbExecutor, clinicId: string, equipmentId: string) {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(equipmentWaitlist)
    .where(
      and(
        eq(equipmentWaitlist.clinicId, clinicId),
        eq(equipmentWaitlist.equipmentId, equipmentId),
        eq(equipmentWaitlist.status, "waiting"),
      ),
    );
  return Number(row?.count ?? 0);
}

export async function leaveEquipmentWaitlist(
  clinicId: string,
  equipmentId: string,
  userId: string,
): Promise<EquipmentWaitlistSnapshot> {
  const now = new Date();
  const updated = await db
    .update(equipmentWaitlist)
    .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
    .where(
      and(
        eq(equipmentWaitlist.clinicId, clinicId),
        eq(equipmentWaitlist.equipmentId, equipmentId),
        eq(equipmentWaitlist.userId, userId),
        inArray(equipmentWaitlist.status, [...ACTIVE_STATUSES]),
      ),
    )
    .returning({ id: equipmentWaitlist.id });

  if (updated.length === 0) throw new EquipmentWaitlistError("WAITLIST_NOT_ON_WAITLIST");

  const queueSize = await countWaiting(clinicId, equipmentId);
  await db.transaction(async (tx) => {
    await insertRealtimeDomainEvent(tx, {
      clinicId,
      type: "EQUIPMENT_WAITLIST_LEFT",
      payload: { equipmentId, userId, queueSize },
      category: "SYSTEM",
    });
  });

  return buildWaitlistSnapshot(clinicId, equipmentId, userId);
}

export async function findNextWaitingClaim(
  clinicId: string,
  equipmentId: string,
): Promise<EquipmentWaitlistRow | null> {
  const [row] = await db
    .select()
    .from(equipmentWaitlist)
    .where(
      and(
        eq(equipmentWaitlist.clinicId, clinicId),
        eq(equipmentWaitlist.equipmentId, equipmentId),
        eq(equipmentWaitlist.status, "waiting"),
      ),
    )
    .orderBy(desc(equipmentWaitlist.priority), asc(equipmentWaitlist.joinedAt))
    .limit(1);
  return row ?? null;
}

export async function hasNotifiedHolder(clinicId: string, equipmentId: string): Promise<boolean> {
  const holder = await getActiveNotifiedUserId(clinicId, equipmentId);
  return holder !== null;
}

export async function getActiveNotifiedUserId(
  clinicId: string,
  equipmentId: string,
  executor: DbExecutor = db,
): Promise<string | null> {
  const [row] = await executor
    .select({ userId: equipmentWaitlist.userId })
    .from(equipmentWaitlist)
    .where(
      and(
        eq(equipmentWaitlist.clinicId, clinicId),
        eq(equipmentWaitlist.equipmentId, equipmentId),
        eq(equipmentWaitlist.status, "notified"),
      ),
    )
    .limit(1);
  return row?.userId ?? null;
}

/** Blocks checkout while another user holds an active reservation (emergency checkout exempt). */
export function assertCheckoutAllowedForWaitlist(
  notifiedUserId: string | null,
  checkoutUserId: string,
  options: { isEmergency: boolean },
): void {
  if (options.isEmergency) return;
  if (notifiedUserId && notifiedUserId !== checkoutUserId) {
    throw new EquipmentWaitlistError("WAITLIST_RESERVATION_HELD_BY_OTHER");
  }
}

/** Promote head waiter inside an open transaction; returns promoted row or null. */
export async function promoteNextWaitlistInTx(
  tx: DbExecutor,
  clinicId: string,
  equipmentId: string,
  now: Date,
): Promise<EquipmentWaitlistRow | null> {
  const existingNotified = await tx
    .select({ id: equipmentWaitlist.id })
    .from(equipmentWaitlist)
    .where(
      and(
        eq(equipmentWaitlist.clinicId, clinicId),
        eq(equipmentWaitlist.equipmentId, equipmentId),
        eq(equipmentWaitlist.status, "notified"),
      ),
    )
    .limit(1);
  if (existingNotified.length > 0) return null;

  const [next] = await tx
    .select()
    .from(equipmentWaitlist)
    .where(
      and(
        eq(equipmentWaitlist.clinicId, clinicId),
        eq(equipmentWaitlist.equipmentId, equipmentId),
        eq(equipmentWaitlist.status, "waiting"),
      ),
    )
    .orderBy(desc(equipmentWaitlist.priority), asc(equipmentWaitlist.joinedAt))
    .limit(1);
  if (!next) return null;

  const expiresAt = reservationExpiresAt(now);
  const [promoted] = await tx
    .update(equipmentWaitlist)
    .set({
      status: "notified",
      notifiedAt: now,
      reservationExpiresAt: expiresAt,
      updatedAt: now,
    })
    .where(
      and(
        eq(equipmentWaitlist.id, next.id),
        eq(equipmentWaitlist.clinicId, clinicId),
        eq(equipmentWaitlist.status, "waiting"),
      ),
    )
    .returning();

  if (!promoted) return null;

  await insertRealtimeDomainEvent(tx, {
    clinicId,
    type: "EQUIPMENT_WAITLIST_PROMOTED",
    payload: {
      equipmentId,
      userId: promoted.userId,
      waitlistId: promoted.id,
      reservationExpiresAt: expiresAt.toISOString(),
      position: 1,
    },
    category: "SYSTEM",
    level: "INFO",
  });

  return promoted;
}

export async function promoteEquipmentWaitlistIfEligible(
  clinicId: string,
  equipmentId: string,
  _trigger: "return" | "dock_return" | "ttl_expiry",
): Promise<EquipmentWaitlistRow | null> {
  const eqRow = await loadEquipment(clinicId, equipmentId);
  if (!eqRow || !isWaitlistPromotionEligible(eqRow)) return null;
  // Asset-typed units are only checkout-able when fully deployable (docked +
  // ready + available); promoting earlier hands out a reservation the holder
  // cannot redeem while its TTL burns down.
  if (
    eqRow.assetTypeId &&
    !isEquipmentFullyDeployable(eqRow.custodyState, eqRow.readinessState, eqRow.usageState)
  ) {
    return null;
  }

  const now = new Date();
  let promoted: EquipmentWaitlistRow | null = null;

  await db.transaction(async (tx) => {
    promoted = await promoteNextWaitlistInTx(tx, clinicId, equipmentId, now);
  });

  return promoted;
}

export async function fulfillWaitlistOnCheckout(
  tx: DbExecutor,
  clinicId: string,
  equipmentId: string,
  userId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(equipmentWaitlist)
    .set({ status: "fulfilled", fulfilledAt: now, updatedAt: now })
    .where(
      and(
        eq(equipmentWaitlist.clinicId, clinicId),
        eq(equipmentWaitlist.equipmentId, equipmentId),
        eq(equipmentWaitlist.userId, userId),
        inArray(equipmentWaitlist.status, [...ACTIVE_STATUSES]),
      ),
    );
}

export type ExpiredWaitlistRow = {
  id: string;
  clinicId: string;
  equipmentId: string;
  userId: string;
};

export async function expireNotifiedReservations(now: Date = new Date()): Promise<ExpiredWaitlistRow[]> {
  const expiredRows = await db
    .update(equipmentWaitlist)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(equipmentWaitlist.status, "notified"),
        isNotNull(equipmentWaitlist.reservationExpiresAt),
        lt(equipmentWaitlist.reservationExpiresAt, now),
      ),
    )
    .returning({
      id: equipmentWaitlist.id,
      clinicId: equipmentWaitlist.clinicId,
      equipmentId: equipmentWaitlist.equipmentId,
      userId: equipmentWaitlist.userId,
    });

  for (const row of expiredRows) {
    await db.transaction(async (tx) => {
      await insertRealtimeDomainEvent(tx, {
        clinicId: row.clinicId,
        type: "EQUIPMENT_WAITLIST_EXPIRED",
        payload: { equipmentId: row.equipmentId, userId: row.userId, waitlistId: row.id },
        category: "SYSTEM",
      });
    });
  }

  return expiredRows;
}

