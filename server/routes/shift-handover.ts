import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import {
  alertAcks,
  animals,
  appointments,
  billingItems,
  billingLedger,
  codeBlueSessions,
  containerItems,
  containers,
  db,
  dispenseEvents,
  equipment,
  hospitalizations,
  inventoryItems,
  inventoryJobs,
  inventoryLogs,
  medicationTasks,
  scanLogs,
  serverConfig,
  shiftHandoverSnapshots,
  shiftSessions,
  usageSessions,
  users,
} from "../db.js";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { enqueueShiftReportEmailJob } from "../lib/queue.js";
import { postSystemMessage } from "../lib/shift-chat-presence.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";

const router = Router();

const startSessionSchema = z.object({
  note: z.string().max(500).optional(),
});

function resolveRequestId(res: { getHeader: (n: string) => unknown; setHeader?: (n: string, v: string) => void }, incoming: unknown): string {
  const incomingStr = typeof incoming === "string" ? incoming.trim() : "";
  const existing = res.getHeader("x-request-id");
  const fromRes = typeof existing === "string" ? existing.trim() : "";
  const requestId = incomingStr || fromRes || randomUUID();
  if (typeof res.setHeader === "function") res.setHeader("x-request-id", requestId);
  return requestId;
}

function apiError(params: { code: string; reason: string; message: string; requestId: string }) {
  return {
    code: params.code,
    error: params.code,
    reason: params.reason,
    message: params.message,
    requestId: params.requestId,
  };
}

/** Latest open shift session for clinic, or null. */
async function getOpenShiftSession(clinicId: string) {
  const [row] = await db
    .select()
    .from(shiftSessions)
    .where(and(eq(shiftSessions.clinicId, clinicId), isNull(shiftSessions.endedAt)))
    .orderBy(desc(shiftSessions.startedAt))
    .limit(1);
  return row ?? null;
}

function addDaysYmd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function resolveReportWindow(
  clinicId: string,
): Promise<{ windowStart: Date; source: "open_shift" | "fallback_12h" }> {
  const open = await getOpenShiftSession(clinicId);
  if (open) {
    return { windowStart: new Date(open.startedAt), source: "open_shift" };
  }
  return { windowStart: new Date(Date.now() - 12 * 60 * 60 * 1000), source: "fallback_12h" };
}

// GET /api/shift-handover/discharge/:animalId — open usage sessions (equipment still "in use" for billing)
router.get("/discharge/:animalId", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const animalId = req.params.animalId?.trim();
    if (!animalId) {
      return res.status(400).json(
        apiError({
          code: "VALIDATION_FAILED",
          reason: "ANIMAL_ID_REQUIRED",
          message: "animalId is required",
          requestId,
        }),
      );
    }

    const rows = await db
      .select({
        sessionId: usageSessions.id,
        equipmentId: equipment.id,
        equipmentName: equipment.name,
        startedAt: usageSessions.startedAt,
      })
      .from(usageSessions)
      .leftJoin(equipment, eq(usageSessions.equipmentId, equipment.id))
      .where(
        and(
          eq(usageSessions.clinicId, clinicId),
          eq(usageSessions.animalId, animalId),
          eq(usageSessions.status, "open"),
        ),
      );

    res.json({ items: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "DISCHARGE_FETCH_FAILED",
        message: "Failed to load discharge checklist",
        requestId,
      }),
    );
  }
});

// GET /api/shift-handover/summary
router.get("/summary", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { windowStart, source } = await resolveReportWindow(clinicId);
    const now = new Date();

    const revenueRows = await db
      .select({ total: sql<number>`coalesce(sum(${billingLedger.totalAmountCents}), 0)::int` })
      .from(billingLedger)
      .where(
        and(eq(billingLedger.clinicId, clinicId), gte(billingLedger.createdAt, windowStart)),
      );
    const [medicationDelay] = await db
      .select({
        avgDelaySeconds:
          sql<number>`coalesce(avg(extract(epoch from (${appointments.completedAt} - ${appointments.scheduledAt}))), 0)::int`,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          eq(appointments.taskType, "medication"),
          eq(appointments.status, "completed"),
          gte(appointments.completedAt, windowStart),
          isNotNull(appointments.completedAt),
          isNotNull(appointments.scheduledAt),
        ),
      );

    const revenueCents = revenueRows[0]?.total ?? 0;

    const unreturned = await db
      .select({
        id: equipment.id,
        name: equipment.name,
        checkedOutAt: equipment.checkedOutAt,
        checkedOutByEmail: equipment.checkedOutByEmail,
        checkedOutLocation: equipment.checkedOutLocation,
      })
      .from(equipment)
      .where(
        and(
          eq(equipment.clinicId, clinicId),
          isNull(equipment.deletedAt),
          isNotNull(equipment.checkedOutAt),
        ),
      )
      .orderBy(desc(equipment.checkedOutAt));

    const scanCounts = await db
      .select({
        equipmentId: scanLogs.equipmentId,
        cnt: sql<number>`count(*)::int`,
      })
      .from(scanLogs)
      .where(
        and(
          eq(scanLogs.clinicId, clinicId),
          gte(scanLogs.timestamp, windowStart),
          isNotNull(scanLogs.equipmentId),
        ),
      )
      .groupBy(scanLogs.equipmentId);

    const scanMap = new Map<string, number>();
    for (const r of scanCounts) {
      if (r.equipmentId) scanMap.set(r.equipmentId, r.cnt);
    }

    const expiringAssets = await db
      .select({
        id: equipment.id,
        name: equipment.name,
        expiryDate: equipment.expiryDate,
      })
      .from(equipment)
      .where(
        and(
          eq(equipment.clinicId, clinicId),
          isNull(equipment.deletedAt),
          isNotNull(equipment.expiryDate),
          lte(equipment.expiryDate, addDaysYmd(90)),
        ),
      )
      .orderBy(asc(equipment.expiryDate))
      .limit(50);

    const allActive = await db
      .select({ id: equipment.id, name: equipment.name })
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), isNull(equipment.deletedAt)));

    const hotAssets = [...allActive]
      .map((e) => ({ ...e, scans: scanMap.get(e.id) ?? 0 }))
      .filter((e) => e.scans > 0)
      .sort((a, b) => b.scans - a.scans)
      .slice(0, 10);

    const openSession = await getOpenShiftSession(clinicId);

    res.json({
      windowStart: windowStart.toISOString(),
      windowEnd: now.toISOString(),
      windowSource: source,
      revenueCents,
      averageMedicationDelaySeconds: medicationDelay?.avgDelaySeconds ?? 0,
      unreturned,
      expiringAssets,
      hotAssets,
      openShiftSession: openSession
        ? {
            id: openSession.id,
            startedAt: openSession.startedAt,
            startedByUserId: openSession.startedByUserId,
            note: openSession.note,
          }
        : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "HANDOVER_SUMMARY_FAILED",
        message: "Failed to load shift handover summary",
        requestId,
      }),
    );
  }
});

// POST /api/shift-handover/session/start
router.post(
  "/session/start",
  requireAuth,
  requireEffectiveRole("technician"),
  validateBody(startSessionSchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const clinicId = req.clinicId!;
      const existing = await getOpenShiftSession(clinicId);
      if (existing) {
        return res.status(409).json(
          apiError({
            code: "CONFLICT",
            reason: "SHIFT_ALREADY_OPEN",
            message: "A shift session is already open",
            requestId,
          }),
        );
      }
      const { note } = req.body as z.infer<typeof startSessionSchema>;
      const id = randomUUID();
      const startedAt = new Date();
      await db.insert(shiftSessions).values({
        id,
        clinicId,
        startedAt,
        endedAt: null,
        startedByUserId: req.authUser!.id,
        note: note?.trim() || null,
      });
      res.status(201).json({
        id,
        clinicId,
        startedAt: startedAt.toISOString(),
        endedAt: null,
        startedByUserId: req.authUser!.id,
        note: note?.trim() || null,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json(
        apiError({
          code: "INTERNAL_ERROR",
          reason: "SHIFT_START_FAILED",
          message: "Failed to start shift session",
          requestId,
        }),
      );
    }
  },
);

const endSessionSchema = z.object({
  note: z.string().max(500).optional(),
  overrideReason: z.string().min(1).max(500).optional(),
});

// POST /api/shift-handover/session/end
// Fix B: blocks closure if pending medication tasks or unreconciled Code Blue sessions exist.
// Pass ?override=true + body.overrideReason to force close.
// Fix C: persists handover snapshot on successful close.
router.post(
  "/session/end",
  requireAuth,
  requireEffectiveRole("technician"),
  validateBody(endSessionSchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const clinicId = req.clinicId!;
      const open = await getOpenShiftSession(clinicId);
      if (!open) {
        return res.status(404).json(
          apiError({ code: "NOT_FOUND", reason: "NO_OPEN_SHIFT", message: "No open shift session", requestId }),
        );
      }
      const { note, overrideReason } = req.body as z.infer<typeof endSessionSchema>;
      const override = req.query.override === "true";

      if (override && !overrideReason?.trim()) {
        return res.status(400).json(
          apiError({ code: "OVERRIDE_REASON_REQUIRED", reason: "OVERRIDE_REASON_REQUIRED", message: "overrideReason is required when override=true", requestId }),
        );
      }

      // Fix B: pre-flight checks
      if (!override) {
        const blockingConditions: Array<{ type: string; count: number; ids?: string[] }> = [];

        // 1. Pending / in-progress medication tasks for active patients
        const activeHospAnimalIds = (
          await db
            .select({ animalId: hospitalizations.animalId })
            .from(hospitalizations)
            .where(and(eq(hospitalizations.clinicId, clinicId), isNull(hospitalizations.dischargedAt)))
        ).map((r) => r.animalId);

        if (activeHospAnimalIds.length > 0) {
          const openMedTasks = await db
            .select({ id: medicationTasks.id })
            .from(medicationTasks)
            .where(
              and(
                eq(medicationTasks.clinicId, clinicId),
                inArray(medicationTasks.animalId, activeHospAnimalIds),
                inArray(medicationTasks.status, ["pending", "in_progress", "approved"]),
              ),
            );
          if (openMedTasks.length > 0) {
            blockingConditions.push({ type: "pending_medication_tasks", count: openMedTasks.length, ids: openMedTasks.map((t) => t.id) });
          }
        }

        // 2. Unreconciled ended Code Blue sessions
        const unreconciledCB = await db
          .select({ id: codeBlueSessions.id })
          .from(codeBlueSessions)
          .where(
            and(
              eq(codeBlueSessions.clinicId, clinicId),
              eq(codeBlueSessions.status, "ended"),
              eq(codeBlueSessions.isReconciled, false),
            ),
          );
        if (unreconciledCB.length > 0) {
          blockingConditions.push({ type: "unreconciled_code_blue_sessions", count: unreconciledCB.length, ids: unreconciledCB.map((s) => s.id) });
        }

        if (blockingConditions.length > 0) {
          return res.status(409).json({
            code: "BLOCKING_CONDITIONS_PREVENT_SHIFT_END",
            error: "BLOCKING_CONDITIONS_PREVENT_SHIFT_END",
            reason: "BLOCKING_CONDITIONS_PREVENT_SHIFT_END",
            message: "Shift closure blocked: resolve the listed conditions or pass ?override=true with overrideReason.",
            blockingConditions,
            requestId,
          });
        }
      }

      const endedAt = new Date();
      const mergedNote = note?.trim() ? [open.note, note.trim()].filter(Boolean).join(" | ") : open.note;

      // Fix C: build and persist patient-centric handover snapshot BEFORE closing
      const { patients: patientPayload, summaryCounts } = await buildPatientHandoverPayload(clinicId);
      await db.insert(shiftHandoverSnapshots).values({
        id: randomUUID(),
        clinicId,
        shiftSessionId: open.id,
        generatedAt: endedAt,
        patientsPayload: patientPayload,
        summaryCounts,
        createdBy: req.authUser!.id,
      }).onConflictDoNothing();

      postSystemMessage(clinicId, "shift_summary", {
        endedAt: endedAt.toISOString(),
        note: mergedNote ?? null,
        summaryCounts,
      }).catch(() => {});

      await db
        .update(shiftSessions)
        .set({ endedAt, note: mergedNote })
        .where(and(eq(shiftSessions.id, open.id), eq(shiftSessions.clinicId, clinicId)));

      if (override && overrideReason?.trim()) {
        logAudit({
          clinicId,
          actionType: "shift_session_ended",
          performedBy: req.authUser!.id,
          performedByEmail: req.authUser!.email ?? "",
          actorRole: resolveAuditActorRole(req),
          targetId: open.id,
          targetType: "shift_session",
          metadata: { override: true, overrideReason: overrideReason.trim(), summaryCounts },
        });
      }

      void (async () => {
        try {
          const configKey = `${clinicId}:manager_email`;
          const [cfgRow] = await db.select().from(serverConfig).where(eq(serverConfig.key, configKey)).limit(1);
          if (cfgRow?.value) {
            await enqueueShiftReportEmailJob({ clinicId, shiftSessionId: open.id, managerEmail: cfgRow.value });
          }
        } catch (emailErr) {
          console.error("[shift-handover] failed to enqueue shift_report_email:", (emailErr as Error).message);
        }
      })();

      return res.json({
        id: open.id,
        clinicId,
        startedAt: open.startedAt,
        endedAt: endedAt.toISOString(),
        startedByUserId: open.startedByUserId,
        note: mergedNote,
        summaryCounts,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json(
        apiError({ code: "INTERNAL_ERROR", reason: "SHIFT_END_FAILED", message: "Failed to end shift session", requestId }),
      );
    }
  },
);

// GET /api/shift-handover/consumables-report?from=<ISO>&to=<ISO>
router.get("/consumables-report", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const fromParam = typeof req.query.from === "string" ? req.query.from : null;
    const toParam = typeof req.query.to === "string" ? req.query.to : null;

    // Default to current shift window if params not provided
    const now = new Date();
    const fromDate = fromParam ? new Date(fromParam) : new Date(now.getTime() - 12 * 60 * 60 * 1000);
    const toDate = toParam ? new Date(toParam) : now;

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json(apiError({ code: "VALIDATION_FAILED", reason: "INVALID_DATE", message: "Invalid from/to date", requestId }));
    }

    const rows = await db
      .select({
        id: inventoryLogs.id,
        containerId: inventoryLogs.containerId,
        containerName: containers.name,
        itemId: sql<string | null>`${inventoryLogs.metadata}->>'itemId'`,
        itemLabel: inventoryItems.label,
        quantityAdded: inventoryLogs.quantityAdded,
        animalId: inventoryLogs.animalId,
        animalName: animals.name,
        createdByUserId: inventoryLogs.createdByUserId,
        takenByDisplayName: users.displayName,
        createdAt: inventoryLogs.createdAt,
        metadata: inventoryLogs.metadata,
        billingLedgerId: billingLedger.id,
      })
      .from(inventoryLogs)
      .leftJoin(containers, eq(inventoryLogs.containerId, containers.id))
      .leftJoin(inventoryItems, sql`${inventoryLogs.metadata}->>'itemId' = ${inventoryItems.id}`)
      .leftJoin(animals, eq(inventoryLogs.animalId, animals.id))
      .leftJoin(users, eq(inventoryLogs.createdByUserId, users.id))
      .leftJoin(billingLedger, sql`${billingLedger.idempotencyKey} = 'adjustment_' || ${inventoryLogs.id}`)
      .where(
        and(
          eq(inventoryLogs.clinicId, clinicId),
          eq(inventoryLogs.logType, "adjustment"),
          gte(inventoryLogs.createdAt, fromDate),
          lte(inventoryLogs.createdAt, toDate),
          lte(inventoryLogs.quantityAdded, sql`0`),
        ),
      )
      .orderBy(desc(inventoryLogs.createdAt));

    const totalEvents = rows.length;
    const unlinkedCount = rows.filter((r) => !r.animalId).length;
    const unlinkedPct = totalEvents > 0 ? Math.round((unlinkedCount / totalEvents) * 100) : 0;
    const unBilledRowCount = rows.filter((r) => !r.billingLedgerId).length;

    // Count pending emergencies
    const pendingEmergencies = rows.filter((r) => {
      const meta = r.metadata as Record<string, unknown> | null;
      return meta?.isEmergency === true && meta?.pendingCompletion === true;
    }).length;

    // Containers that had at least one dispense in this window but have NO
    // corresponding CONSUMABLE billing entry — the billing gap at shift level.
    const dispensedContainerIds = [...new Set(rows.map((r) => r.containerId).filter(Boolean))];
    let unBilledCount = 0;
    if (dispensedContainerIds.length > 0) {
      const billedContainerIds = await db
        .select({ itemId: billingLedger.itemId })
        .from(billingLedger)
        .where(
          and(
            eq(billingLedger.clinicId, clinicId),
            eq(billingLedger.itemType, "CONSUMABLE"),
            sql`${billingLedger.status} != 'voided'`,
            gte(billingLedger.createdAt, fromDate),
            lte(billingLedger.createdAt, toDate),
          ),
        );
      const billedSet = new Set(billedContainerIds.map((r) => r.itemId));
      unBilledCount = dispensedContainerIds.filter((id) => !billedSet.has(id)).length;
    }

    // Aggregate by item
    const itemTotals = new Map<string, { itemId: string; label: string; totalQuantity: number }>();
    for (const r of rows) {
      if (!r.itemId) continue;
      const key = r.itemId;
      const existing = itemTotals.get(key);
      if (existing) {
        existing.totalQuantity += Math.abs(r.quantityAdded);
      } else {
        itemTotals.set(key, { itemId: r.itemId, label: r.itemLabel ?? r.itemId, totalQuantity: Math.abs(r.quantityAdded) });
      }
    }

    // Aggregate by animal
    const animalTotals = new Map<string | null, { animalId: string | null; animalName: string | null; totalEvents: number }>();
    for (const r of rows) {
      const key = r.animalId ?? null;
      const existing = animalTotals.get(key);
      if (existing) {
        existing.totalEvents += 1;
      } else {
        animalTotals.set(key, { animalId: r.animalId ?? null, animalName: r.animalName ?? null, totalEvents: 1 });
      }
    }

    // Aggregate by user
    const userTotals = new Map<string, { userId: string; displayName: string; totalEvents: number }>();
    for (const r of rows) {
      const key = r.createdByUserId;
      const existing = userTotals.get(key);
      if (existing) {
        existing.totalEvents += 1;
      } else {
        userTotals.set(key, { userId: r.createdByUserId, displayName: r.takenByDisplayName ?? r.createdByUserId, totalEvents: 1 });
      }
    }

    // Per-user billed counts (billingLedgerId present means the dispense was billed)
    const userBilledCounts = new Map<string, number>();
    for (const r of rows) {
      if (r.billingLedgerId) {
        userBilledCounts.set(r.createdByUserId, (userBilledCounts.get(r.createdByUserId) ?? 0) + 1);
      }
    }

    const userActivity = [...userTotals.values()]
      .map(({ userId, displayName, totalEvents }) => {
        const billedCount = userBilledCounts.get(userId) ?? 0;
        const captureRatePercent = totalEvents > 0 ? Math.round((billedCount / totalEvents) * 100) : 0;
        return { userId, userName: displayName, dispensedCount: totalEvents, billedCount, captureRatePercent };
      })
      .sort((a, b) => b.dispensedCount - a.dispensedCount);

    const events = rows.map((r) => {
      const meta = r.metadata as Record<string, unknown> | null;
      return {
        id: r.id,
        containerId: r.containerId,
        itemLabel: r.itemLabel ?? "—",
        quantity: Math.abs(r.quantityAdded),
        animalName: r.animalName ?? null,
        takenByDisplayName: r.takenByDisplayName ?? r.createdByUserId,
        takenAt: r.createdAt.toISOString(),
        containerName: r.containerName ?? "—",
        isEmergency: meta?.isEmergency === true,
        pendingCompletion: meta?.pendingCompletion === true,
      };
    });

    return res.json({
      totalEvents,
      unlinkedCount,
      unlinkedPct,
      pendingEmergencies,
      unBilledCount,
      byItem: [...itemTotals.values()].sort((a, b) => b.totalQuantity - a.totalQuantity),
      byAnimal: [...animalTotals.values()].sort((a, b) => b.totalEvents - a.totalEvents),
      byUser: [...userTotals.values()].sort((a, b) => b.totalEvents - a.totalEvents),
      userActivity,
      events,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "CONSUMABLES_REPORT_FAILED", message: "Failed to load consumables report", requestId }));
  }
});

// GET /api/shift-handover/pending-emergencies
// Returns unreconciled emergency inventory log entries (all time, not billed yet).
router.get("/pending-emergencies", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;

    // Fetch emergency logs that are still pending completion and not yet billed
    const rows = await db
      .select({
        id: inventoryLogs.id,
        containerId: inventoryLogs.containerId,
        containerName: containers.name,
        quantity: inventoryLogs.quantityAdded,
        dispensedAt: inventoryLogs.createdAt,
        metadata: inventoryLogs.metadata,
        // Unit price from container's billing item
        unitPriceCents: billingItems.unitPriceCents,
        // Item label from container items (via metadata.itemId when present)
        itemLabel: inventoryItems.label,
        // Whether a billing ledger entry already exists for this log
        billingLedgerId: billingLedger.id,
      })
      .from(inventoryLogs)
      .leftJoin(containers, eq(inventoryLogs.containerId, containers.id))
      .leftJoin(billingItems, eq(containers.billingItemId, billingItems.id))
      .leftJoin(inventoryItems, sql`${inventoryLogs.metadata}->>'itemId' = ${inventoryItems.id}`)
      .leftJoin(
        billingLedger,
        and(
          sql`${billingLedger.idempotencyKey} = 'emergency_reconcile_' || ${inventoryLogs.id}`,
          eq(billingLedger.clinicId, clinicId),
        ),
      )
      .where(
        and(
          eq(inventoryLogs.clinicId, clinicId),
          eq(inventoryLogs.logType, "adjustment"),
          sql`(${inventoryLogs.metadata}->>'isEmergency')::boolean = true`,
          sql`(${inventoryLogs.metadata}->>'pendingCompletion' = 'true' OR ${inventoryLogs.metadata}->>'pendingCompletion' IS NULL)`,
          isNull(billingLedger.id),
        ),
      )
      .orderBy(desc(inventoryLogs.createdAt));

    const items = rows.map((r) => {
      const meta = r.metadata as Record<string, unknown> | null;
      const qty = Math.abs(r.quantity);
      return {
        id: r.id,
        containerId: r.containerId,
        itemName: r.itemLabel ?? (meta?.itemId as string | null) ?? r.containerName ?? "Unknown Item",
        quantity: qty,
        dispensedAt: r.dispensedAt.toISOString(),
        unitPriceCents: r.unitPriceCents ?? 0,
      };
    });

    return res.json({ items });
  } catch (err) {
    console.error(err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "PENDING_EMERGENCIES_FAILED",
        message: "Failed to load pending emergency items",
        requestId,
      }),
    );
  }
});

const reconcileSchema = z.object({
  animalId: z.string().min(1),
  quantity: z.number().int().min(1).optional(),
});

// PATCH /api/shift-handover/emergency/:logId/reconcile
router.patch(
  "/emergency/:logId/reconcile",
  requireAuth,
  requireEffectiveRole("technician"),
  validateBody(reconcileSchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const clinicId = req.clinicId!;
      const logId = req.params.logId?.trim();
      const { animalId, quantity: overrideQty } = req.body as z.infer<typeof reconcileSchema>;

      if (!logId) {
        return res.status(400).json(
          apiError({ code: "VALIDATION_FAILED", reason: "LOG_ID_REQUIRED", message: "logId is required", requestId }),
        );
      }

      // Fetch the original emergency log
      const [origLog] = await db
        .select()
        .from(inventoryLogs)
        .where(and(eq(inventoryLogs.clinicId, clinicId), eq(inventoryLogs.id, logId)))
        .limit(1);

      if (!origLog) {
        return res.status(404).json(
          apiError({ code: "NOT_FOUND", reason: "LOG_NOT_FOUND", message: "Emergency log not found", requestId }),
        );
      }

      const meta = origLog.metadata as Record<string, unknown> | null;
      if (!meta?.isEmergency) {
        return res.status(400).json(
          apiError({ code: "VALIDATION_FAILED", reason: "NOT_EMERGENCY", message: "This log is not an emergency dispense", requestId }),
        );
      }

      const idempotencyKey = `emergency_reconcile_${logId}`;

      // Check for existing billing ledger entry (idempotent)
      const [existing] = await db
        .select({ id: billingLedger.id })
        .from(billingLedger)
        .where(and(eq(billingLedger.clinicId, clinicId), eq(billingLedger.idempotencyKey, idempotencyKey)))
        .limit(1);

      if (existing) {
        return res.json({ success: true, ledgerId: existing.id, alreadyReconciled: true });
      }

      // Determine price from container's billing item
      const [containerRow] = await db
        .select({ billingItemId: containers.billingItemId })
        .from(containers)
        .where(and(eq(containers.clinicId, clinicId), eq(containers.id, origLog.containerId)))
        .limit(1);

      let unitPriceCents = 0;
      let billingItemId = containerRow?.billingItemId ?? null;

      if (billingItemId) {
        const [bi] = await db
          .select({ unitPriceCents: billingItems.unitPriceCents })
          .from(billingItems)
          .where(eq(billingItems.id, billingItemId))
          .limit(1);
        unitPriceCents = bi?.unitPriceCents ?? 0;
      }

      // Try to get item from container_items if itemId present in metadata
      const metaItemId = typeof meta?.itemId === "string" ? meta.itemId : null;
      if (!billingItemId && metaItemId) {
        // Try to find billingItem from container items configuration
        billingItemId = null; // No fallback — unitPriceCents stays 0
      }

      const quantity = overrideQty ?? (Math.abs(origLog.quantityAdded) || 1);
      const totalAmountCents = unitPriceCents * quantity;

      const billingId = randomUUID();
      const itemId = metaItemId ?? origLog.containerId;

      await db.transaction(async (tx) => {
        // Insert billing ledger entry
        await tx.insert(billingLedger).values({
          id: billingId,
          clinicId,
          animalId,
          itemType: "CONSUMABLE",
          itemId,
          quantity,
          unitPriceCents,
          totalAmountCents,
          idempotencyKey,
          status: "pending",
        });

        // Mark the emergency log as reconciled
        await tx
          .update(inventoryLogs)
          .set({ metadata: { ...meta, pendingCompletion: false } })
          .where(and(eq(inventoryLogs.clinicId, clinicId), eq(inventoryLogs.id, logId)));
      });

      return res.json({ success: true, ledgerId: billingId, alreadyReconciled: false });
    } catch (err) {
      console.error(err);
      return res.status(500).json(
        apiError({
          code: "INTERNAL_ERROR",
          reason: "RECONCILE_FAILED",
          message: "Failed to reconcile emergency dispense",
          requestId,
        }),
      );
    }
  },
);

// ─── Patient-centric handover helper ────────────────────────────────────────

async function buildPatientHandoverPayload(clinicId: string): Promise<{
  patients: Array<{
    hospitalizationId: string;
    animalId: string;
    animalName: string;
    status: string;
    ward: string | null;
    bay: string | null;
    pendingMedicationTasks: Array<{ id: string; status: string; drugId: string; dueAt: string | null }>;
    overdueMedicationCount: number;
    activeAlerts: Array<{ alertType: string; ackStatus: string }>;
    unresolvedEmergencyDispenses: Array<{ id: string; createdAt: string }>;
  }>;
  summaryCounts: {
    patientCount: number;
    pendingTaskCount: number;
    overdueCount: number;
    unresolvedEmergencyCount: number;
  };
}> {
  const now = new Date();

  // 1. Active hospitalizations
  const hospRows = await db
    .select({ hosp: hospitalizations, animal: animals })
    .from(hospitalizations)
    .innerJoin(animals, eq(hospitalizations.animalId, animals.id))
    .where(
      and(
        eq(hospitalizations.clinicId, clinicId),
        isNull(hospitalizations.dischargedAt),
      ),
    )
    .orderBy(hospitalizations.admittedAt);

  // 2. Pending/in-progress medication tasks for these animals
  const animalIds = hospRows.map((r) => r.hosp.animalId);
  const medTaskRows = animalIds.length
    ? await db
        .select({
          id: medicationTasks.id,
          animalId: medicationTasks.animalId,
          status: medicationTasks.status,
          drugId: medicationTasks.drugId,
          dueAt: medicationTasks.dueAt,
        })
        .from(medicationTasks)
        .where(
          and(
            eq(medicationTasks.clinicId, clinicId),
            inArray(medicationTasks.animalId, animalIds),
            inArray(medicationTasks.status, ["pending", "in_progress", "approved"]),
          ),
        )
    : [];

  // 3. Active alert acks (SEEN only — RESOLVED ones are closed)
  const alertRows = animalIds.length
    ? await db
        .select({ equipmentId: alertAcks.equipmentId, alertType: alertAcks.alertType, ackStatus: alertAcks.ackStatus })
        .from(alertAcks)
        .where(
          and(
            eq(alertAcks.clinicId, clinicId),
            eq(alertAcks.ackStatus, "SEEN"),
          ),
        )
    : [];

  // 4. Unresolved emergency dispenses per patient
  const emergencyRows = animalIds.length
    ? await db
        .select({ id: dispenseEvents.id, patientId: dispenseEvents.patientId, createdAt: dispenseEvents.createdAt })
        .from(dispenseEvents)
        .where(
          and(
            eq(dispenseEvents.clinicId, clinicId),
            eq(dispenseEvents.status, "EMERGENCY_PENDING"),
            inArray(dispenseEvents.patientId, animalIds),
          ),
        )
    : [];

  // Group everything by animalId
  const tasksByAnimal = new Map<string, typeof medTaskRows>();
  for (const t of medTaskRows) {
    if (!t.animalId) continue;
    const arr = tasksByAnimal.get(t.animalId) ?? [];
    arr.push(t);
    tasksByAnimal.set(t.animalId, arr);
  }

  const emergenciesByAnimal = new Map<string, typeof emergencyRows>();
  for (const e of emergencyRows) {
    if (!e.patientId) continue;
    const arr = emergenciesByAnimal.get(e.patientId) ?? [];
    arr.push(e);
    emergenciesByAnimal.set(e.patientId, arr);
  }

  const patients = hospRows.map(({ hosp, animal }) => {
    const tasks = tasksByAnimal.get(hosp.animalId) ?? [];
    const overdueCount = tasks.filter(
      (t) => t.dueAt && new Date(t.dueAt) < now,
    ).length;
    const emergencies = emergenciesByAnimal.get(hosp.animalId) ?? [];

    return {
      hospitalizationId: hosp.id,
      animalId: hosp.animalId,
      animalName: animal.name,
      status: hosp.status,
      ward: hosp.ward,
      bay: hosp.bay,
      pendingMedicationTasks: tasks.map((t) => ({
        id: t.id,
        status: t.status,
        drugId: t.drugId,
        dueAt: t.dueAt?.toISOString() ?? null,
      })),
      overdueMedicationCount: overdueCount,
      activeAlerts: alertRows.map((a) => ({ alertType: a.alertType, ackStatus: a.ackStatus })),
      unresolvedEmergencyDispenses: emergencies.map((e) => ({
        id: e.id,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  });

  const summaryCounts = {
    patientCount: patients.length,
    pendingTaskCount: patients.reduce((s, p) => s + p.pendingMedicationTasks.length, 0),
    overdueCount: patients.reduce((s, p) => s + p.overdueMedicationCount, 0),
    unresolvedEmergencyCount: patients.reduce((s, p) => s + p.unresolvedEmergencyDispenses.length, 0),
  };

  return { patients, summaryCounts };
}

// ─── Fix A: GET /api/shift-handover/patients ─────────────────────────────────
// Patient-centric handover view — current hospitalization state with tasks,
// overdue medications, alerts, and unresolved emergencies per patient.

router.get("/patients", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { patients, summaryCounts } = await buildPatientHandoverPayload(clinicId);
    res.json({ patients, summaryCounts, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[shift-handover] patients endpoint failed", err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "HANDOVER_PATIENTS_FAILED", message: "Failed to load patient handover data", requestId }),
    );
  }
});

// ─── Fix C: GET /api/shift-handover/snapshot — latest persisted snapshot ─────
router.get("/snapshot/latest", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const [row] = await db
      .select()
      .from(shiftHandoverSnapshots)
      .where(eq(shiftHandoverSnapshots.clinicId, clinicId))
      .orderBy(desc(shiftHandoverSnapshots.generatedAt))
      .limit(1);
    if (!row) {
      return res.status(404).json(
        apiError({ code: "NOT_FOUND", reason: "NO_SNAPSHOT", message: "No handover snapshot found for this clinic", requestId }),
      );
    }
    return res.json(row);
  } catch (err) {
    console.error("[shift-handover] snapshot/latest failed", err);
    return res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "SNAPSHOT_FAILED", message: "Failed to load handover snapshot", requestId }),
    );
  }
});

export default router;
