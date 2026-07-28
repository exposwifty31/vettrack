/**
 * VetTrack 2.0, Task 1.1 §1.6 — Shift Autopilot approval-queue route
 * (`/api/action-proposals`). Kind-agnostic: serves all 4 proposal kinds
 * (§2–§5) through the shared writer/service.
 *
 *   GET  /            — list, paginated, filterable by status + kind.
 *   POST /:id/approve — flips status → approved.
 *   POST /:id/edit    — flips status → edited, persists editedContent.
 *   POST /:id/reject  — flips status → rejected, requires rejectionReason.
 *
 * `clinicId` is always derived from `req.authUser`, never from request
 * input. Errors go through the i18n-aware `apiError()` envelope. The three
 * decision endpoints are rate-limited (deliberate human actions, not a
 * high-frequency path).
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { actionProposalDecisionLimiter } from "../middleware/rate-limiters.js";
import { validateBody } from "../middleware/validate.js";
import { apiError } from "../lib/apiError.js";
import { resolveAuditActorRole } from "../lib/audit.js";
import { notifyProposalQueueChanged } from "../lib/realtime-collab/proposal-queue-nudge.js";
import {
  ACTION_PROPOSAL_KINDS,
  ACTION_PROPOSAL_STATUSES,
  approveActionProposalBodySchema,
  editActionProposalBodySchema,
  rejectActionProposalBodySchema,
  type ActionProposalKind,
  type ActionProposalStatus,
} from "../lib/autopilot/action-proposal-types.js";
import {
  ActionProposalAlreadyDecidedError,
  DrizzleActionProposalWriter,
} from "../lib/autopilot/action-proposal-writer.port.js";
import {
  ActionProposalNotFoundError,
  approveProposal,
  editProposal,
  rejectProposal,
} from "../lib/autopilot/action-proposal-service.js";

const router = Router();
const writer = new DrizzleActionProposalWriter();

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
// Offset cap: bounds per-request database work — a deep offset scan is a
// malformed or abusive request, not real pagination of a human-scale queue.
const MAX_LIST_OFFSET = 10_000;

function isActionProposalKind(value: unknown): value is ActionProposalKind {
  return typeof value === "string" && (ACTION_PROPOSAL_KINDS as readonly string[]).includes(value);
}

function isActionProposalStatus(value: unknown): value is ActionProposalStatus {
  return typeof value === "string" && (ACTION_PROPOSAL_STATUSES as readonly string[]).includes(value);
}

function mapError(req: Request, res: Response, err: unknown): Response {
  if (err instanceof ActionProposalNotFoundError) {
    return apiError(req, res, "errors.notFound", undefined, 404);
  }
  if (err instanceof ActionProposalAlreadyDecidedError) {
    return apiError(req, res, "errors.conflict", undefined, 409);
  }
  // Task 1.1 §4 (deliverable E) — per-kind edit-body Zod failure
  // (`ActionProposalEditValidationError`, `action-proposal-service.ts`).
  // Checked by `.name`, not `instanceof`: this route's unit test
  // (`tests/autopilot/action-proposals.routes.test.ts`) mocks the whole
  // `action-proposal-service.js` module and does not export this class —
  // an `instanceof` check against an `undefined` mocked export throws
  // instead of falling through to the generic 500 branch below.
  if (err instanceof Error && err.name === "ActionProposalEditValidationError") {
    return apiError(req, res, "errors.validation", undefined, 400);
  }
  console.error("[action-proposals] route error", err);
  return apiError(req, res, "errors.generic", undefined, 500);
}

router.get("/", requireAuth, async (req: Request, res: Response) => {
  // Non-null: requireAuth populates req.authUser before any handler runs
  // (server/middleware/auth.ts contract); same for every handler below.
  const { clinicId } = req.authUser!;
  const status = isActionProposalStatus(req.query.status) ? req.query.status : undefined;
  const kind = isActionProposalKind(req.query.kind) ? req.query.kind : undefined;

  const rawLimit = Number(req.query.limit);
  const rawOffset = Number(req.query.offset);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIST_LIMIT) : DEFAULT_LIST_LIMIT;
  const offset =
    Number.isInteger(rawOffset) && rawOffset >= 0 ? Math.min(rawOffset, MAX_LIST_OFFSET) : 0;

  try {
    const proposals = await writer.findStaged(clinicId, { status, kind, limit, offset });
    return res.json({ proposals });
  } catch (err) {
    return mapError(req, res, err);
  }
});

router.post(
  "/:id/approve",
  requireAuth,
  actionProposalDecisionLimiter,
  validateBody(approveActionProposalBodySchema),
  async (req: Request, res: Response) => {
    const { id: userId, email, clinicId } = req.authUser!; // requireAuth guarantees authUser
    const actorRole = resolveAuditActorRole({ effectiveRole: req.effectiveRole, authUser: req.authUser });
    try {
      const proposal = await approveProposal(
        { writer },
        // Non-null params.id: the /:id route shape guarantees it.
        { clinicId, proposalId: req.params.id!, actorUserId: userId, actorEmail: email, actorRole },
      );
      notifyProposalQueueChanged(clinicId); // Task 1.1 §1.5 — advisory, fire-and-forget
      return res.json({ proposal });
    } catch (err) {
      return mapError(req, res, err);
    }
  },
);

router.post(
  "/:id/edit",
  requireAuth,
  actionProposalDecisionLimiter,
  validateBody(editActionProposalBodySchema),
  async (req: Request, res: Response) => {
    const { id: userId, email, clinicId } = req.authUser!; // requireAuth guarantees authUser
    const actorRole = resolveAuditActorRole({ effectiveRole: req.effectiveRole, authUser: req.authUser });
    try {
      const proposal = await editProposal(
        { writer },
        {
          clinicId,
          proposalId: req.params.id!, // the /:id route shape guarantees params.id
          actorUserId: userId,
          actorEmail: email,
          actorRole,
          editedContent: req.body.editedContent,
        },
      );
      notifyProposalQueueChanged(clinicId); // Task 1.1 §1.5 — advisory, fire-and-forget
      return res.json({ proposal });
    } catch (err) {
      return mapError(req, res, err);
    }
  },
);

router.post(
  "/:id/reject",
  requireAuth,
  actionProposalDecisionLimiter,
  validateBody(rejectActionProposalBodySchema),
  async (req: Request, res: Response) => {
    const { id: userId, email, clinicId } = req.authUser!; // requireAuth guarantees authUser
    const actorRole = resolveAuditActorRole({ effectiveRole: req.effectiveRole, authUser: req.authUser });
    try {
      const proposal = await rejectProposal(
        { writer },
        {
          clinicId,
          proposalId: req.params.id!, // the /:id route shape guarantees params.id
          actorUserId: userId,
          actorEmail: email,
          actorRole,
          rejectionReason: req.body.rejectionReason,
        },
      );
      notifyProposalQueueChanged(clinicId); // Task 1.1 §1.5 — advisory, fire-and-forget
      return res.json({ proposal });
    } catch (err) {
      return mapError(req, res, err);
    }
  },
);

export default router;
