import { Router } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db, supportTickets } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { requireClinicId } from "../middleware/tenant-context.js";
import { validateBody, validateUuid } from "../middleware/validate.js";
import { authSensitiveLimiter } from "../middleware/rate-limiters.js";
import { logAudit } from "../lib/audit.js";
import {
  CursorBugFixerError,
  dispatchCursorBugFixer,
  getCursorBugFixerAgent,
  getCursorBugFixerConfig,
  getCursorBugFixerRun,
  isCursorBugFixerEnabled,
} from "../services/cursor-bug-fixer.service.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";

const router = Router();

function mapServiceError(err: unknown): { status: number; reason: string; message: string } {
  if (err instanceof CursorBugFixerError) {
    switch (err.code) {
      case "DISABLED":
        return { status: 404, reason: "CURSOR_BUG_FIXER_DISABLED", message: err.message };
      case "NOT_CONFIGURED":
      case "MISSING_REPO":
        return { status: 503, reason: err.code, message: err.message };
      case "INVALID_REPORT":
        return { status: 400, reason: err.code, message: err.message };
      case "CURSOR_API_ERROR":
        return { status: 502, reason: err.code, message: err.message };
      default:
        return { status: 500, reason: "CURSOR_BUG_FIXER_ERROR", message: err.message };
    }
  }
  return {
    status: 500,
    reason: "CURSOR_BUG_FIXER_ERROR",
    message: err instanceof Error ? err.message : "Unknown error",
  };
}

function requireBugFixerEnabled(
  _req: Parameters<typeof requireAuth>[0],
  res: import("express").Response,
  next: () => void,
) {
  if (!isCursorBugFixerEnabled()) {
    return res.status(404).json({
      code: "NOT_FOUND",
      error: "NOT_FOUND",
      reason: "CURSOR_BUG_FIXER_DISABLED",
      message: "Cursor bug fixer is not enabled",
    });
  }
  next();
}

const dispatchSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(20_000),
  severity: z.enum(["low", "medium", "high"]).optional(),
  pageUrl: z.string().max(1000).optional().nullable(),
  deviceInfo: z.string().max(5000).optional().nullable(),
  appVersion: z.string().max(100).optional().nullable(),
  context: z.string().max(50_000).optional().nullable(),
  supportTicketId: z.string().uuid().optional().nullable(),
});

router.use(requireAuth);
router.use(requireAdmin);
router.use(requireBugFixerEnabled);

router.get("/config", (_req, res) => {
  res.json(getCursorBugFixerConfig());
});

router.post(
  "/dispatch",
  authSensitiveLimiter,
  validateBody(dispatchSchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    const clinicId = requireClinicId(req);
    try {
      const body = req.body as z.infer<typeof dispatchSchema>;
      const result = await dispatchCursorBugFixer({
        ...body,
        source: "manual",
      });

      void logAudit({
        clinicId,
        actionType: "cursor_bug_fixer_dispatched",
        performedBy: req.authUser!.id,
        performedByEmail: req.authUser!.email,
        targetId: body.supportTicketId ?? result.agentId,
        targetType: "support_ticket",
        metadata: {
          agentId: result.agentId,
          runId: result.runId,
          agentUrl: result.agentUrl,
          title: body.title,
          source: "manual",
        },
      });

      res.status(202).json(result);
    } catch (err) {
      const mapped = mapServiceError(err);
      res.status(mapped.status).json(
        apiError({
          code: mapped.reason,
          reason: mapped.reason,
          message: mapped.message,
          requestId,
        }),
      );
    }
  },
);

router.post(
  "/support-tickets/:id/dispatch",
  authSensitiveLimiter,
  validateUuid("id"),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    const clinicId = requireClinicId(req);
    try {
      const [ticket] = await db
        .select()
        .from(supportTickets)
        .where(
          and(eq(supportTickets.id, req.params.id), eq(supportTickets.clinicId, clinicId)),
        )
        .limit(1);

      if (!ticket) {
        return res.status(404).json(
          apiError({
            code: "NOT_FOUND",
            reason: "SUPPORT_TICKET_NOT_FOUND",
            message: "Support ticket not found",
            requestId,
          }),
        );
      }

      const result = await dispatchCursorBugFixer({
        title: ticket.title,
        description: ticket.description,
        severity: ticket.severity as "low" | "medium" | "high",
        pageUrl: ticket.pageUrl,
        deviceInfo: ticket.deviceInfo,
        appVersion: ticket.appVersion,
        supportTicketId: ticket.id,
        source: "support_ticket",
      });

      const agentNote = `[Cursor agent ${result.agentId}] ${result.agentUrl}`;
      const mergedNote = ticket.adminNote
        ? `${ticket.adminNote}\n${agentNote}`
        : agentNote;

      await db
        .update(supportTickets)
        .set({
          status: ticket.status === "open" ? "in_progress" : ticket.status,
          adminNote: mergedNote,
          updatedAt: new Date(),
        })
        .where(
          and(eq(supportTickets.id, ticket.id), eq(supportTickets.clinicId, clinicId)),
        );

      void logAudit({
        clinicId,
        actionType: "cursor_bug_fixer_dispatched",
        performedBy: req.authUser!.id,
        performedByEmail: req.authUser!.email,
        targetId: ticket.id,
        targetType: "support_ticket",
        metadata: {
          agentId: result.agentId,
          runId: result.runId,
          agentUrl: result.agentUrl,
          supportTicketId: ticket.id,
          source: "support_ticket",
        },
      });

      res.status(202).json({ ...result, supportTicketId: ticket.id });
    } catch (err) {
      const mapped = mapServiceError(err);
      res.status(mapped.status).json(
        apiError({
          code: mapped.reason,
          reason: mapped.reason,
          message: mapped.message,
          requestId,
        }),
      );
    }
  },
);

router.get("/agents/:agentId", async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const agent = await getCursorBugFixerAgent(req.params.agentId);
    res.json(agent);
  } catch (err) {
    const mapped = mapServiceError(err);
    res.status(mapped.status).json(
      apiError({
        code: mapped.reason,
        reason: mapped.reason,
        message: mapped.message,
        requestId,
      }),
    );
  }
});

router.get("/agents/:agentId/runs/:runId", async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const agentId = req.params.agentId?.trim();
  const runId = req.params.runId?.trim();
  if (!agentId || !runId) {
    return res.status(400).json(
      apiError({
        code: "BAD_REQUEST",
        reason: "MISSING_AGENT_OR_RUN_ID",
        message: "agentId and runId are required",
        requestId,
      }),
    );
  }
  try {
    const run = await getCursorBugFixerRun(agentId, runId);
    res.json(run);
  } catch (err) {
    const mapped = mapServiceError(err);
    res.status(mapped.status).json(
      apiError({
        code: mapped.reason,
        reason: mapped.reason,
        message: mapped.message,
        requestId,
      }),
    );
  }
});

export default router;
