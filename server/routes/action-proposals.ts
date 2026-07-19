/**
 * Task 0.3 spike — minimal approval route for staged action-proposals.
 *
 * NOT mounted in `server/app/routes.ts` — the spike's verification checklist
 * (see spike findings §9) requires the diff on pre-existing files to be
 * exactly: the `export` keyword in `shift-handover-generator.ts`, the
 * `AuditActionType` union addition in `audit.ts`, and the worker-registration
 * line in `start-schedulers.ts`. Mounting this route would add a fourth
 * touched pre-existing file (`server/app/routes.ts`), so it is left as a
 * standalone, typechecking-but-unmounted Router — proving the route SHAPE
 * (auth middleware, clinicId scoping, request/response contract) without
 * widening the diff. Task 1.1 mounts it for real.
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";
import { DrizzleActionProposalWriter } from "../lib/autopilot/action-proposal-writer.port.js";
import { approveProposal, editProposal, rejectProposal } from "../lib/autopilot/action-proposal-service.js";
import type { ActionProposalDraftContent } from "../lib/autopilot/action-proposal-types.js";

const router = Router();
const writer = new DrizzleActionProposalWriter();

function requireAuthContext(
  req: Request,
  res: Response,
  requestId: string,
): { authUserId: string; clinicId: string } | null {
  const authUser = req.authUser;
  const clinicId = req.clinicId?.trim();
  if (!authUser?.id || !clinicId) {
    res.status(401).json(apiError({ code: "UNAUTHORIZED", reason: "MISSING_AUTH_USER", message: "Unauthorized", requestId }));
    return null;
  }
  return { authUserId: authUser.id, clinicId };
}

/** POST /api/action-proposals/:id/approve */
router.post("/:id/approve", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const ctx = requireAuthContext(req, res, requestId);
  if (!ctx) return;
  try {
    const updated = await approveProposal({
      clinicId: ctx.clinicId,
      proposalId: req.params.id,
      decidedByUserId: ctx.authUserId,
      writer,
    });
    return res.json({ proposal: updated });
  } catch (err) {
    return res
      .status(409)
      .json(apiError({ code: "CONFLICT", reason: "NOT_STAGED", message: err instanceof Error ? err.message : "approve failed", requestId }));
  }
});

/** POST /api/action-proposals/:id/edit  body: { editedContent } */
router.post("/:id/edit", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const ctx = requireAuthContext(req, res, requestId);
  if (!ctx) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const editedContent = body.editedContent as ActionProposalDraftContent | undefined;
  if (!editedContent || typeof editedContent !== "object") {
    return res
      .status(400)
      .json(apiError({ code: "VALIDATION_FAILED", reason: "MISSING_EDITED_CONTENT", message: "editedContent is required", requestId }));
  }
  try {
    const updated = await editProposal({
      clinicId: ctx.clinicId,
      proposalId: req.params.id,
      decidedByUserId: ctx.authUserId,
      editedContent,
      writer,
    });
    return res.json({ proposal: updated });
  } catch (err) {
    return res
      .status(409)
      .json(apiError({ code: "CONFLICT", reason: "NOT_STAGED", message: err instanceof Error ? err.message : "edit failed", requestId }));
  }
});

/** POST /api/action-proposals/:id/reject  body: { rejectionReason } */
router.post("/:id/reject", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const ctx = requireAuthContext(req, res, requestId);
  if (!ctx) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const rejectionReason = typeof body.rejectionReason === "string" ? body.rejectionReason.trim() : "";
  if (!rejectionReason) {
    return res
      .status(400)
      .json(apiError({ code: "VALIDATION_FAILED", reason: "MISSING_REASON", message: "rejectionReason is required", requestId }));
  }
  try {
    const updated = await rejectProposal({
      clinicId: ctx.clinicId,
      proposalId: req.params.id,
      decidedByUserId: ctx.authUserId,
      rejectionReason,
      writer,
    });
    return res.json({ proposal: updated });
  } catch (err) {
    return res
      .status(409)
      .json(apiError({ code: "CONFLICT", reason: "NOT_STAGED", message: err instanceof Error ? err.message : "reject failed", requestId }));
  }
});

export default router;
