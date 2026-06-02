import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

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

/** Advisory-only stub — full LLM wiring is out of PR17 scope without provider keys. */
router.post("/:id/copilot/explain", (_req, res) => {
  res.status(501).json({
    code: "NOT_IMPLEMENTED",
    error: "NOT_IMPLEMENTED",
    reason: "COPILOT_ADVISORY_STUB",
    message: "Copilot explain is not wired in this environment",
  });
});

export default router;
