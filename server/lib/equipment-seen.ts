import { createHash, randomUUID } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  animals,
  billingItems,
  billingLedger,
  db,
  equipment,
  patientRoomAssignments,
  usageSessions,
} from "../db.js";
import type { BillingPackageCode, ExpandedPackageItem } from "../config/billingPackages.js";
import { expandPackage } from "../config/billingPackages.js";
import { checkIdempotentAsync, markIdempotentAsync } from "./idempotency.js";

/** Transaction client from `db.transaction` — schema-typed via drizzle inference at call site. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbTx = any;

/** Hour bucket in Asia/Jerusalem for idempotency (one charge per animal+item per hour). */
export function jerusalemHourBucket(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  return `${y}-${m}-${day}T${h}`;
}

export function buildSeenIdempotencyKey(animalId: string, itemId: string, at: Date): string {
  const bucket = jerusalemHourBucket(at);
  const raw = `${animalId}|${itemId}|${bucket}`;
  return createHash("sha256").update(raw).digest("hex");
}

const DEFAULT_EQUIPMENT_BILLING_CODE = "DEFAULT_EQUIPMENT";

export async function getOrCreateDefaultEquipmentBillingItem(
  tx: DbTx,
  clinicId: string,
): Promise<{ id: string; unitPriceCents: number }> {
  const [existing] = await tx
    .select({ id: billingItems.id, unitPriceCents: billingItems.unitPriceCents })
    .from(billingItems)
    .where(and(eq(billingItems.clinicId, clinicId), eq(billingItems.code, DEFAULT_EQUIPMENT_BILLING_CODE)))
    .limit(1);
  if (existing) return existing;
  const id = randomUUID();
  await tx.insert(billingItems).values({
    id,
    clinicId,
    code: DEFAULT_EQUIPMENT_BILLING_CODE,
    description: "Default equipment usage",
    unitPriceCents: 100,
    chargeKind: "per_unit",
  });
  return { id, unitPriceCents: 100 };
}

export async function resolveBillingItemForEquipment(
  tx: DbTx,
  clinicId: string,
  row: typeof equipment.$inferSelect,
): Promise<{ id: string; unitPriceCents: number }> {
  if (row.billingItemId) {
    const [bi] = await tx
      .select({ id: billingItems.id, unitPriceCents: billingItems.unitPriceCents })
      .from(billingItems)
      .where(and(eq(billingItems.id, row.billingItemId), eq(billingItems.clinicId, clinicId)))
      .limit(1);
    if (bi) return bi;
  }
  return getOrCreateDefaultEquipmentBillingItem(tx, clinicId);
}

export async function findActiveAnimalInRoom(
  tx: DbTx,
  clinicId: string,
  roomId: string,
): Promise<{ id: string; name: string } | null> {
  const [row] = await tx
    .select({ id: animals.id, name: animals.name })
    .from(patientRoomAssignments)
    .innerJoin(animals, eq(patientRoomAssignments.animalId, animals.id))
    .where(
      and(
        eq(patientRoomAssignments.clinicId, clinicId),
        eq(patientRoomAssignments.roomId, roomId),
        isNull(patientRoomAssignments.endedAt),
        eq(animals.clinicId, clinicId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function getOrCreateBillingItemByCode(
  tx: DbTx,
  clinicId: string,
  code: string,
): Promise<{ id: string; unitPriceCents: number }> {
  const [existing] = await tx
    .select({ id: billingItems.id, unitPriceCents: billingItems.unitPriceCents })
    .from(billingItems)
    .where(and(eq(billingItems.clinicId, clinicId), eq(billingItems.code, code)))
    .limit(1);
  if (existing) return existing;

  const id = randomUUID();
  await tx.insert(billingItems).values({
    id,
    clinicId,
    code,
    description: code.replace(/_/g, " ").toLowerCase(),
    unitPriceCents: 0,
    chargeKind: "per_unit",
  });
  return { id, unitPriceCents: 0 };
}

function packageItemIdempotencyKey(base: string, item: ExpandedPackageItem): string {
  return createHash("sha256").update(`${base}|pkg|${item.itemCode}`).digest("hex");
}

export type SeenResult =
  | {
      ok: true;
      linked: true;
      animal: { id: string; name: string };
      roomId: string;
      usageSessionId: string;
      ledgerId: string;
      packageLedgerIds?: string[];
      idempotentReplay?: boolean;
    }
  | { ok: true; linked: false; reason: "no_room" | "no_patient_in_room"; roomId: string | null }
  | { ok: false; error: "NOT_FOUND" };

export async function processEquipmentSeenInTx(params: {
  tx: DbTx;
  clinicId: string;
  equipmentId: string;
  bodyRoomId: string | null | undefined;
  packageCode?: BillingPackageCode | null;
  now: Date;
  /** Optional: scanLogId from the checkout scan that triggered this seen event. */
  scanLogId?: string | null;
}): Promise<SeenResult> {
  const { tx, clinicId, equipmentId, bodyRoomId, packageCode, now, scanLogId = null } = params;

  const [eqRow] = await tx
    .select()
    .from(equipment)
    .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, equipmentId), isNull(equipment.deletedAt)))
    .limit(1);

  if (!eqRow) return { ok: false, error: "NOT_FOUND" };

  const roomId = bodyRoomId?.trim() || eqRow.roomId || null;
  if (!roomId) {
    return { ok: true, linked: false, reason: "no_room", roomId: null };
  }

  const animal = await findActiveAnimalInRoom(tx, clinicId, roomId);
  if (!animal) {
    return { ok: true, linked: false, reason: "no_patient_in_room", roomId };
  }

  const billing = await resolveBillingItemForEquipment(tx, clinicId, eqRow);
  const idempotencyKey = buildSeenIdempotencyKey(animal.id, equipmentId, now);
  const redisSeenKey = `equipment-seen:${clinicId}:${idempotencyKey}`;

  const [existingLedger] = await tx
    .select({ id: billingLedger.id })
    .from(billingLedger)
    .where(and(eq(billingLedger.clinicId, clinicId), eq(billingLedger.idempotencyKey, idempotencyKey)))
    .limit(1);

  if (existingLedger) {
    await tx
      .update(equipment)
      .set({ lastSeen: now })
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, equipmentId)));
    const [openSession] = await tx
      .select({ id: usageSessions.id })
      .from(usageSessions)
      .where(
        and(
          eq(usageSessions.clinicId, clinicId),
          eq(usageSessions.animalId, animal.id),
          eq(usageSessions.equipmentId, equipmentId),
          eq(usageSessions.status, "open"),
        ),
      )
      .limit(1);
    return {
      ok: true,
      linked: true,
      animal,
      roomId,
      usageSessionId: openSession?.id ?? existingLedger.id,
      ledgerId: existingLedger.id,
      idempotentReplay: true,
    };
  }

  // Create/get usage session BEFORE billing insert so we can link usageSessionId on the ledger row.
  let usageSessionId: string;
  const [open] = await tx
    .select({ id: usageSessions.id })
    .from(usageSessions)
    .where(
      and(
        eq(usageSessions.clinicId, clinicId),
        eq(usageSessions.animalId, animal.id),
        eq(usageSessions.equipmentId, equipmentId),
        eq(usageSessions.status, "open"),
      ),
    )
    .limit(1);

  if (open) {
    usageSessionId = open.id;
    await tx
      .update(usageSessions)
      .set({ lastBilledThrough: now })
      .where(eq(usageSessions.id, open.id));
  } else {
    usageSessionId = randomUUID();
    await tx.insert(usageSessions).values({
      id: usageSessionId,
      clinicId,
      animalId: animal.id,
      equipmentId,
      billingItemId: billing.id,
      startedAt: now,
      endedAt: null,
      lastBilledThrough: now,
      status: "open",
    });
  }

  const ledgerId = randomUUID();
  const qty = 1;
  const totalCents = billing.unitPriceCents * qty;

  await tx.insert(billingLedger).values({
    id: ledgerId,
    clinicId,
    animalId: animal.id,
    itemType: "EQUIPMENT",
    itemId: equipmentId,
    quantity: qty,
    unitPriceCents: billing.unitPriceCents,
    totalAmountCents: totalCents,
    idempotencyKey,
    status: "pending",
    scanLogId: scanLogId ?? null,
    usageSessionId,
  });
  await markIdempotentAsync(redisSeenKey);

  const packageLedgerIds: string[] = [];
  if (packageCode) {
    const [animalRow] = await tx
      .select({ weightKg: animals.weightKg })
      .from(animals)
      .where(and(eq(animals.clinicId, clinicId), eq(animals.id, animal.id)))
      .limit(1);
    const animalWeightKg =
      animalRow?.weightKg == null ? null : Number.parseFloat(String(animalRow.weightKg));

    const expanded = expandPackage(packageCode, Number.isFinite(animalWeightKg) ? animalWeightKg : null);
    for (const item of expanded) {
      const itemIdempotencyKey = packageItemIdempotencyKey(idempotencyKey, item);
      const redisPackageKey = `equipment-seen-package:${clinicId}:${itemIdempotencyKey}`;
      const packageAlreadyProcessed = await checkIdempotentAsync(redisPackageKey);
      const [existingPackageLedger] = await tx
        .select({ id: billingLedger.id })
        .from(billingLedger)
        .where(and(eq(billingLedger.clinicId, clinicId), eq(billingLedger.idempotencyKey, itemIdempotencyKey)))
        .limit(1);

      if (existingPackageLedger || packageAlreadyProcessed) {
        if (existingPackageLedger) packageLedgerIds.push(existingPackageLedger.id);
        continue;
      }

      const pkgBilling = await getOrCreateBillingItemByCode(tx, clinicId, item.itemCode);
      const pkgLedgerId = randomUUID();
      await tx.insert(billingLedger).values({
        id: pkgLedgerId,
        clinicId,
        animalId: animal.id,
        itemType: "CONSUMABLE",
        itemId: pkgBilling.id,
        quantity: item.quantity,
        unitPriceCents: pkgBilling.unitPriceCents,
        totalAmountCents: pkgBilling.unitPriceCents * item.quantity,
        idempotencyKey: itemIdempotencyKey,
        status: "pending",
        usageSessionId,
      });
      await markIdempotentAsync(redisPackageKey);
      packageLedgerIds.push(pkgLedgerId);
    }
  }

  await tx
    .update(equipment)
    .set({ lastSeen: now })
    .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, equipmentId)));

  return {
    ok: true,
    linked: true,
    animal,
    roomId,
    usageSessionId,
    ledgerId,
    packageLedgerIds,
  };
}

/** HTTP handler: runs billing/usage logic in a single DB transaction. */
export async function recordEquipmentSeen(params: {
  clinicId: string;
  equipmentId: string;
  roomId: string | null | undefined;
  packageCode?: BillingPackageCode | null;
  /** Optional: scanLogId from the checkout scan that triggered this seen event, for billing traceability. */
  scanLogId?: string | null;
}): Promise<SeenResult> {
  const now = new Date();
  return db.transaction(async (tx) =>
    processEquipmentSeenInTx({
      tx,
      clinicId: params.clinicId,
      equipmentId: params.equipmentId,
      bodyRoomId: params.roomId,
      packageCode: params.packageCode ?? null,
      now,
      scanLogId: params.scanLogId ?? null,
    }),
  );
}
