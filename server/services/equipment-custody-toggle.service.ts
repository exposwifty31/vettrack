import { randomUUID } from "crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  equipment,
  equipmentReturns,
  scanLogs,
  stagingQueue,
  assetTypeConditions,
  unitConditionStates,
  type EquipmentWaitlistRow,
} from "../db.js";
import { insertRealtimeDomainEvent } from "../lib/realtime-outbox.js";
import { computeBundleReadinessGate } from "./equipment-operational-state.service.js";
import { recordOperationalMetric } from "./operational-metrics.service.js";
import {
  fulfillWaitlistOnCheckout,
  getActiveNotifiedUserId,
  promoteNextWaitlistInTx,
  EquipmentWaitlistError,
} from "./equipment-waitlist.service.js";
import { promoteStagingQueueNext } from "../lib/staging-promotion.js";
import { notifyWaitlistPromoted } from "../lib/equipment-waitlist-promotion.js";
import { logAudit } from "../lib/audit.js";
import { invalidateAnalyticsCache } from "../lib/analytics-cache.js";
import { trackSyncSuccess } from "../lib/sync-metrics.js";
import { scheduleSmartReturnReminder, cancelSmartReturnReminder } from "../lib/role-notification-scheduler.js";
import { checkDedupe, sendPushToAll, shouldSendPilotEnglishEquipmentPush } from "../lib/push.js";
import { enqueueChargeAlertJob } from "../jobs/charge-alert-enqueue.js";
import {
  insertEquipmentUndoToken,
  snapshotEquipmentState,
} from "../routes/equipment/equipment-undo-tokens.js";

type EquipmentRow = typeof equipment.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const PLUG_IN_DEADLINE_DEFAULT_MINUTES = 30;

export type CustodyActor = {
  id: string;
  email: string;
};

export class CheckoutConflictError extends Error {
  checkedOutByEmail: string;
  constructor(email: string) {
    super("CHECKOUT_CONFLICT");
    this.checkedOutByEmail = email;
  }
}

export class CheckoutPreconditionError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly extra?: Record<string, unknown>;

  constructor(code: string, httpStatus: number, extra?: Record<string, unknown>) {
    super(code);
    this.code = code;
    this.httpStatus = httpStatus;
    this.extra = extra;
  }
}

export class CustodyReturnVersionConflictError extends Error {
  constructor() {
    super("CUSTODY_RETURN_VERSION_CONFLICT");
  }
}

export type CheckoutPreCheckResult = {
  v1StageClaimId: string | null;
  v1NewUsageState: "in_use" | "emergency_use";
};

export type PerformEquipmentCheckoutParams = {
  clinicId: string;
  equipmentId: string;
  actor: CustodyActor;
  location?: string | null;
  clientTimestamp?: number;
  v1StageClaimId?: string | null;
  v1NewUsageState?: "in_use" | "emergency_use";
};

export type EquipmentCheckoutTxResult = {
  updated: EquipmentRow;
  undoToken: string;
  scanLogId: string;
  reminderBaseTime: Date;
};

export type PerformEquipmentReturnParams = {
  clinicId: string;
  equipmentId: string;
  actor: CustodyActor;
  clientTimestamp?: number;
};

export type EquipmentReturnTxResult = {
  updated: EquipmentRow;
  undoToken: string;
  scanLogId: string;
  alreadyReturned: boolean;
  didTransitionCustody: boolean;
  waitlistPromotedOnReturn: EquipmentWaitlistRow | null;
};

export type ToggleEquipmentCustodyParams = {
  clinicId: string;
  equipmentId: string;
  actor: CustodyActor;
  isPluggedIn?: boolean;
  actorRole?: string;
};

export type ToggleEquipmentCustodyResult =
  | { kind: "not_found" }
  | {
      kind: "blocked";
      equipment: EquipmentRow;
      checkedOutByEmail?: string;
    }
  | {
      kind: "checkout";
      equipment: EquipmentRow;
      undoToken: string;
      scanLogId: string;
    }
  | {
      kind: "return";
      equipment: EquipmentRow;
      undoToken: string;
      scanLogId: string;
    };

export async function evaluateCheckoutV1Preconditions(
  clinicId: string,
  equipmentId: string,
  actorId: string,
  snap: EquipmentRow,
): Promise<CheckoutPreCheckResult> {
  if (snap.custodyState === "untracked") {
    void recordOperationalMetric({
      clinicId,
      equipmentId: snap.id,
      userId: actorId,
      eventType: "custody_chain_broken",
    });
    throw new CheckoutPreconditionError("CUSTODY_CHAIN_BROKEN", 422);
  }

  if (snap.custodyState === "checked_out") {
    throw new CheckoutPreconditionError("ALREADY_CHECKED_OUT", 409);
  }

  let v1StageClaimId: string | null = null;
  const v1NewUsageState: "in_use" | "emergency_use" = "in_use";

  if (snap.usageState === "staged") {
    const claims = await db
      .select()
      .from(stagingQueue)
      .where(
        and(
          eq(stagingQueue.equipmentId, snap.id),
          eq(stagingQueue.clinicId, clinicId),
          eq(stagingQueue.status, "active"),
        ),
      )
      .orderBy(
        sql`CASE ${stagingQueue.clinicalPriority} WHEN 'emergency' THEN 3 WHEN 'urgent' THEN 2 WHEN 'routine' THEN 1 ELSE 0 END DESC`,
        stagingQueue.stagedAt,
      );

    const topClaim = claims[0];
    if (!topClaim || topClaim.requestedById !== actorId) {
      throw new CheckoutPreconditionError("STAGING_CONFLICT", 409, { queue: claims });
    }

    const [allConditions, condStates] = snap.assetTypeId
      ? await Promise.all([
          db.select().from(assetTypeConditions).where(eq(assetTypeConditions.assetTypeId, snap.assetTypeId)),
          db.select().from(unitConditionStates).where(eq(unitConditionStates.equipmentId, snap.id)),
        ])
      : [[], []];
    const gateResult = computeBundleReadinessGate(snap, condStates, allConditions, new Date());
    if (!gateResult.ok) {
      void recordOperationalMetric({
        clinicId,
        equipmentId: snap.id,
        userId: actorId,
        eventType: "bundle_failed",
        metadata: {
          reason: gateResult.reason,
          failedConditions: gateResult.failedConditions,
          staleConditions: gateResult.staleConditions,
          unknownConditions: gateResult.unknownConditions,
        },
      });
      throw new CheckoutPreconditionError("BUNDLE_INCOMPLETE", 422, gateResult);
    }

    v1StageClaimId = topClaim.id;
  } else if (snap.usageState === "available") {
    if (snap.assetTypeId) {
      const [allConditions, condStates] = await Promise.all([
        db.select().from(assetTypeConditions).where(eq(assetTypeConditions.assetTypeId, snap.assetTypeId)),
        db.select().from(unitConditionStates).where(eq(unitConditionStates.equipmentId, snap.id)),
      ]);
      const gateResult = computeBundleReadinessGate(snap, condStates, allConditions, new Date());
      if (!gateResult.ok) {
        void recordOperationalMetric({
          clinicId,
          equipmentId: snap.id,
          userId: actorId,
          eventType: "bundle_failed",
          metadata: {
            reason: gateResult.reason,
            failedConditions: gateResult.failedConditions,
            staleConditions: gateResult.staleConditions,
            unknownConditions: gateResult.unknownConditions,
          },
        });
        throw new CheckoutPreconditionError("BUNDLE_INCOMPLETE", 422, gateResult);
      }
    } else if (!["returned", "docked"].includes(snap.custodyState)) {
      throw new CheckoutPreconditionError("EQUIPMENT_UNAVAILABLE", 422, {
        error: `Equipment custody state ${snap.custodyState} blocks checkout`,
      });
    }
  } else {
    throw new CheckoutPreconditionError("EQUIPMENT_UNAVAILABLE", 422, {
      error: `Equipment usage state ${snap.usageState} blocks checkout`,
    });
  }

  return { v1StageClaimId, v1NewUsageState };
}

export async function assertWaitlistCheckoutAllowed(
  clinicId: string,
  equipmentId: string,
  actorId: string,
): Promise<void> {
  const preCheckoutNotifiedUserId = await getActiveNotifiedUserId(clinicId, equipmentId);
  if (preCheckoutNotifiedUserId && preCheckoutNotifiedUserId !== actorId) {
    throw new EquipmentWaitlistError("WAITLIST_RESERVATION_HELD_BY_OTHER");
  }
}

export async function performEquipmentCheckout(
  tx: Tx,
  params: PerformEquipmentCheckoutParams,
): Promise<EquipmentCheckoutTxResult | null> {
  const {
    clinicId,
    equipmentId,
    actor,
    location,
    clientTimestamp = 0,
    v1StageClaimId = null,
    v1NewUsageState = "in_use",
  } = params;

  const [existing] = await tx
    .select()
    .from(equipment)
    .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, equipmentId), isNull(equipment.deletedAt)))
    .limit(1);

  if (!existing) return null;

  const checkoutTime = clientTimestamp ? new Date(clientTimestamp) : new Date();

  const checkoutSet = {
    checkedOutById: actor.id,
    checkedOutByEmail: actor.email,
    checkedOutAt: checkoutTime,
    checkedOutLocation: location ?? null,
    lastSeen: checkoutTime,
    lastStatus: existing.status,
    custodyState: "checked_out" as const,
    custodyStateSince: checkoutTime,
    usageState: v1NewUsageState,
    usageStateSince: checkoutTime,
    version: sql`${equipment.version} + 1`,
  };

  let updatedRow: EquipmentRow | undefined;

  if (!existing.checkedOutById) {
    [updatedRow] = await tx
      .update(equipment)
      .set(checkoutSet)
      .where(
        and(
          eq(equipment.clinicId, clinicId),
          eq(equipment.id, equipmentId),
          isNull(equipment.checkedOutById),
        ),
      )
      .returning();

    if (!updatedRow) {
      const [winner] = await tx
        .select()
        .from(equipment)
        .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, equipmentId)))
        .limit(1);
      throw new CheckoutConflictError(winner?.checkedOutByEmail ?? "unknown");
    }
  } else {
    const existingTimestamp = existing.checkedOutAt ? new Date(existing.checkedOutAt).getTime() : 0;
    if (!clientTimestamp || clientTimestamp <= existingTimestamp) {
      throw new CheckoutConflictError(existing.checkedOutByEmail ?? "unknown");
    }

    const overrideWhere =
      existing.checkedOutAt == null
        ? and(
            eq(equipment.clinicId, clinicId),
            eq(equipment.id, equipmentId),
            isNull(equipment.checkedOutAt),
          )
        : and(
            eq(equipment.clinicId, clinicId),
            eq(equipment.id, equipmentId),
            eq(equipment.checkedOutAt, existing.checkedOutAt),
          );

    [updatedRow] = await tx
      .update(equipment)
      .set(checkoutSet)
      .where(overrideWhere)
      .returning();

    if (!updatedRow) {
      throw new CheckoutConflictError(existing.checkedOutByEmail ?? "unknown");
    }
  }

  const checkoutLogId = randomUUID();

  await tx.insert(scanLogs).values({
    id: checkoutLogId,
    clinicId,
    equipmentId,
    userId: actor.id,
    userEmail: actor.email,
    status: existing.status,
    note: `Checked out${location ? ` — ${location}` : ""}`,
    timestamp: checkoutTime,
  });

  const undoToken = await insertEquipmentUndoToken(tx, {
    clinicId,
    equipmentId,
    actorId: actor.id,
    scanLogId: checkoutLogId,
    previousState: snapshotEquipmentState(existing),
  });

  if (v1StageClaimId) {
    await tx
      .update(stagingQueue)
      .set({ status: "fulfilled", updatedAt: checkoutTime })
      .where(and(eq(stagingQueue.id, v1StageClaimId), eq(stagingQueue.equipmentId, equipmentId)));
  }

  await fulfillWaitlistOnCheckout(tx, clinicId, equipmentId, actor.id, checkoutTime);

  await insertRealtimeDomainEvent(tx, {
    clinicId,
    type: "EQUIPMENT_CUSTODY_STATE_CHANGED",
    payload: { equipmentId, custodyState: "checked_out", usageState: v1NewUsageState },
  });

  return {
    updated: updatedRow,
    undoToken,
    scanLogId: checkoutLogId,
    reminderBaseTime: checkoutTime,
  };
}

export async function performEquipmentReturn(
  tx: Tx,
  params: PerformEquipmentReturnParams,
): Promise<EquipmentReturnTxResult | null> {
  const { clinicId, equipmentId, actor, clientTimestamp = 0 } = params;

  const [existing] = await tx
    .select()
    .from(equipment)
    .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, equipmentId), isNull(equipment.deletedAt)))
    .limit(1);

  if (!existing) return null;

  if (!existing.checkedOutById) {
    const existingTimestamp = existing.lastSeen ? new Date(existing.lastSeen).getTime() : 0;
    if (clientTimestamp && clientTimestamp <= existingTimestamp) {
      return {
        updated: existing,
        undoToken: "",
        scanLogId: "",
        alreadyReturned: true,
        didTransitionCustody: false,
        waitlistPromotedOnReturn: null,
      };
    }
  }

  const returnTime = clientTimestamp ? new Date(clientTimestamp) : new Date();
  const transitionCustody = existing.custodyState === "checked_out";

  let hasActiveClaims = false;
  if (transitionCustody) {
    const [activeClaims] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(stagingQueue)
      .where(
        and(
          eq(stagingQueue.equipmentId, equipmentId),
          eq(stagingQueue.clinicId, clinicId),
          eq(stagingQueue.status, "active"),
        ),
      );
    hasActiveClaims = Number(activeClaims?.count ?? 0) > 0;
  }

  const returnSet = {
    checkedOutById: null,
    checkedOutByEmail: null,
    checkedOutAt: null,
    checkedOutLocation: null,
    status: "ok" as const,
    lastSeen: returnTime,
    lastStatus: "ok" as const,
    ...(transitionCustody
      ? {
          custodyState: "returned" as const,
          custodyStateSince: returnTime,
          readinessState: "unknown" as const,
          readinessStateSince: returnTime,
          usageState: hasActiveClaims ? ("staged" as const) : ("available" as const),
          usageStateSince: returnTime,
          version: sql`${equipment.version} + 1`,
        }
      : {}),
  };

  const returnWhere = transitionCustody
    ? and(
        eq(equipment.clinicId, clinicId),
        eq(equipment.id, equipmentId),
        eq(equipment.custodyState, "checked_out"),
        eq(equipment.version, existing.version),
      )
    : and(
        eq(equipment.clinicId, clinicId),
        eq(equipment.id, equipmentId),
        eq(equipment.version, existing.version),
      );

  const [updatedRow] = await tx
    .update(equipment)
    .set(returnSet)
    .where(returnWhere)
    .returning();

  if (!updatedRow) {
    throw new CustodyReturnVersionConflictError();
  }

  const returnLogId = randomUUID();

  await tx.insert(scanLogs).values({
    id: returnLogId,
    clinicId,
    equipmentId,
    userId: actor.id,
    userEmail: actor.email,
    status: "ok",
    note: "Returned — available",
    timestamp: returnTime,
  });

  const undoToken = await insertEquipmentUndoToken(tx, {
    clinicId,
    equipmentId,
    actorId: actor.id,
    scanLogId: returnLogId,
    previousState: snapshotEquipmentState(existing),
  });

  let waitlistPromotedOnReturn: EquipmentWaitlistRow | null = null;
  if (transitionCustody) {
    await insertRealtimeDomainEvent(tx, {
      clinicId,
      type: "EQUIPMENT_CUSTODY_STATE_CHANGED",
      payload: { equipmentId, custodyState: "returned", hasActiveClaims },
    });
    waitlistPromotedOnReturn = await promoteNextWaitlistInTx(tx, clinicId, equipmentId, returnTime);
  }

  return {
    updated: updatedRow,
    undoToken,
    scanLogId: returnLogId,
    alreadyReturned: false,
    didTransitionCustody: transitionCustody,
    waitlistPromotedOnReturn,
  };
}

export async function finalizeCheckoutSideEffects(params: {
  clinicId: string;
  equipmentId: string;
  actor: CustodyActor;
  actorRole?: string;
  equipment: EquipmentRow;
  location?: string | null;
  reminderBaseTime: Date;
  v1StageClaimId: string | null;
  auditMetadata?: Record<string, unknown>;
}): Promise<void> {
  const { clinicId, equipmentId, actor, actorRole, equipment: u, location, reminderBaseTime, v1StageClaimId, auditMetadata } =
    params;

  if (v1StageClaimId) {
    void promoteStagingQueueNext(equipmentId, clinicId);
  }

  logAudit({
    actorRole,
    clinicId,
    actionType: "equipment_checked_out",
    performedBy: actor.id,
    performedByEmail: actor.email,
    targetId: equipmentId,
    targetType: "equipment",
    metadata: { name: u.name, location: location ?? null, ...auditMetadata },
  });

  invalidateAnalyticsCache(clinicId);
  trackSyncSuccess();

  void scheduleSmartReturnReminder({
    clinicId,
    equipmentId: u.id,
    equipmentName: u.name,
    expectedReturnMinutes: u.expectedReturnMinutes,
    userId: actor.id,
    checkedOutAt: reminderBaseTime ?? u.checkedOutAt,
  });

  if (shouldSendPilotEnglishEquipmentPush() && !checkDedupe(u.id, "checkout")) {
    sendPushToAll(clinicId, {
      title: "Equipment Checked Out",
      body: `${u.name} checked out${location ? ` — ${location}` : ""}`,
      tag: `checkout:${u.id}`,
      url: `/equipment/${u.id}`,
    });
  }
}

export async function finalizeReturnSideEffects(params: {
  clinicId: string;
  equipmentId: string;
  actor: CustodyActor;
  actorRole?: string;
  equipment: EquipmentRow;
  isPluggedIn?: boolean;
  plugInDeadlineMinutes?: number;
  waitlistPromotedOnReturn: EquipmentWaitlistRow | null;
  auditMetadata?: Record<string, unknown>;
}): Promise<(typeof equipmentReturns.$inferSelect) | null> {
  const {
    clinicId,
    equipmentId,
    actor,
    actorRole,
    equipment: u,
    isPluggedIn,
    plugInDeadlineMinutes,
    waitlistPromotedOnReturn,
    auditMetadata,
  } = params;

  if (waitlistPromotedOnReturn) {
    void notifyWaitlistPromoted(clinicId, equipmentId, waitlistPromotedOnReturn);
  }

  let returnRecord: (typeof equipmentReturns.$inferSelect) | null = null;
  if (isPluggedIn === false) {
    const deadlineMinutes = plugInDeadlineMinutes ?? PLUG_IN_DEADLINE_DEFAULT_MINUTES;
    const returnId = randomUUID();
    const chargeAlertJobId = await enqueueChargeAlertJob({
      returnId,
      clinicId,
      equipmentId,
      plugInDeadlineMinutes: deadlineMinutes,
    });
    const [created] = await db
      .insert(equipmentReturns)
      .values({
        id: returnId,
        clinicId,
        equipmentId,
        returnedById: actor.id,
        returnedByEmail: actor.email,
        returnedAt: new Date(),
        isPluggedIn: false,
        plugInDeadlineMinutes: deadlineMinutes,
        plugInAlertSentAt: null,
        chargeAlertJobId,
      })
      .returning();
    returnRecord = created ?? null;
  }

  logAudit({
    actorRole,
    clinicId,
    actionType: "equipment_returned",
    performedBy: actor.id,
    performedByEmail: actor.email,
    targetId: equipmentId,
    targetType: "equipment",
    metadata: {
      name: u.name,
      ...(returnRecord
        ? {
            returnId: returnRecord.id,
            isPluggedIn: returnRecord.isPluggedIn,
            plugInDeadlineMinutes: returnRecord.plugInDeadlineMinutes,
          }
        : {}),
      ...auditMetadata,
    },
  });

  invalidateAnalyticsCache(clinicId);
  trackSyncSuccess();

  await cancelSmartReturnReminder(clinicId, u.id, actor.id);

  if (shouldSendPilotEnglishEquipmentPush() && !checkDedupe(u.id, "return")) {
    sendPushToAll(clinicId, {
      title: "Equipment Returned",
      body: `${u.name} has been returned and is available`,
      tag: `return:${u.id}`,
      url: `/equipment/${u.id}`,
    });
  }

  return returnRecord;
}

export async function toggleEquipmentCustody(
  params: ToggleEquipmentCustodyParams,
): Promise<ToggleEquipmentCustodyResult> {
  const { clinicId, equipmentId, actor, isPluggedIn = true, actorRole } = params;

  const [snap] = await db
    .select()
    .from(equipment)
    .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, equipmentId), isNull(equipment.deletedAt)))
    .limit(1);

  if (!snap) {
    return { kind: "not_found" };
  }

  if (snap.checkedOutById && snap.checkedOutById !== actor.id) {
    return {
      kind: "blocked",
      equipment: snap,
      checkedOutByEmail: snap.checkedOutByEmail ?? undefined,
    };
  }

  if (snap.checkedOutById === actor.id) {
    const txResult = await db.transaction(async (tx) =>
      performEquipmentReturn(tx, {
        clinicId,
        equipmentId,
        actor,
      }),
    );

    if (!txResult) {
      return { kind: "not_found" };
    }

    if (txResult.alreadyReturned) {
      return {
        kind: "return",
        equipment: txResult.updated,
        undoToken: "",
        scanLogId: "",
      };
    }

    await finalizeReturnSideEffects({
      clinicId,
      equipmentId,
      actor,
      actorRole,
      equipment: txResult.updated,
      isPluggedIn,
      waitlistPromotedOnReturn: txResult.waitlistPromotedOnReturn,
    });

    return {
      kind: "return",
      equipment: txResult.updated,
      undoToken: txResult.undoToken,
      scanLogId: txResult.scanLogId,
    };
  }

  const preCheck = await evaluateCheckoutV1Preconditions(clinicId, equipmentId, actor.id, snap);
  await assertWaitlistCheckoutAllowed(clinicId, equipmentId, actor.id);

  const txResult = await db.transaction(async (tx) =>
    performEquipmentCheckout(tx, {
      clinicId,
      equipmentId,
      actor,
      v1StageClaimId: preCheck.v1StageClaimId,
      v1NewUsageState: preCheck.v1NewUsageState,
    }),
  );

  if (!txResult) {
    return { kind: "not_found" };
  }

  await finalizeCheckoutSideEffects({
    clinicId,
    equipmentId,
    actor,
    actorRole,
    equipment: txResult.updated,
    reminderBaseTime: txResult.reminderBaseTime,
    v1StageClaimId: preCheck.v1StageClaimId,
  });

  return {
    kind: "checkout",
    equipment: txResult.updated,
    undoToken: txResult.undoToken,
    scanLogId: txResult.scanLogId,
  };
}

export type QuickScanEquipmentCustodyParams = {
  clinicId: string;
  equipmentId: string;
  actor: CustodyActor;
  actorRole?: string;
  isPluggedIn?: boolean;
};

export type QuickScanEquipmentCustodyResult =
  | { kind: "not_found" }
  | { kind: "blocked"; equipment: EquipmentRow; checkedOutByEmail?: string }
  | { kind: "checkout"; equipment: EquipmentRow; undoToken: string; scanLogId: string }
  | { kind: "return"; equipment: EquipmentRow; undoToken: string; scanLogId: string };

export async function quickScanEquipmentCustody(
  params: QuickScanEquipmentCustodyParams,
): Promise<QuickScanEquipmentCustodyResult> {
  const { clinicId, equipmentId, actor, actorRole, isPluggedIn = true } = params;

  const [snap] = await db
    .select()
    .from(equipment)
    .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, equipmentId), isNull(equipment.deletedAt)))
    .limit(1);

  if (!snap) return { kind: "not_found" };

  if (snap.checkedOutById && snap.checkedOutById !== actor.id) {
    return {
      kind: "blocked",
      equipment: snap,
      checkedOutByEmail: snap.checkedOutByEmail ?? undefined,
    };
  }

  if (snap.checkedOutById === actor.id) {
    let txResult: EquipmentReturnTxResult | null = null;
    await db.transaction(async (tx) => {
      txResult = await performEquipmentReturn(tx, { clinicId, equipmentId, actor });
    });

    if (!txResult) return { kind: "not_found" };

    if ((txResult as EquipmentReturnTxResult).alreadyReturned) {
      return {
        kind: "return",
        equipment: (txResult as EquipmentReturnTxResult).updated,
        undoToken: "",
        scanLogId: "",
      };
    }

    await finalizeReturnSideEffects({
      clinicId,
      equipmentId,
      actor,
      actorRole,
      equipment: (txResult as EquipmentReturnTxResult).updated,
      isPluggedIn,
      waitlistPromotedOnReturn: (txResult as EquipmentReturnTxResult).waitlistPromotedOnReturn,
      auditMetadata: { via: "quick_scan" },
    });

    return {
      kind: "return",
      equipment: (txResult as EquipmentReturnTxResult).updated,
      undoToken: (txResult as EquipmentReturnTxResult).undoToken,
      scanLogId: (txResult as EquipmentReturnTxResult).scanLogId,
    };
  }

  const preCheck = await evaluateCheckoutV1Preconditions(clinicId, equipmentId, actor.id, snap);
  await assertWaitlistCheckoutAllowed(clinicId, equipmentId, actor.id);

  let txResult: EquipmentCheckoutTxResult | null = null;
  await db.transaction(async (tx) => {
    txResult = await performEquipmentCheckout(tx, {
      clinicId,
      equipmentId,
      actor,
      v1StageClaimId: preCheck.v1StageClaimId,
      v1NewUsageState: preCheck.v1NewUsageState,
    });
  });

  if (!txResult) return { kind: "not_found" };

  await finalizeCheckoutSideEffects({
    clinicId,
    equipmentId,
    actor,
    actorRole,
    equipment: (txResult as EquipmentCheckoutTxResult).updated,
    reminderBaseTime: (txResult as EquipmentCheckoutTxResult).reminderBaseTime,
    v1StageClaimId: preCheck.v1StageClaimId,
    auditMetadata: { via: "quick_scan" },
  });

  return {
    kind: "checkout",
    equipment: (txResult as EquipmentCheckoutTxResult).updated,
    undoToken: (txResult as EquipmentCheckoutTxResult).undoToken,
    scanLogId: (txResult as EquipmentCheckoutTxResult).scanLogId,
  };
}
