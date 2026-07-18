/**
 * R-SH-F1.5 — Shift-handover surface routes (`/api/shift-handover`).
 *
 *   GET    /current            — the current (latest) handover artifact for the
 *                                caller's clinic (the `/handoff` read path).
 *   POST   /:id/acknowledge    — records the actor + flips `notificationReadAt`
 *                                → read; returns the updated artifact.
 *   DELETE /:id/acknowledge    — persisted UNCONFIRM: clears the ack + restores
 *                                `notificationReadAt` → null; returns the updated
 *                                artifact and writes its own audit row.
 *
 * `clinicId` is always derived from the authenticated context (`req.authUser`),
 * never from request input. There is NO public generate route in v1 — generation
 * is system-derived (the shift-end scheduler). Errors go through the i18n-aware
 * `apiError()` envelope (per-locale). Every service read/write carries an
 * explicit `clinicId` predicate.
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { apiError } from "../lib/apiError.js";
import { resolveAuditActorRole } from "../lib/audit.js";
import {
  acknowledgeHandover,
  unconfirmHandover,
  getLatestHandoverForClinic,
  serializeHandoverArtifact,
  ShiftHandoverAccessError,
  ShiftHandoverNotFoundError,
} from "../services/shift-handover.service.js";

const router = Router();

function mapError(req: Request, res: Response, err: unknown): Response {
  if (err instanceof ShiftHandoverNotFoundError) {
    return apiError(req, res, "errors.notFound", undefined, 404);
  }
  if (err instanceof ShiftHandoverAccessError) {
    return apiError(req, res, "errors.authority.denied", undefined, 403);
  }
  console.error("[shift-handover] route error", err);
  return apiError(req, res, "errors.generic", undefined, 500);
}

router.get("/current", requireAuth, async (req: Request, res: Response) => {
  const { clinicId } = req.authUser!;
  try {
    const row = await getLatestHandoverForClinic(clinicId);
    const handover = row ? await serializeHandoverArtifact(clinicId, row) : null;
    return res.json({ handover });
  } catch (err) {
    return mapError(req, res, err);
  }
});

router.post("/:id/acknowledge", requireAuth, async (req: Request, res: Response) => {
  const { id: userId, email, clinicId } = req.authUser!;
  const actorRole = resolveAuditActorRole({ effectiveRole: req.effectiveRole, authUser: req.authUser });
  try {
    const row = await acknowledgeHandover({
      clinicId,
      handoverId: req.params.id!,
      actorUserId: userId,
      actorEmail: email,
      actorRole,
    });
    const handover = await serializeHandoverArtifact(clinicId, row);
    return res.json({ handover });
  } catch (err) {
    return mapError(req, res, err);
  }
});

router.delete("/:id/acknowledge", requireAuth, async (req: Request, res: Response) => {
  const { id: userId, email, clinicId } = req.authUser!;
  const actorRole = resolveAuditActorRole({ effectiveRole: req.effectiveRole, authUser: req.authUser });
  try {
    const row = await unconfirmHandover({
      clinicId,
      handoverId: req.params.id!,
      actorUserId: userId,
      actorEmail: email,
      actorRole,
    });
    const handover = await serializeHandoverArtifact(clinicId, row);
    return res.json({ handover });
  } catch (err) {
    return mapError(req, res, err);
  }
});

export default router;
