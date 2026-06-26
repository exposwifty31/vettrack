import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { inferEquipmentLocation } from "../services/equipment-location-inference.js";
import { apiError } from "../lib/apiError.js";

const router = Router();

router.get("/:id/location-inference", requireAuth, async (req, res) => {
  const clinicId = req.clinicId;
  const equipmentId = req.params.id?.trim();

  if (!clinicId) {
    return apiError(req, res, "errors.er.notAuthenticated", undefined, 401);
  }

  if (!equipmentId) {
    return apiError(req, res, "errors.inference.idRequired", undefined, 400);
  }

  try {
    const result = await inferEquipmentLocation(
      equipmentId,
      clinicId,
      req.authUser?.id ?? "system",
      req.authUser?.email ?? "system",
    );

    if (!result) {
      return apiError(req, res, "errors.inference.notFound", undefined, 404);
    }

    return res.json(result);
  } catch (err) {
    console.error("[equipment-inference] location-inference failed", {
      equipmentId,
      clinicId,
      err: err instanceof Error ? err.message : err,
    });
    return apiError(req, res, "errors.inference.unavailable", undefined, 500);
  }
});

Object.assign(router, { _vtRouterId: "equipment-inference" });

export default router;
