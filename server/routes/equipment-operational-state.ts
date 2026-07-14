import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  db,
  equipment,
  docks,
  assetTypes,
  assetTypeConditions,
  unitConditionStates,
  stagingQueue,
  users,
  rooms,
} from "../db.js";
import { eq, and, inArray, sql, asc } from "drizzle-orm";
import { requireAuth, requireAdmin, requireEffectiveRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { logAudit } from "../lib/audit.js";
import { insertRealtimeDomainEvent } from "../lib/realtime-outbox.js";
import {
  computeBundleReadinessGate,
  computeStagingExpiry,
  isEquipmentFullyDeployable,
} from "../services/equipment-operational-state.service.js";
import { apiError } from "../lib/apiError.js";
import { referencedIdsBelongToClinic } from "../lib/clinic-scoped-refs.js";
import { recordOperationalMetric } from "../services/operational-metrics.service.js";
import { promoteStagingQueueNext } from "../lib/staging-promotion.js";
import { promoteEquipmentWaitlistWithNotify } from "../lib/equipment-waitlist-promotion.js";
import { isPostgresUniqueViolation, pgUpdateMatchedZeroRows, getPostgresConstraintName } from "../lib/pg-result.js";
import { incrementMetric } from "../lib/metrics.js";

const router = Router();

// ─── Docks ──────────────────────────────────────────────────────────────────

const createDockSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  roomId: z.string().optional(),
  assetTypeId: z.string().optional(),
  capacity: z.number().int().min(1).max(999).optional(),
});

router.post("/docks", requireAuth, requireAdmin, validateBody(createDockSchema), async (req, res) => {
  const clinicId = req.clinicId!;
  const { id: userId, email } = req.authUser!;
  const { name, description, roomId, assetTypeId, capacity } = req.body as z.infer<typeof createDockSchema>;

  if (!(await referencedIdsBelongToClinic(clinicId, roomId, assetTypeId))) {
    return apiError(req, res, "errors.docking.invalidReference", undefined, 400);
  }

  const id = randomUUID();
  try {
    await db.insert(docks).values({
      id, clinicId, name,
      description: description ?? null, roomId: roomId ?? null,
      assetTypeId: assetTypeId ?? null, capacity: capacity ?? null,
    });
  } catch (e) {
    if (isPostgresUniqueViolation(e)) {
      const constraint = getPostgresConstraintName(e);
      if (constraint === "vt_docks_clinic_room_assettype_uq") return apiError(req, res, "errors.docking.duplicateStation", undefined, 409);
      if (constraint === "vt_docks_clinic_name_unique") return apiError(req, res, "errors.docking.duplicateName", undefined, 409);
    }
    throw e;
  }
  logAudit({ clinicId, actionType: "equipment_updated", performedBy: userId, performedByEmail: email, targetId: id, metadata: { action: "dock_created", name } });

  const [dock] = await db.select().from(docks).where(eq(docks.id, id));
  res.status(201).json(dock);
});

router.get("/docks", requireAuth, async (req, res) => {
  const clinicId = req.clinicId!;

  const rows = await db
    .select({
      id: docks.id, clinicId: docks.clinicId, name: docks.name,
      description: docks.description, roomId: docks.roomId,
      assetTypeId: docks.assetTypeId, capacity: docks.capacity,
      createdAt: docks.createdAt,
      assetTypeName: assetTypes.name,
      roomName: rooms.name,
    })
    .from(docks)
    .leftJoin(assetTypes, eq(docks.assetTypeId, assetTypes.id))
    .leftJoin(rooms, eq(docks.roomId, rooms.id))
    .where(eq(docks.clinicId, clinicId));
  res.json(rows);
});

// ─── Asset Types ─────────────────────────────────────────────────────────────

const createAssetTypeSchema = z.object({
  name: z.string().min(1).max(200),
});

router.post("/asset-types", requireAuth, requireAdmin, validateBody(createAssetTypeSchema), async (req, res) => {
  const clinicId = req.clinicId!;
  const { id: userId, email } = req.authUser!;
  const { name } = req.body as z.infer<typeof createAssetTypeSchema>;

  const id = randomUUID();
  await db.insert(assetTypes).values({ id, clinicId, name });
  logAudit({ clinicId, actionType: "equipment_updated", performedBy: userId, performedByEmail: email, targetId: id, metadata: { action: "asset_type_created", name } });

  const [row] = await db.select().from(assetTypes).where(eq(assetTypes.id, id));
  res.status(201).json(row);
});

const createConditionSchema = z.object({
  conditionName: z.string().min(1).max(200),
  verificationMethod: z.enum(["visual", "electronic", "manual"]),
  staleAfterMinutes: z.number().int().positive("staleAfterMinutes must be > 0"),
  displayOrder: z.number().int().optional(),
});

router.post("/asset-types/:assetTypeId/conditions", requireAuth, requireAdmin, validateBody(createConditionSchema), async (req, res) => {
  const clinicId = req.clinicId!;
  const { id: userId, email } = req.authUser!;
  const { assetTypeId } = req.params;
  const body = req.body as z.infer<typeof createConditionSchema>;

  const [assetType] = await db.select().from(assetTypes).where(and(eq(assetTypes.id, assetTypeId), eq(assetTypes.clinicId, clinicId)));
  if (!assetType) return apiError(req, res, "errors.notFound", undefined, 404);

  const id = randomUUID();
  await db.insert(assetTypeConditions).values({
    id, clinicId, assetTypeId,
    conditionName: body.conditionName,
    verificationMethod: body.verificationMethod,
    staleAfterMinutes: body.staleAfterMinutes,
    displayOrder: body.displayOrder ?? 0,
  });
  logAudit({ clinicId, actionType: "equipment_condition_verified", performedBy: userId, performedByEmail: email, targetId: id, metadata: { action: "condition_defined", conditionName: body.conditionName, assetTypeId } });

  const [row] = await db.select().from(assetTypeConditions).where(eq(assetTypeConditions.id, id));
  res.status(201).json(row);
});

router.get("/asset-types/:assetTypeId/conditions", requireAuth, async (req, res) => {
  const clinicId = req.clinicId!;
  const { assetTypeId } = req.params;

  const [assetType] = await db.select().from(assetTypes).where(and(eq(assetTypes.id, assetTypeId), eq(assetTypes.clinicId, clinicId)));
  if (!assetType) return apiError(req, res, "errors.notFound", undefined, 404);

  const conditions = await db
    .select()
    .from(assetTypeConditions)
    .where(and(eq(assetTypeConditions.assetTypeId, assetTypeId), eq(assetTypeConditions.clinicId, clinicId)))
    .orderBy(assetTypeConditions.displayOrder, assetTypeConditions.conditionName);

  res.json(conditions);
});

// ─── Equipment: Deployability ─────────────────────────────────────────────────

router.get("/equipment/:equipmentId/deployability", requireAuth, async (req, res) => {
  const clinicId = req.clinicId!;
  const { equipmentId } = req.params;

  const [eq_row] = await db.select().from(equipment).where(and(eq(equipment.id, equipmentId), eq(equipment.clinicId, clinicId)));
  if (!eq_row) return apiError(req, res, "errors.notFound", undefined, 404);

  let conditions: typeof assetTypeConditions.$inferSelect[] = [];
  let conditionStates: typeof unitConditionStates.$inferSelect[] = [];
  if (eq_row.assetTypeId) {
    conditions = await db.select().from(assetTypeConditions).where(eq(assetTypeConditions.assetTypeId, eq_row.assetTypeId));
    if (conditions.length > 0) {
      conditionStates = await db.select().from(unitConditionStates).where(eq(unitConditionStates.equipmentId, equipmentId));
    }
  }

  const bundleGate = computeBundleReadinessGate(eq_row, conditionStates, conditions, new Date());
  const fullDeployable = isEquipmentFullyDeployable(eq_row.custodyState, eq_row.readinessState, eq_row.usageState);

  res.json({
    equipmentId,
    custodyState: eq_row.custodyState,
    readinessState: eq_row.readinessState,
    usageState: eq_row.usageState,
    fullDeployable,
    bundleGate,
    asOfMs: Date.now(),
  });
});

// ─── Equipment: Dock Return ───────────────────────────────────────────────────

const dockReturnSchema = z
  .object({
    dockId: z.string().min(1).optional(),
    masterNfcTagId: z.string().min(1).max(200).optional(),
    conditionVerifications: z.array(
      z.object({
        conditionId: z.string().min(1),
        verified: z.boolean(),
        notes: z.string().max(500).optional(),
      }),
    ),
  })
  .refine((body) => Boolean(body.dockId) !== Boolean(body.masterNfcTagId), {
    message: "Provide exactly one of dockId or masterNfcTagId",
  });

router.post("/equipment/:equipmentId/dock-return", requireAuth, validateBody(dockReturnSchema), async (req, res) => {
  const clinicId = req.clinicId!;
  const { id: userId, email } = req.authUser!;
  const { equipmentId } = req.params;
  const body = req.body as z.infer<typeof dockReturnSchema>;
  const { conditionVerifications } = body;

  const [eq_row] = await db.select().from(equipment).where(and(eq(equipment.id, equipmentId), eq(equipment.clinicId, clinicId)));
  if (!eq_row) return apiError(req, res, "errors.notFound", undefined, 404);

  if (!["returned", "docked", "checked_out"].includes(eq_row.custodyState)) {
    return apiError(req, res, "operationalState.invalidCustodyForDockReturn", undefined, 422);
  }
  if (!eq_row.assetTypeId) {
    return apiError(req, res, "operationalState.noAssetTypeDefined", undefined, 422);
  }

  const { resolveDockIdForReturn } = await import("../lib/dock-return-resolve.js");
  const resolved = await resolveDockIdForReturn(clinicId, {
    dockId: body.dockId,
    masterNfcTagId: body.masterNfcTagId,
  });
  if (!resolved.ok) {
    if (resolved.reason === "ambiguous_docks") {
      return res.status(422).json({
        code: "operationalState.ambiguousDocks",
        docks: resolved.docks,
      });
    }
    if (resolved.reason === "room_not_found") {
      return apiError(req, res, "operationalState.dockMasterTagNotFound", undefined, 404);
    }
    return apiError(req, res, "errors.notFound", undefined, resolved.status);
  }
  const dockId = resolved.dockId;
  const dockReturnVia = resolved.via === "master_nfc_tag" ? "nfc_confirm" : "manual";

  const [dock] = await db.select().from(docks).where(and(eq(docks.id, dockId), eq(docks.clinicId, clinicId)));
  if (!dock) return apiError(req, res, "errors.notFound", undefined, 404);
  if (dock.clinicId !== clinicId) return apiError(req, res, "operationalState.crossClinicAssociation", undefined, 422);

  // Validate all conditions
  const verifiedConditionIds = conditionVerifications.map((v) => v.conditionId);
  const fetchedConditions = verifiedConditionIds.length > 0
    ? await db.select().from(assetTypeConditions).where(inArray(assetTypeConditions.id, verifiedConditionIds))
    : [];

  for (const v of conditionVerifications) {
    const condition = fetchedConditions.find((c) => c.id === v.conditionId);
    if (!condition) return apiError(req, res, "operationalState.conditionNotFound", undefined, 422);
    if (condition.clinicId !== clinicId) return apiError(req, res, "operationalState.crossClinicAssociation", undefined, 422);
    if (condition.assetTypeId !== eq_row.assetTypeId) return apiError(req, res, "operationalState.conditionWrongAssetType", undefined, 422);
  }

  const dockReturnStart = Date.now();
  const now = new Date();
  const capturedVersion = eq_row.version;

  try {
    await db.transaction(async (tx) => {
      // 1. Upsert unit condition states
      for (const v of conditionVerifications) {
        const existing = await tx.select().from(unitConditionStates)
          .where(
            and(
              eq(unitConditionStates.clinicId, clinicId),
              eq(unitConditionStates.equipmentId, equipmentId),
              eq(unitConditionStates.conditionId, v.conditionId),
            ),
          );

        if (existing.length > 0) {
          await tx.update(unitConditionStates)
            .set({
              verified: v.verified,
              verifiedAt: v.verified ? now : null,
              verifiedById: v.verified ? userId : null,
              notes: v.notes ?? null,
              updatedAt: now,
            })
            .where(
              and(
                eq(unitConditionStates.clinicId, clinicId),
                eq(unitConditionStates.equipmentId, equipmentId),
                eq(unitConditionStates.conditionId, v.conditionId),
              ),
            );
        } else {
          await tx.insert(unitConditionStates).values({
            id: randomUUID(),
            clinicId,
            equipmentId,
            conditionId: v.conditionId,
            verified: v.verified,
            verifiedAt: v.verified ? now : null,
            verifiedById: v.verified ? userId : null,
            notes: v.notes ?? null,
            updatedAt: now,
          });
        }
      }

      // 2. Fetch fresh condition states for all asset type conditions
      const allConditions = await tx.select().from(assetTypeConditions).where(eq(assetTypeConditions.assetTypeId, eq_row.assetTypeId!));
      const freshStates = await tx.select().from(unitConditionStates).where(eq(unitConditionStates.equipmentId, equipmentId));

      // 3. Compute bundle readiness (simulate custody='docked')
      const readinessResult = computeBundleReadinessGate(
        { ...eq_row, custodyState: "docked" },
        freshStates,
        allConditions,
        now,
      );

      const readinessOk = readinessResult.ok;
      const newReadiness = readinessOk ? "ready" : "not_ready";

      let checkedOutClearFields: Record<string, unknown> = {};
      if (eq_row.custodyState === "checked_out") {
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
        const hasActiveClaims = Number(activeClaims?.count ?? 0) > 0;
        checkedOutClearFields = {
          checkedOutById: null,
          checkedOutByEmail: null,
          checkedOutAt: null,
          checkedOutLocation: null,
          usageState: hasActiveClaims ? ("staged" as const) : ("available" as const),
          usageStateSince: now,
        };
      }

      // 4. Update equipment with version guard
      const updated = await tx
        .update(equipment)
        .set({
          custodyState: "docked",
          custodyStateSince: now,
          dockId,
          readinessState: newReadiness,
          readinessStateSince: now,
          ...checkedOutClearFields,
          ...(readinessOk
            ? { dockConfirmedReadyAt: now, dockConfirmedById: userId, emergencyOverrideAt: null, emergencyOverrideById: null }
            : {}),
          version: sql`${equipment.version} + 1`,
        })
        .where(and(
          eq(equipment.id, equipmentId),
          eq(equipment.clinicId, clinicId),
          inArray(equipment.custodyState, ["returned", "docked", "checked_out"]),
          eq(equipment.version, capturedVersion),
        ));

      if (pgUpdateMatchedZeroRows(updated)) {
        throw new Error("VERSION_CONFLICT");
      }

      await insertRealtimeDomainEvent(tx, {
        clinicId,
        type: "EQUIPMENT_DOCK_RETURN",
        payload: { equipmentId, readinessState: newReadiness, dockId },
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message === "VERSION_CONFLICT") {
      return apiError(req, res, "operationalState.versionConflict", undefined, 409);
    }
    if (err instanceof Error && err.message.startsWith("INVARIANT:")) {
      return apiError(req, res, "operationalState.conditionWrongAssetType", undefined, 422);
    }
    throw err;
  }

  logAudit({
    clinicId,
    actionType: "equipment_dock_return",
    performedBy: userId,
    performedByEmail: email,
    targetId: equipmentId,
    metadata: { dockId, conditionCount: conditionVerifications.length, via: dockReturnVia },
  });
  if (dockReturnVia === "nfc_confirm") {
    incrementMetric("dock_return_nfc_confirmed");
  }
  void recordOperationalMetric({ clinicId, equipmentId, userId, eventType: "dock_return_duration", durationMs: Date.now() - dockReturnStart });

  const [updated_eq] = await db.select().from(equipment).where(and(eq(equipment.id, equipmentId), eq(equipment.clinicId, clinicId)));
  if (
    updated_eq &&
    isEquipmentFullyDeployable(updated_eq.custodyState, updated_eq.readinessState, updated_eq.usageState)
  ) {
    void promoteEquipmentWaitlistWithNotify(clinicId, equipmentId, "dock_return");
  }
  res.json({ equipmentId, readinessState: updated_eq?.readinessState, custodyState: updated_eq?.custodyState });
});

// ─── Equipment: Staging ───────────────────────────────────────────────────────

const stageSchema = z.object({
  clinicalPriority: z.enum(["routine", "urgent", "emergency"]).default("routine"),
  taskId: z.string().optional(),
  notes: z.string().max(500).optional(),
  emergencyStage: z.boolean().optional(),
});

router.post("/equipment/:equipmentId/stage", requireAuth, validateBody(stageSchema), async (req, res) => {
  const clinicId = req.clinicId!;
  const { id: userId, email } = req.authUser!;
  const { equipmentId } = req.params;
  const { clinicalPriority, taskId, notes, emergencyStage } = req.body as z.infer<typeof stageSchema>;
  const isEmergencyStage = emergencyStage === true || clinicalPriority === "emergency";

  const [eq_row] = await db.select().from(equipment).where(and(eq(equipment.id, equipmentId), eq(equipment.clinicId, clinicId)));
  if (!eq_row) return apiError(req, res, "errors.notFound", undefined, 404);

  if (eq_row.custodyState !== "docked") {
    return apiError(req, res, "operationalState.invalidCustodyForStaging", undefined, 422);
  }
  if (!isEmergencyStage && eq_row.readinessState !== "ready") {
    return apiError(req, res, "operationalState.equipmentNotReady", undefined, 422);
  }
  if (!["available", "staged"].includes(eq_row.usageState)) {
    return apiError(req, res, "operationalState.equipmentUnavailable", undefined, 422);
  }

  const now = new Date();
  const expiresAt = computeStagingExpiry(clinicalPriority, now);
  const claimId = randomUUID();

  try {
    if (eq_row.usageState === "available") {
      const capturedVersion = eq_row.version;
      await db.transaction(async (tx) => {
        const conditions: Parameters<typeof and>[0][] = [
          eq(equipment.id, equipmentId),
          eq(equipment.clinicId, clinicId),
          eq(equipment.custodyState, "docked"),
          eq(equipment.usageState, "available"),
          eq(equipment.version, capturedVersion),
        ];
        if (!isEmergencyStage) conditions.push(eq(equipment.readinessState, "ready"));

        const updated = await tx
          .update(equipment)
          .set({ usageState: "staged", usageStateSince: now, version: sql`${equipment.version} + 1` })
          .where(and(...conditions));

        if (pgUpdateMatchedZeroRows(updated)) {
          throw new Error("VERSION_CONFLICT");
        }

        await tx.insert(stagingQueue).values({
          id: claimId, clinicId, equipmentId,
          requestedById: userId,
          taskId: taskId ?? null,
          clinicalPriority,
          stagedAt: now,
          expiresAt,
          status: "active",
          notes: notes ?? null,
        });

        await insertRealtimeDomainEvent(tx, {
          clinicId,
          type: "EQUIPMENT_STAGED",
          payload: { equipmentId, claimId, clinicalPriority },
        });
      });
    } else {
      // usage already 'staged' — insert claim only, verify state inside transaction
      await db.transaction(async (tx) => {
        const [current] = await tx.select().from(equipment).where(eq(equipment.id, equipmentId));
        if (!current || current.usageState !== "staged") throw new Error("EQUIPMENT_NOT_STAGED");
        if (current.custodyState !== "docked") throw new Error("CUSTODY_CHAIN_BROKEN");
        if (!isEmergencyStage && current.readinessState !== "ready") throw new Error("EQUIPMENT_NOT_READY");

        await tx.insert(stagingQueue).values({
          id: claimId, clinicId, equipmentId,
          requestedById: userId,
          taskId: taskId ?? null,
          clinicalPriority,
          stagedAt: now,
          expiresAt,
          status: "active",
          notes: notes ?? null,
        });

        await insertRealtimeDomainEvent(tx, {
          clinicId,
          type: "EQUIPMENT_STAGED",
          payload: { equipmentId, claimId, clinicalPriority },
        });
      });
    }
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "VERSION_CONFLICT") return apiError(req, res, "operationalState.versionConflict", undefined, 409);
      if (err.message === "EQUIPMENT_NOT_STAGED") return apiError(req, res, "operationalState.equipmentUnavailable", undefined, 422);
      if (err.message === "CUSTODY_CHAIN_BROKEN") return apiError(req, res, "operationalState.invalidCustodyForStaging", undefined, 422);
      if (err.message === "EQUIPMENT_NOT_READY") return apiError(req, res, "operationalState.equipmentNotReady", undefined, 422);
    }
    if (isPostgresUniqueViolation(err)) {
      return res.status(409).json({ code: "DUPLICATE_CLAIM", error: "You already have an active claim for this equipment" });
    }
    throw err;
  }

  logAudit({ clinicId, actionType: "equipment_staged", performedBy: userId, performedByEmail: email, targetId: equipmentId, metadata: { claimId, clinicalPriority } });
  void recordOperationalMetric({ clinicId, equipmentId, userId, eventType: "staging_requested" });
  res.status(201).json({ claimId, equipmentId, clinicalPriority, expiresAt });
});

router.delete("/equipment/:equipmentId/stage/:claimId", requireAuth, async (req, res) => {
  const clinicId = req.clinicId!;
  const { id: userId, email } = req.authUser!;
  const { equipmentId, claimId } = req.params;

  const [eq_row] = await db.select().from(equipment).where(and(eq(equipment.id, equipmentId), eq(equipment.clinicId, clinicId)));
  if (!eq_row) return apiError(req, res, "errors.notFound", undefined, 404);

  const [claim] = await db.select().from(stagingQueue).where(and(eq(stagingQueue.id, claimId), eq(stagingQueue.equipmentId, equipmentId), eq(stagingQueue.clinicId, clinicId)));
  if (!claim) return apiError(req, res, "errors.notFound", undefined, 404);
  if (claim.status !== "active") return apiError(req, res, "operationalState.claimNotActive", undefined, 409);

  const capturedVersion = eq_row.version;
  const now = new Date();

  try {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(stagingQueue)
        .set({ status: "cancelled", updatedAt: now })
        .where(and(
          eq(stagingQueue.id, claimId),
          eq(stagingQueue.equipmentId, equipmentId),
          eq(stagingQueue.clinicId, clinicId),
          eq(stagingQueue.status, "active"),
        ));

      if (pgUpdateMatchedZeroRows(updated)) {
        throw new Error("CLAIM_NOT_ACTIVE");
      }

      const [remaining] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(stagingQueue)
        .where(and(
          eq(stagingQueue.equipmentId, equipmentId),
          eq(stagingQueue.clinicId, clinicId),
          eq(stagingQueue.status, "active"),
        ));

      if (!remaining || Number(remaining.count) === 0) {
        const revertResult = await tx
          .update(equipment)
          .set({ usageState: "available", usageStateSince: now, version: sql`${equipment.version} + 1` })
          .where(and(
            eq(equipment.id, equipmentId),
            eq(equipment.clinicId, clinicId),
            eq(equipment.usageState, "staged"),
            eq(equipment.version, capturedVersion),
          ));
        if (pgUpdateMatchedZeroRows(revertResult)) {
          throw new Error("VERSION_CONFLICT");
        }
      }

      await insertRealtimeDomainEvent(tx, {
        clinicId,
        type: "EQUIPMENT_STAGE_CANCELLED",
        payload: { equipmentId, claimId },
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message === "CLAIM_NOT_ACTIVE") {
      return apiError(req, res, "operationalState.claimNotActive", undefined, 409);
    }
    if (err instanceof Error && err.message === "VERSION_CONFLICT") {
      return apiError(req, res, "operationalState.versionConflict", undefined, 409);
    }
    throw err;
  }

  void promoteStagingQueueNext(equipmentId, clinicId);
  logAudit({ clinicId, actionType: "equipment_stage_cancelled", performedBy: userId, performedByEmail: email, targetId: equipmentId, metadata: { claimId } });
  res.status(204).send();
});

router.get("/equipment/:equipmentId/staging-queue", requireAuth, async (req, res) => {
  const clinicId = req.clinicId!;
  const { equipmentId } = req.params;

  const [eq_row] = await db.select().from(equipment).where(and(eq(equipment.id, equipmentId), eq(equipment.clinicId, clinicId)));
  if (!eq_row) return apiError(req, res, "errors.notFound", undefined, 404);

  const claims = await db
    .select()
    .from(stagingQueue)
    .where(and(eq(stagingQueue.equipmentId, equipmentId), eq(stagingQueue.clinicId, clinicId), eq(stagingQueue.status, "active")))
    .orderBy(
      sql`CASE ${stagingQueue.clinicalPriority} WHEN 'emergency' THEN 3 WHEN 'urgent' THEN 2 WHEN 'routine' THEN 1 ELSE 0 END DESC`,
      stagingQueue.stagedAt,
    );

  res.json(claims);
});

// ─── Asset Types: list ────────────────────────────────────────────────────────

router.get("/asset-types", requireAuth, async (req, res) => {
  const clinicId = req.clinicId!;
  const rows = await db.select().from(assetTypes).where(eq(assetTypes.clinicId, clinicId));
  res.json(rows);
});

// ─── Equipment: Condition States ──────────────────────────────────────────────

router.get("/equipment/:equipmentId/condition-states", requireAuth, async (req, res) => {
  const clinicId = req.clinicId!;
  const { equipmentId } = req.params;

  const [eq_row] = await db
    .select({ id: equipment.id, assetTypeId: equipment.assetTypeId })
    .from(equipment)
    .where(and(eq(equipment.id, equipmentId), eq(equipment.clinicId, clinicId)))
    .limit(1);

  if (!eq_row) return res.status(404).json({ code: "NOT_FOUND", error: "Equipment not found" });
  if (!eq_row.assetTypeId) return res.json([]);

  const states = await db
    .select({
      id: unitConditionStates.id,
      equipmentId: unitConditionStates.equipmentId,
      conditionId: unitConditionStates.conditionId,
      verified: unitConditionStates.verified,
      verifiedAt: unitConditionStates.verifiedAt,
      verifiedByName: users.name,
      notes: unitConditionStates.notes,
      updatedAt: unitConditionStates.updatedAt,
    })
    .from(unitConditionStates)
    .innerJoin(assetTypeConditions, and(
      eq(assetTypeConditions.id, unitConditionStates.conditionId),
      eq(assetTypeConditions.assetTypeId, eq_row.assetTypeId),
    ))
    .leftJoin(users, eq(users.id, unitConditionStates.verifiedById))
    .where(and(
      eq(unitConditionStates.equipmentId, equipmentId),
      eq(unitConditionStates.clinicId, clinicId),
    ))
    .orderBy(asc(assetTypeConditions.displayOrder), asc(assetTypeConditions.conditionName));

  res.json(states);
});

// ─── Equipment: Procedure Bind / Unbind ────────────────────────────────────────

const procedureBindSchema = z.object({
  hospitalizationId: z.string().min(1),
});

router.post(
  "/equipment/:equipmentId/procedure-bind",
  requireAuth,
  requireEffectiveRole("vet"),
  validateBody(procedureBindSchema),
  async (_req, res) => {
    return res.status(410).json({ code: "GONE", error: "Procedure bind is no longer supported" });
  },
);

router.delete("/equipment/:equipmentId/procedure-bind", requireAuth, requireEffectiveRole("vet"), async (_req, res) => {
  return res.status(410).json({ code: "GONE", error: "Procedure bind is no longer supported" });
});

export default router;
