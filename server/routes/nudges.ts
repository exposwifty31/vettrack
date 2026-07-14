import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { apiError, resolveRequestId } from "../lib/route-utils.js";
import { computeNudgesForUser } from "../services/nudge-feed.service.js";

const router = Router();

// GET /api/nudges — role-scoped nudge feed (T-30a1-i · R-IN-F1 · small-03).
// Compute-on-read: expiryCheckWorker runs in a separate process from the API,
// so nudges are derived fresh from existing clinicId-scoped rows on every
// request instead of being pushed into a store. No new table, no worker
// wiring — see server/services/nudge-feed.service.ts for the architecture
// note. clinicId + role come from the auth context, never the request.
router.get("/", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const clinicId = req.clinicId;
  const role = req.authUser?.role;

  if (!clinicId || !role) {
    res.status(401).json(
      apiError({
        code: "UNAUTHORIZED",
        reason: "UNAUTHORIZED",
        message: "Unauthorized",
        requestId,
      }),
    );
    return;
  }

  try {
    const nudges = await computeNudgesForUser(clinicId, role);
    res.json({ nudges });
  } catch (err) {
    console.error("[nudges] compute failed", {
      at: new Date().toISOString(),
      clinicId,
      errorName: err instanceof Error ? err.name : "UnknownError",
    });
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "NUDGES_COMPUTE_FAILED",
        message: "Could not compute nudges",
        requestId,
      }),
    );
  }
});

export default router;
