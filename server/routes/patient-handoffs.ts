import { Router, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  cancelHandoff,
  createHandoff,
  getHandoffDetail,
  getMyHandoffs,
  listEligiblePatients,
  listEligibleStaff,
  reviewHandoff,
  submitHandoff,
  upsertItem,
} from "../services/patient-handoff.service.js";

const router = Router();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createHandoffSchema = z.object({
  receivingUserId: z.string().trim().min(1),
});

const upsertItemSchema = z
  .object({
    version: z.number().int().min(1).optional(),
    status: z.enum(["draft", "ready", "skipped"]).optional(),
    skipReason: z.string().trim().max(500).optional(),
    currentStability: z.string().trim().max(1000).optional(),
    pendingTasksNote: z.string().trim().max(2000).optional(),
    criticalWarnings: z.string().trim().max(1000).optional(),
    clinicalNote: z.string().trim().max(3000).optional(),
  })
  .refine((d) => d.status !== "skipped" || (d.skipReason && d.skipReason.length > 0), {
    message: "skipReason is required when status is skipped",
    path: ["skipReason"],
  });

const versionedActionSchema = z.object({ version: z.number().int().min(1) });

// ─── Error handler ────────────────────────────────────────────────────────────

function handleError(err: unknown, res: Response): void {
  const e = err as Error & { code?: string; httpStatus?: number; invalidatedItems?: unknown[] };
  const status = e.httpStatus ?? 500;
  const code = e.code ?? "INTERNAL_ERROR";

  if (status >= 500) console.error("[patient-handoffs] unhandled error:", err);

  const body: Record<string, unknown> = { code, message: e.message };
  if (e.invalidatedItems) body.invalidatedItems = e.invalidatedItems;

  res.status(status).json(body);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get(
  "/eligible-patients",
  requireAuth,
  requireEffectiveRole("technician"),
  async (req: Request, res: Response) => {
    try {
      const result = await listEligiblePatients(req.authUser!.clinicId);
      res.json(result);
    } catch (err) {
      handleError(err, res);
    }
  },
);

router.get(
  "/eligible-staff",
  requireAuth,
  requireEffectiveRole("technician"),
  async (req: Request, res: Response) => {
    try {
      const result = await listEligibleStaff(req.authUser!.clinicId, req.authUser!.id);
      res.json(result);
    } catch (err) {
      handleError(err, res);
    }
  },
);

router.post(
  "/",
  requireAuth,
  requireEffectiveRole("technician"),
  validateBody(createHandoffSchema),
  async (req: Request, res: Response) => {
    try {
      const body = req.body as z.infer<typeof createHandoffSchema>;
      const result = await createHandoff(req.authUser!.clinicId, req.authUser!.id, body.receivingUserId);
      res.status(201).json(result);
    } catch (err) {
      handleError(err, res);
    }
  },
);

router.get("/mine", requireAuth, requireEffectiveRole("technician"), async (req: Request, res: Response) => {
  try {
    const result = await getMyHandoffs(req.authUser!.clinicId, req.authUser!.id);
    res.json(result);
  } catch (err) {
    handleError(err, res);
  }
});

router.get("/:id", requireAuth, requireEffectiveRole("technician"), async (req: Request, res: Response) => {
  try {
    const callerRole = (req as any).effectiveRole ?? req.authUser!.role;
    const result = await getHandoffDetail(
      req.authUser!.clinicId,
      req.params.id,
      req.authUser!.id,
      callerRole,
    );
    res.json(result);
  } catch (err) {
    handleError(err, res);
  }
});

router.put(
  "/:id/items/:hospitalizationId",
  requireAuth,
  requireEffectiveRole("technician"),
  validateBody(upsertItemSchema),
  async (req: Request, res: Response) => {
    try {
      const body = req.body as z.infer<typeof upsertItemSchema>;
      const result = await upsertItem(
        req.authUser!.clinicId,
        req.params.id,
        req.params.hospitalizationId,
        req.authUser!.id,
        body,
      );
      res.json(result);
    } catch (err) {
      handleError(err, res);
    }
  },
);

router.post(
  "/:id/submit",
  requireAuth,
  requireEffectiveRole("technician"),
  validateBody(versionedActionSchema),
  async (req: Request, res: Response) => {
    try {
      const { version } = req.body as z.infer<typeof versionedActionSchema>;
      const result = await submitHandoff(
        req.authUser!.clinicId,
        req.params.id,
        req.authUser!.id,
        req.authUser!.email ?? "",
        req.authUser!.role,
        version,
      );
      res.json(result);
    } catch (err) {
      handleError(err, res);
    }
  },
);

router.post(
  "/:id/review",
  requireAuth,
  requireEffectiveRole("technician"),
  validateBody(versionedActionSchema),
  async (req: Request, res: Response) => {
    try {
      const { version } = req.body as z.infer<typeof versionedActionSchema>;
      const result = await reviewHandoff(
        req.authUser!.clinicId,
        req.params.id,
        req.authUser!.id,
        req.authUser!.email ?? "",
        req.authUser!.role,
        version,
      );
      res.json(result);
    } catch (err) {
      handleError(err, res);
    }
  },
);

router.post(
  "/:id/cancel",
  requireAuth,
  requireEffectiveRole("technician"),
  validateBody(versionedActionSchema),
  async (req: Request, res: Response) => {
    try {
      const { version } = req.body as z.infer<typeof versionedActionSchema>;
      const result = await cancelHandoff(
        req.authUser!.clinicId,
        req.params.id,
        req.authUser!.id,
        req.authUser!.email ?? "",
        req.authUser!.role,
        version,
      );
      res.json(result);
    } catch (err) {
      handleError(err, res);
    }
  },
);

export default router;
