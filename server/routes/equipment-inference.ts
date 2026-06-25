import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { inferEquipmentLocation } from "../services/equipment-location-inference.js";

const router = Router();

router.get("/:id/location-inference", requireAuth, async (req, res) => {
  const clinicId = req.clinicId;
  const equipmentId = req.params.id?.trim();

  if (!clinicId) {
    return res.status(401).json({ code: "UNAUTHORIZED", error: "UNAUTHORIZED", message: "Unauthorized" });
  }

  if (!equipmentId) {
    return res.status(400).json({ code: "BAD_REQUEST", error: "BAD_REQUEST", message: "Equipment id is required" });
  }

  try {
    const result = await inferEquipmentLocation(
      equipmentId,
      clinicId,
      req.authUser?.id ?? "system",
      req.authUser?.email ?? "system",
    );

    if (!result) {
      return res.status(404).json({
        code: "NOT_FOUND",
        error: "NOT_FOUND",
        message: "Equipment not found",
      });
    }

    return res.json(result);
  } catch (err) {
    console.error("[equipment-inference] location-inference failed", {
      equipmentId,
      clinicId,
      err: err instanceof Error ? err.message : err,
    });
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      error: "INTERNAL_ERROR",
      message: "Could not infer equipment location",
    });
  }
});

export default router;
