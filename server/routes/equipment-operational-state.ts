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
} from "../db.js";
import { eq, and, inArray, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { logAudit } from "../lib/audit.js";
import { insertRealtimeDomainEvent } from "../lib/realtime-outbox.js";
import {
  computeBundleReadinessGate,
  computeStagingExpiry,
  isEquipmentFullyDeployable,
} from "../services/equipment-operational-state.service.js";
import { apiError } from "../lib/apiError.js";
import { recordOperationalMetric } from "../services/operational-metrics.service.js";

const router = Router();


// ─── Docks ──────────────────────────────────────────────────────────────────

const createDockSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  roomId: z.string().optional(),
});

router.post("/docks", requireAuth, requireAdmin, validateBody(createDockSchema), async (req, res) => {
  const clinicId = req.clinicId!;
  const { id: userId, email } = req.authUser!;
  const { name, description, roomId } = req.body as z.infer<typeof createDockSchema>;

  const id = randomUUID();
  await db.insert(docks).values({ id, clinicId, name, description: description ?? null, roomId: roomId ?? null });
  logAudit({ clinicId, actionType: "equipment_updated", performedBy: userId, performedByEmail: email, targetId: id, metadata: { action: "dock_created", name } });

  const [dock] = await db.select().from(docks).where(eq(docks.id, id));
  res.status(201).json(dock);
});

router.get("/docks", requireAuth, async (req, res) => {
  const clinicId = req.clinicId!;

  const rows = await db.select().from(docks).where(eq(docks.clinicId, clinicId));
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

  const bundleGate = computeBundleReadinessGate(eq_row, conditionStates, conditions, new Date(), true);
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

const dockReturnSchema = z.object({
  dockId: z.string().min(1),
  conditionVerifications: z.array(z.object({
    conditionId: z.string().min(1),
    verified: z.boolean(),
    notes: z.string().max(500).optional(),
  })),
});

router.post("/equipment/:equipmentId/dock-return", requireAuth, validateBody(dockReturnSchema), async (req, res) => {
  const clinicId = req.clinicId!;
  const { id: userId, email } = req.authUser!;
  const { equipmentId } = req.params;
  const { dockId, conditionVerifications } = req.body as z.infer<typeof dockReturnSchema>;

  const [eq_row] = await db.select().from(equipment).where(and(eq(equipment.id, equipmentId), eq(equipment.clinicId, clinicId)));
  if (!eq_row) return apiError(req, res, "errors.notFound", undefined, 404);

  if (!["returned", "docked"].includes(eq_row.custodyState)) {
    return apiError(req, res, "operationalState.invalidCustodyForDockReturn", undefined, 422);
  }
  if (!eq_row.assetTypeId) {
    return apiError(req, res, "operationalState.noAssetTypeDefined", undefined, 422);
  }

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
          .where(and(eq(unitConditionStates.equipmentId, equipmentId), eq(unitConditionStates.conditionId, v.conditionId)));

        if (existing.length > 0) {
          await tx.update(unitConditionStates)
            .set({
              verified: v.verified,
              verifiedAt: v.verified ? now : null,
              verifiedById: v.verified ? userId : null,
              notes: v.notes ?? null,
              updatedAt: now,
            })
            .where(and(eq(unitConditionStates.equipmentId, equipmentId), eq(unitConditionStates.conditionId, v.conditionId)));
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
        true,
      );

      const readinessOk = !("skipped" in readinessResult) && readinessResult.ok;
      const newReadiness = readinessOk ? "ready" : "not_ready";

      // 4. Update equipment with version guard
      const updated = await tx
        .update(equipment)
        .set({
          custodyState: "docked",
          custodyStateSince: now,
          dockId,
          readinessState: newReadiness,
          readinessStateSince: now,
          ...(readinessOk
            ? { dockConfirmedReadyAt: now, dockConfirmedById: userId, emergencyOverrideAt: null, emergencyOverrideById: null }
            : {}),
          version: sql`${equipment.version} + 1`,
        })
        .where(and(
          eq(equipment.id, equipmentId),
          eq(equipment.clinicId, clinicId),
          inArray(equipment.custodyState, ["returned", "docked"]),
          eq(equipment.version, capturedVersion),
        ));

      if ((updated as unknown as { rowCount?: number }).rowCount === 0) {
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
    metadata: { dockId, conditionCount: conditionVerifications.length },
  });
  void recordOperationalMetric({ clinicId, equipmentId, userId, eventType: "dock_return_duration", durationMs: Date.now() - dockReturnStart });

  const [updated_eq] = await db.select().from(equipment).where(eq(equipment.id, equipmentId));
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

        if ((updated as unknown as { rowCount?: number }).rowCount === 0) {
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

      if ((updated as unknown as { rowCount?: number }).rowCount === 0) {
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
        await tx
          .update(equipment)
          .set({ usageState: "available", usageStateSince: now, version: sql`${equipment.version} + 1` })
          .where(and(
            eq(equipment.id, equipmentId),
            eq(equipment.clinicId, clinicId),
            eq(equipment.usageState, "staged"),
            eq(equipment.version, capturedVersion),
          ));
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
    throw err;
  }

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

export default router;
