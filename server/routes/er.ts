import { Router } from "express";
import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db, erIntakeEvents, shiftHandoffs, users } from "../db.js";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { insertRealtimeDomainEvent } from "../lib/realtime-outbox.js";
import {
  clearAdmissionStateForUser,
  enterAdmissionState,
  exitAdmissionState,
  getAdmissionState,
} from "../services/er-admission-state.service.js";
import { applyGlobalErModeToggle } from "../lib/er-mode-toggle.js";
import { canManageErModeForUser } from "../lib/er-mode-permissions.js";
import { getClinicErModeState } from "../lib/er-mode.js";
import { ER_MODE_SSE_EVENT, registerErModeSseClient } from "../lib/er-mode-broadcaster.js";
import { createErIntakeSchema } from "../lib/er-intake-schema.js";
import type { ErKpiWindowDays, ErModeResponse, ErModeState } from "../../shared/er-types.js";
import { getErImpactSummary } from "../services/er-impact.service.js";
import { getErBoard } from "../services/er-board.service.js";
import { createErIntake, assignErIntake } from "../services/er-intake.service.js";
import { listErAssignees } from "../services/er-assignees.service.js";
import {
  ackErHandoffItem,
  createErHandoff,
  listErHandoffEligibleHospitalizations,
} from "../services/er-handoff.service.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import erAdminRoutes from "./er-admin.js";

const router = Router();
router.use(requireAuth);

const assignIntakeSchema = z.object({
  assignedUserId: z.string().trim().min(1),
});

const erModeActivateSchema = z.object({
  activate: z.boolean(),
});

const createHandoffSchema = z.object({
  hospitalizationId: z.string().trim().min(1),
  outgoingUserId: z.string().trim().min(1).optional().nullable(),
  items: z
    .array(
      z.object({
        // Structured Clinical Handoff — three mandatory artifact fields.
        currentStability: z.string().trim().min(1, "Current Stability is required").max(1000),
        pendingTasks: z.string().trim().min(1, "Pending Tasks is required").max(2000),
        criticalWarnings: z.string().trim().min(1, "Critical Warnings is required").max(1000),
        activeIssue: z.string().trim().min(1).max(2000),
        nextAction: z.string().trim().min(1).max(500),
        etaMinutes: z.number().int().min(0).max(2880),
        ownerUserId: z.string().trim().min(1).optional().nullable(),
      }),
    )
    .min(1),
});

const ackHandoffSchema = z.object({
  // Forced Ack Override — admin/vet must supply a non-empty reason for audit purposes.
  overrideReason: z.string().trim().min(1).max(500).optional(),
});

const acceptIntakeSchema = z.object({
  userId: z.string().trim().min(1).nullable(),
});

const enterAdmissionSchema = z.object({
  intakeEventId: z.string().trim().min(1),
});

const enrichIntakeSchema = z
  .object({
    animalId: z.string().trim().min(1).optional(),
    ownerName: z.string().trim().min(1).optional(),
  })
  .refine((d) => d.animalId !== undefined || d.ownerName !== undefined, {
    message: "At least one of animalId or ownerName is required",
  });

function apiError(params: { code: string; reason: string; message: string; requestId: string }) {
  return { error: params.code, reason: params.reason, message: params.message, requestId: params.requestId };
}

function resolveRequestId(res: Response, incoming: unknown): string {
  const incomingStr = typeof incoming === "string" ? incoming.trim() : "";
  const existing = res.getHeader("x-request-id");
  const fromRes = typeof existing === "string" ? existing.trim() : "";
  const requestId = incomingStr || fromRes || randomUUID();
  res.setHeader("x-request-id", requestId);
  return requestId;
}

function parseImpactWindow(raw: unknown): ErKpiWindowDays {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
  if (n === 7 || n === 14 || n === 30) return n;
  return 14;
}

function notImplemented(res: Response, requestId: string) {
  return res.status(501).json(
    apiError({
      code: "NOT_IMPLEMENTED",
      reason: "COMING_SOON",
      message: "This endpoint is not yet implemented",
      requestId,
    }),
  );
}

function requireAssignableRole(req: Request, res: Response, next: NextFunction): void {
  const r = req.authUser?.role ?? "";
  if (["admin", "vet", "senior_technician", "technician"].includes(r)) {
    next();
    return;
  }
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  res.status(403).json(
    apiError({
      code: "FORBIDDEN",
      reason: "INSUFFICIENT_ROLE",
      message: "Insufficient role for assignment",
      requestId,
    }),
  );
}

// ── GET /api/er/mode ──────────────────────────────────────────────────────────
router.get("/mode", async (req: Request, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.authUser!.clinicId;
    const state = await getClinicErModeState(clinicId);
    const body: ErModeResponse = { clinicId, state };
    res.status(200).json(body);
  } catch (err) {
    console.error("[er] GET /mode failed", err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ER_MODE_FETCH_FAILED",
        message: "Failed to fetch ER mode state",
        requestId,
      }),
    );
  }
});

/** Lightweight alias for clients reconnecting SSE — same payload as GET /mode. */
router.get("/status", async (req: Request, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.authUser!.clinicId;
    const state = await getClinicErModeState(clinicId);
    const body: ErModeResponse = { clinicId, state };
    res.status(200).json(body);
  } catch (err) {
    console.error("[er] GET /status failed", err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ER_MODE_FETCH_FAILED",
        message: "Failed to fetch ER mode state",
        requestId,
      }),
    );
  }
});

/**
 * SSE: pushes `ER_MODE_CHANGED` when operators toggle global ER mode.
 * Initial event repeats current state so new tabs align without waiting for a broadcast.
 */
function mountErModeSse(req: Request, res: Response): void {
  const clinicId = req.authUser!.clinicId;

  void (async () => {
    let state: ErModeState;
    try {
      state = await getClinicErModeState(clinicId);
    } catch (err) {
      console.error("[er] SSE initial snapshot failed", err);
      if (!res.headersSent) {
        res.status(500).end();
      }
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const hello = JSON.stringify({
      type: ER_MODE_SSE_EVENT,
      clinicId,
      state,
      at: new Date().toISOString(),
    });
    if (!safeWriteSse(res, `data: ${hello}\n\n`)) return;

    const detach = registerErModeSseClient(clinicId, res);
    const ping = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(ping);
      }
    }, 25_000);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(ping);
      detach();
    };
    req.once("close", cleanup);
    res.once("close", cleanup);
  })();
}

router.get("/events", mountErModeSse);
router.get("/stream", mountErModeSse);

function safeWriteSse(res: Response, chunk: string): boolean {
  try {
    res.write(chunk);
    return true;
  } catch {
    return false;
  }
}

router.use("/admin", erAdminRoutes);

router.patch("/mode", async (req: Request, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  if (!req.authUser || !canManageErModeForUser(req.authUser)) {
    return res.status(403).json(
      apiError({
        code: "FORBIDDEN",
        reason: "INSUFFICIENT_PRIVILEGE",
        message: "Insufficient privileges to manage ER mode",
        requestId,
      }),
    );
  }
  const parsed = erModeActivateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(
      apiError({
        code: "VALIDATION_ERROR",
        reason: "INVALID_BODY",
        message: parsed.error.message,
        requestId,
      }),
    );
  }
  try {
    const { erModeState } = await applyGlobalErModeToggle({
      clinicId: req.authUser.clinicId,
      activate: parsed.data.activate,
      actorId: req.authUser.id,
      actorEmail: req.authUser.email ?? "",
      actorRole: resolveAuditActorRole(req),
    });
    const body: ErModeResponse = { clinicId: req.authUser.clinicId, state: erModeState };
    return res.status(200).json(body);
  } catch (err) {
    console.error("[er] PATCH /mode failed", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ER_MODE_UPDATE_FAILED",
        message: "Failed to update ER mode",
        requestId,
      }),
    );
  }
});

router.get("/board", async (req: Request, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.authUser!.clinicId;
    const body = await getErBoard(clinicId);
    res.status(200).json(body);
  } catch (err) {
    console.error("[er] GET /board failed", err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ER_BOARD_FETCH_FAILED",
        message: "Failed to fetch ER board",
        requestId,
      }),
    );
  }
});

router.get("/assignees", async (req: Request, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.authUser!.clinicId;
    const body = await listErAssignees(clinicId);
    res.status(200).json(body);
  } catch (err) {
    console.error("[er] GET /assignees failed", err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ER_ASSIGNEES_FAILED",
        message: "Failed to list assignees",
        requestId,
      }),
    );
  }
});

router.post("/intake", async (req: Request, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const parsed = createErIntakeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(apiError({ code: "VALIDATION_ERROR", reason: "INVALID_BODY", message: parsed.error.message, requestId }));
    return;
  }
  try {
    const clinicId = req.authUser!.clinicId;
    const row = await createErIntake(clinicId, parsed.data);
    logAudit({
      clinicId,
      actionType: "er_intake_created",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email ?? "",
      targetId: row.id,
      targetType: "er_intake",
      actorRole: resolveAuditActorRole(req),
      metadata: { species: row.species, severity: row.severity },
    });
    res.status(201).json(row);
  } catch (err) {
    const code = err instanceof Error ? (err as Error & { code?: string }).code : undefined;
    if (code === "ANIMAL_NOT_IN_CLINIC") {
      res.status(400).json(apiError({ code: "BAD_REQUEST", reason: "ANIMAL_NOT_IN_CLINIC", message: "Animal not in clinic", requestId }));
      return;
    }
    console.error("[er] POST /intake failed", err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "ER_INTAKE_CREATE_FAILED", message: "Failed to create intake", requestId }),
    );
  }
});

router.patch("/intake/:id/assign", requireAssignableRole, async (req: Request, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const parsed = assignIntakeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(apiError({ code: "VALIDATION_ERROR", reason: "INVALID_BODY", message: parsed.error.message, requestId }));
    return;
  }
  try {
    const clinicId = req.authUser!.clinicId;
    const intakeId = req.params.id as string;
    const row = await assignErIntake(clinicId, intakeId, parsed.data.assignedUserId);
    logAudit({
      clinicId,
      actionType: "er_intake_assigned",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email ?? "",
      targetId: intakeId,
      targetType: "er_intake",
      actorRole: resolveAuditActorRole(req),
      metadata: { assignedUserId: parsed.data.assignedUserId },
    });
    res.status(200).json(row);
  } catch (err) {
    const code = err instanceof Error ? (err as Error & { code?: string }).code : undefined;
    if (code === "ASSIGNEE_NOT_FOUND") {
      res.status(404).json(apiError({ code: "NOT_FOUND", reason: "ASSIGNEE_NOT_FOUND", message: "Assignee not found", requestId }));
      return;
    }
    if (code === "INTAKE_NOT_FOUND") {
      res.status(404).json(apiError({ code: "NOT_FOUND", reason: "INTAKE_NOT_FOUND", message: "Intake not found", requestId }));
      return;
    }
    console.error("[er] PATCH intake assign failed", err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "ER_INTAKE_ASSIGN_FAILED", message: "Failed to assign intake", requestId }),
    );
  }
});

router.patch(
  "/intake/:id/accept",
  requireEffectiveRole("vet"),
  async (req: Request, res: Response) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    const clinicId = req.clinicId!;
    const { id } = req.params;

    const parsed = acceptIntakeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json(
          apiError({
            code: "VALIDATION_ERROR",
            reason: "INVALID_BODY",
            message: parsed.error.message,
            requestId,
          }),
        );
    }

    const { userId } = parsed.data;

    if (userId !== null) {
      const [acceptor] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.clinicId, clinicId)))
        .limit(1);
      if (!acceptor) {
        return res
          .status(404)
          .json(
            apiError({ code: "NOT_FOUND", reason: "USER_NOT_FOUND", message: "Accepting user not found in clinic", requestId }),
          );
      }
    }

    const [intake] = await db
      .select({ id: erIntakeEvents.id, status: erIntakeEvents.status })
      .from(erIntakeEvents)
      .where(and(eq(erIntakeEvents.id, id), eq(erIntakeEvents.clinicId, clinicId)))
      .limit(1);

    if (!intake) {
      return res
        .status(404)
        .json(
          apiError({ code: "NOT_FOUND", reason: "INTAKE_NOT_FOUND", message: "Intake not found", requestId }),
        );
    }

    if (!["waiting", "assigned"].includes(intake.status ?? "")) {
      return res
        .status(409)
        .json(
          apiError({
            code: "CONFLICT",
            reason: "INVALID_STATUS_FOR_ACCEPT",
            message: "Intake must be waiting or assigned to accept",
            requestId,
          }),
        );
    }

    await db
      .update(erIntakeEvents)
      .set({ acceptedByUserId: userId, updatedAt: new Date() })
      .where(and(eq(erIntakeEvents.id, id), eq(erIntakeEvents.clinicId, clinicId)));

    await insertRealtimeDomainEvent(db as Parameters<typeof insertRealtimeDomainEvent>[0], {
      clinicId,
      type: "er:intake:accepted",
      payload: { intakeId: id, acceptedByUserId: userId },
    });

    logAudit({
      clinicId,
      actionType: userId ? "er_intake_patient_accepted" : "er_intake_patient_accept_released",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email ?? "",
      targetId: id,
      targetType: "er_intake",
      metadata: { acceptedByUserId: userId },
    });

    return res.json({ id, acceptedByUserId: userId, updatedAt: new Date().toISOString() });
  },
);

router.post("/admission-state", requireEffectiveRole("vet"), async (req: Request, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const clinicId = req.clinicId!;
  const userId = req.authUser!.id;

  const parsed = enterAdmissionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json(
        apiError({
          code: "VALIDATION_ERROR",
          reason: "INVALID_BODY",
          message: parsed.error.message,
          requestId,
        }),
      );
  }

  const [intakeCheck] = await db
    .select({ id: erIntakeEvents.id })
    .from(erIntakeEvents)
    .where(and(eq(erIntakeEvents.id, parsed.data.intakeEventId), eq(erIntakeEvents.clinicId, clinicId)))
    .limit(1);

  if (!intakeCheck) {
    return res
      .status(404)
      .json(
        apiError({ code: "NOT_FOUND", reason: "INTAKE_NOT_FOUND", message: "Intake event not found", requestId }),
      );
  }

  const row = await enterAdmissionState(clinicId, userId, parsed.data.intakeEventId);

  await insertRealtimeDomainEvent(db as Parameters<typeof insertRealtimeDomainEvent>[0], {
    clinicId,
    type: "er:admission-state:entered",
    payload: { userId, intakeEventId: parsed.data.intakeEventId },
  });

  logAudit({
    clinicId,
    actionType: "er_admission_state_entered",
    performedBy: userId,
    performedByEmail: req.authUser!.email ?? "",
    targetId: parsed.data.intakeEventId,
    targetType: "er_intake",
  });

  return res.json({
    id: row.id,
    userId,
    intakeEventId: row.intakeEventId,
    enteredAt: row.enteredAt.toISOString(),
  });
});

router.delete("/admission-state", requireEffectiveRole("vet"), async (req: Request, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const clinicId = req.clinicId!;
  const userId = req.authUser!.id;

  const result = await exitAdmissionState(clinicId, userId);

  await insertRealtimeDomainEvent(db as Parameters<typeof insertRealtimeDomainEvent>[0], {
    clinicId,
    type: "er:admission-state:cleared",
    payload: { userId },
  });

  logAudit({
    clinicId,
    actionType: "er_admission_state_cleared",
    performedBy: userId,
    performedByEmail: req.authUser!.email ?? "",
    metadata: { manual: true },
  });

  return res.json({
    cleared: result.cleared,
    handoffDebtWarning: result.handoffDebtWarning,
    pendingCount: result.pendingCount,
  });
});

router.get("/admission-state", async (req: Request, res: Response) => {
  const clinicId = req.clinicId!;
  const userId = req.authUser!.id;
  const row = await getAdmissionState(clinicId, userId);

  if (!row) return res.json({ active: false, state: null });

  return res.json({
    active: true,
    state: {
      id: row.id,
      intakeEventId: row.intakeEventId,
      enteredAt: row.enteredAt.toISOString(),
    },
  });
});

router.post(
  "/intake/:id/admission-complete",
  requireEffectiveRole("vet"),
  async (req: Request, res: Response) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    const clinicId = req.clinicId!;
    const userId = req.authUser!.id;
    const { id } = req.params;

    const [intake] = await db
      .select({
        id: erIntakeEvents.id,
        status: erIntakeEvents.status,
        assignedUserId: erIntakeEvents.assignedUserId,
        animalId: erIntakeEvents.animalId,
      })
      .from(erIntakeEvents)
      .where(and(eq(erIntakeEvents.id, id), eq(erIntakeEvents.clinicId, clinicId)))
      .limit(1);

    if (!intake) {
      return res
        .status(404)
        .json(
          apiError({ code: "NOT_FOUND", reason: "INTAKE_NOT_FOUND", message: "Intake not found", requestId }),
        );
    }

    await db
      .update(erIntakeEvents)
      .set({ status: "admission_complete", updatedAt: new Date() })
      .where(and(eq(erIntakeEvents.id, id), eq(erIntakeEvents.clinicId, clinicId)));

    await clearAdmissionStateForUser(clinicId, userId);

    if (intake.assignedUserId) {
      await insertRealtimeDomainEvent(db as Parameters<typeof insertRealtimeDomainEvent>[0], {
        clinicId,
        type: "er:admission-complete:notify-staff",
        payload: { intakeId: id, notifyUserId: intake.assignedUserId },
      });
    }

    await insertRealtimeDomainEvent(db as Parameters<typeof insertRealtimeDomainEvent>[0], {
      clinicId,
      type: "er:intake:admission-complete",
      payload: { intakeId: id, completedByUserId: userId },
    });

    const handoffRows = await db
      .select({ id: shiftHandoffs.id })
      .from(shiftHandoffs)
      .where(
        and(
          eq(shiftHandoffs.clinicId, clinicId),
          eq(shiftHandoffs.outgoingUserId, userId),
          sql`${shiftHandoffs.status} != 'cancelled'`,
        ),
      )
      .limit(1);
    const handoffPending = handoffRows.length === 0;

    logAudit({
      clinicId,
      actionType: "er_intake_admission_complete",
      performedBy: userId,
      performedByEmail: req.authUser!.email ?? "",
      targetId: id,
      targetType: "er_intake",
      metadata: { handoffPending },
    });

    return res.json({
      id,
      status: "admission_complete",
      handoffPending,
      completedAt: new Date().toISOString(),
    });
  },
);

router.patch(
  "/intake/:id/enrich",
  requireEffectiveRole("vet"),
  async (req: Request, res: Response) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    const clinicId = req.clinicId!;
    const { id } = req.params;

    const parsed = enrichIntakeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json(
          apiError({
            code: "VALIDATION_ERROR",
            reason: "INVALID_BODY",
            message: parsed.error.message,
            requestId,
          }),
        );
    }

    const [intake] = await db
      .select({ id: erIntakeEvents.id })
      .from(erIntakeEvents)
      .where(and(eq(erIntakeEvents.id, id), eq(erIntakeEvents.clinicId, clinicId)))
      .limit(1);

    if (!intake) {
      return res
        .status(404)
        .json(
          apiError({ code: "NOT_FOUND", reason: "INTAKE_NOT_FOUND", message: "Intake not found", requestId }),
        );
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.animalId !== undefined) updates.animalId = parsed.data.animalId;
    if (parsed.data.ownerName !== undefined) updates.ownerName = parsed.data.ownerName;

    await db
      .update(erIntakeEvents)
      .set(updates)
      .where(and(eq(erIntakeEvents.id, id), eq(erIntakeEvents.clinicId, clinicId)));

    await insertRealtimeDomainEvent(db as Parameters<typeof insertRealtimeDomainEvent>[0], {
      clinicId,
      type: "er:intake:enriched",
      payload: {
        intakeId: id,
        animalId: parsed.data.animalId ?? null,
        ownerName: parsed.data.ownerName ?? null,
      },
    });

    logAudit({
      clinicId,
      actionType: "er_intake_enriched",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email ?? "",
      targetId: id,
      targetType: "er_intake",
      metadata: { animalId: parsed.data.animalId, ownerName: parsed.data.ownerName },
    });

    return res.json({ id, enrichedAt: new Date().toISOString() });
  },
);

router.get("/handoffs/eligible-hospitalizations", requireAssignableRole, async (req: Request, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.authUser!.clinicId;
    const hospitalizations = await listErHandoffEligibleHospitalizations(clinicId);
    res.status(200).json({ hospitalizations });
  } catch (err) {
    console.error("[er] GET eligible hospitalizations failed", err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ER_ELIGIBLE_HOSP_FAILED",
        message: "Failed to list eligible hospitalizations",
        requestId,
      }),
    );
  }
});

router.post("/handoffs", requireAssignableRole, async (req: Request, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const parsed = createHandoffSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(apiError({ code: "VALIDATION_ERROR", reason: "INVALID_BODY", message: parsed.error.message, requestId }));
    return;
  }
  try {
    const clinicId = req.authUser!.clinicId;
    const row = await createErHandoff(clinicId, req.authUser!.id, parsed.data);
    await clearAdmissionStateForUser(clinicId, req.authUser!.id);
    logAudit({
      clinicId,
      actionType: "er_handoff_created",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email ?? "",
      targetId: row.id,
      targetType: "shift_handoff",
      actorRole: resolveAuditActorRole(req),
      metadata: { hospitalizationId: row.hospitalizationId, itemCount: row.itemIds.length },
    });
    res.status(201).json(row);
  } catch (err) {
    const code = err instanceof Error ? (err as Error & { code?: string }).code : undefined;
    if (code === "HOSPITALIZATION_NOT_FOUND") {
      res.status(404).json(apiError({ code: "NOT_FOUND", reason: "HOSPITALIZATION_NOT_FOUND", message: "Hospitalization not found", requestId }));
      return;
    }
    console.error("[er] POST /handoffs failed", err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "ER_HANDOFF_CREATE_FAILED", message: "Failed to create handoff", requestId }),
    );
  }
});

router.post("/handoffs/:id/ack", async (req: Request, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const parsed = ackHandoffSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json(apiError({ code: "VALIDATION_ERROR", reason: "INVALID_BODY", message: parsed.error.message, requestId }));
    return;
  }
  try {
    const clinicId = req.authUser!.clinicId;
    const itemId = req.params.id as string;
    const row = await ackErHandoffItem(clinicId, { id: req.authUser!.id, role: req.authUser!.role }, itemId, parsed.data);
    const isOverride = Boolean(parsed.data.overrideReason?.trim());
    logAudit({
      clinicId,
      actionType: isOverride ? "er_handoff_forced_ack_override" : "er_handoff_acknowledged",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email ?? "",
      targetId: itemId,
      targetType: "shift_handoff_item",
      actorRole: resolveAuditActorRole(req),
      metadata: isOverride
        ? { overrideReason: parsed.data.overrideReason, forcedAckOverride: true }
        : {},
    });
    res.status(200).json(row);
  } catch (err) {
    const code = err instanceof Error ? (err as Error & { code?: string }).code : undefined;
    if (code === "HANDOFF_ITEM_NOT_FOUND") {
      res.status(404).json(apiError({ code: "NOT_FOUND", reason: "HANDOFF_ITEM_NOT_FOUND", message: "Handoff item not found", requestId }));
      return;
    }
    if (code === "ALREADY_ACKNOWLEDGED") {
      res.status(409).json(apiError({ code: "CONFLICT", reason: "ALREADY_ACKNOWLEDGED", message: "Already acknowledged", requestId }));
      return;
    }
    if (code === "ACK_DENIED") {
      res.status(403).json(apiError({ code: "FORBIDDEN", reason: "ACK_DENIED", message: "Cannot acknowledge", requestId }));
      return;
    }
    console.error("[er] POST handoffs ack failed", err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "ER_HANDOFF_ACK_FAILED", message: "Failed to acknowledge handoff", requestId }),
    );
  }
});

router.get("/queue", async (req: Request, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  return notImplemented(res, requestId);
});

router.get("/impact", async (req: Request, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.authUser!.clinicId;
    const windowDays = parseImpactWindow(req.query.window);
    const body = await getErImpactSummary(clinicId, windowDays);
    res.status(200).json(body);
  } catch (err) {
    console.error("[er] GET /impact failed", err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ER_IMPACT_FETCH_FAILED",
        message: "Failed to fetch ER impact metrics",
        requestId,
      }),
    );
  }
});

export default router;
