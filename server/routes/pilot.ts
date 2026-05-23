import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { getPilotStaleMs, setPilotStaleMs, PILOT_STALE_MS_DEFAULT } from "../lib/pilot-config.js";
import { logAudit } from "../lib/audit.js";

const router = Router();

const ONE_HOUR_MS = 60 * 60 * 1000;
const MAX_STALE_MS = 7 * 24 * ONE_HOUR_MS; // 7 days

const patchConfigSchema = z.object({
  staleMs: z
    .number()
    .int()
    .min(ONE_HOUR_MS, "Minimum 1 hour")
    .max(MAX_STALE_MS, "Maximum 7 days"),
});

router.get("/config", requireAuth, requireAdmin, async (req, res) => {
  const staleMs = await getPilotStaleMs();
  res.json({ staleMs, default: PILOT_STALE_MS_DEFAULT });
});

router.patch("/config", requireAuth, requireAdmin, validateBody(patchConfigSchema), async (req, res) => {
  const { staleMs } = req.body as z.infer<typeof patchConfigSchema>;
  await setPilotStaleMs(staleMs);
  logAudit({
    clinicId: req.clinicId!,
    performedBy: req.authUser!.id,
    performedByEmail: req.authUser!.email,
    actionType: "pilot_config_updated",
    targetType: "server_config",
    targetId: "pilot_stale_ms",
    metadata: { staleMs },
  });
  res.json({ staleMs });
});

export default router;
