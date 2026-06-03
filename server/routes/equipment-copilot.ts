import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { writeLimiter } from "../middleware/rate-limiters.js";
import { explainEquipmentCopilot } from "../services/asset-copilot-orchestrator.service.js";

const router = Router();

function copilotDisabled(_req: Parameters<typeof requireAuth>[0], res: import("express").Response) {
  return res.status(404).json({
    code: "NOT_FOUND",
    error: "NOT_FOUND",
    reason: "COPILOT_DISABLED",
    message: "Asset copilot is not enabled",
  });
}

function requireCopilotEnabled(
  req: Parameters<typeof requireAuth>[0],
  res: import("express").Response,
  next: () => void,
) {
  if (process.env.ENABLE_ASSET_COPILOT?.trim() !== "true") {
    return copilotDisabled(req, res);
  }
  next();
}

router.use(requireAuth);
router.use(requireCopilotEnabled);

router.post("/:id/copilot/explain", writeLimiter, async (req, res) => {
  const clinicId = req.clinicId;
  const equipmentId = req.params.id?.trim();

  if (!clinicId) {
    return res.status(401).json({
      code: "UNAUTHORIZED",
      error: "UNAUTHORIZED",
      reason: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  }

  if (!equipmentId) {
    return res.status(400).json({
      code: "BAD_REQUEST",
      error: "BAD_REQUEST",
      reason: "MISSING_EQUIPMENT_ID",
      message: "Equipment id is required",
    });
  }

  try {
    const result = await explainEquipmentCopilot({
      clinicId,
      equipmentId,
      viewerUserId: req.authUser?.id,
    });

    if (result.answer.unknowns.includes("equipment_not_found")) {
      return res.status(404).json({
        code: "NOT_FOUND",
        error: "NOT_FOUND",
        reason: "EQUIPMENT_NOT_FOUND",
        message: "Equipment not found",
      });
    }

    return res.json(result);
  } catch (err) {
    console.error("[asset-copilot] explain failed", err);
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      error: "INTERNAL_ERROR",
      reason: "COPILOT_EXPLAIN_FAILED",
      message: "Could not generate copilot explanation",
    });
  }
});

export default router;
