import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { apiError } from "../lib/apiError.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import {
  getReadinessRulesWithMeta,
  updateReadinessRules,
} from "../services/equipment-readiness-rules.service.js";
import {
  MIN_STALE_EVIDENCE_MS,
  MAX_STALE_EVIDENCE_MS,
} from "../../shared/equipment-readiness-rules.js";

const router = Router();

/** Only `staleEvidenceMs` is editable in 7c v1; `minimumReadyByType` is read-only display. */
const PatchSchema = z
  .object({
    staleEvidenceMs: z.number().int().min(MIN_STALE_EVIDENCE_MS).max(MAX_STALE_EVIDENCE_MS),
  })
  .strict();

/**
 * GET /api/admin/equipment/readiness-rules
 * Authoritative (cache-bypassing) clinic readiness policy for the governance console.
 */
router.get("/equipment/readiness-rules", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const clinicId = req.clinicId?.trim();
  if (!clinicId) return apiError(req, res, "errors.generic", undefined, 400);
  try {
    const { rules, updatedAt } = await getReadinessRulesWithMeta(clinicId);
    res.status(200).json({ clinicId, rules, updatedAt });
  } catch (err) {
    console.error("[admin-equipment-governance] get failed", err);
    return apiError(req, res, "errors.generic", undefined, 500);
  }
});

/**
 * PATCH /api/admin/equipment/readiness-rules
 * Guarded write of `staleEvidenceMs`. Preserves `minimumReadyByType`, clears the
 * clinic's rules cache, and audits the change (fire-and-forget).
 */
router.patch("/equipment/readiness-rules", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const clinicId = req.clinicId?.trim();
  if (!clinicId) return apiError(req, res, "errors.generic", undefined, 400);

  const parsed = PatchSchema.safeParse(req.body);
  if (!parsed.success) return apiError(req, res, "errors.validation", undefined, 400);

  try {
    const rules = await updateReadinessRules(clinicId, { staleEvidenceMs: parsed.data.staleEvidenceMs });
    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "equipment_readiness_rules_updated",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetType: "equipment_readiness_config",
      metadata: { staleEvidenceMs: rules.staleEvidenceMs },
    });
    res.status(200).json({ clinicId, rules });
  } catch (err) {
    console.error("[admin-equipment-governance] patch failed", err);
    return apiError(req, res, "errors.generic", undefined, 500);
  }
});

export default router;
