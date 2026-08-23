import type { RequestHandler } from "express";
import { seedDefaultContainersIfEmpty } from "../../../lib/ensure-clinic-phase2-defaults.js";
import { apiError, resolveRequestId } from "../../../lib/route-utils.js";

/** POST /api/containers/bootstrap-defaults */
export const postContainerBootstrapDefaultsHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const inserted = await seedDefaultContainersIfEmpty(clinicId);
    res.json({ inserted });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "CONTAINERS_BOOTSTRAP_FAILED",
        message: "Failed to seed default containers",
        requestId,
      }),
    );
  }
};
