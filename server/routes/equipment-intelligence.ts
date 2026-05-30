import { Router, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { intelligenceLimiter } from "../middleware/rate-limiters.js";
import { apiError as apiErrorI18n } from "../lib/apiError.js";
import {
  analyzeCurrentEquipmentState,
  createTaskFromIntelligenceRecommendation,
  EquipmentIntelligenceError,
  generateShiftHandoverIntelligence,
} from "../services/equipment-intelligence.service.js";

const router = Router();

router.use(requireAuth);
router.use(requireEffectiveRole("technician"));
router.use(intelligenceLimiter);

const createTaskSchema = z.object({
  confirmed: z.literal(true, {
    errorMap: () => ({ message: "confirmed must be true — human approval required" }),
  }),
  notes: z.string().max(4000).optional(),
});

function resolveRequestId(res: Response, incoming: unknown): string {
  const incomingStr = typeof incoming === "string" ? incoming.trim() : "";
  const existing = res.getHeader("x-request-id");
  const fromRes = typeof existing === "string" ? existing.trim() : "";
  const requestId = incomingStr || fromRes || randomUUID();
  res.setHeader("x-request-id", requestId);
  return requestId;
}

function intelligenceErrorKey(code: string): string {
  switch (code) {
    case "RECOMMENDATION_NOT_FOUND":
      return "equipmentIntelligence.errors.recommendationNotFound";
    case "APPROVAL_REQUIRED":
      return "equipmentIntelligence.errors.approvalRequired";
    case "PILOT_MODE_TASKS_UNAVAILABLE":
      return "equipmentIntelligence.errors.pilotTasksUnavailable";
    default:
      return "errors.generic";
  }
}

router.post("/analyze", async (req, res) => {
  resolveRequestId(res, req.headers["x-request-id"]);
  const clinicId = req.clinicId;
  const authUser = req.authUser;
  if (!clinicId || !authUser) {
    return apiErrorI18n(req, res, "equipmentIntelligence.errors.unauthorized", undefined, 401);
  }
  try {
    const result = await analyzeCurrentEquipmentState({
      clinicId,
      userId: authUser.id,
      userEmail: authUser.email,
      actor: { ...req, authUser },
    });
    return res.json(result);
  } catch (err) {
    console.error("[equipment-intelligence] analyze failed", err);
    return apiErrorI18n(req, res, "equipmentIntelligence.errors.analyzeFailed", undefined, 500);
  }
});

router.post("/shift-handover", async (req, res) => {
  resolveRequestId(res, req.headers["x-request-id"]);
  const clinicId = req.clinicId;
  const authUser = req.authUser;
  if (!clinicId || !authUser) {
    return apiErrorI18n(req, res, "equipmentIntelligence.errors.unauthorized", undefined, 401);
  }
  try {
    const result = await generateShiftHandoverIntelligence({
      clinicId,
      userId: authUser.id,
      userEmail: authUser.email,
      actor: { ...req, authUser },
    });
    return res.json(result);
  } catch (err) {
    console.error("[equipment-intelligence] shift-handover failed", err);
    return apiErrorI18n(req, res, "equipmentIntelligence.errors.shiftFailed", undefined, 500);
  }
});

router.post(
  "/recommendations/:recommendationId/create-task",
  validateBody(createTaskSchema),
  async (req, res) => {
    resolveRequestId(res, req.headers["x-request-id"]);
    const clinicId = req.clinicId;
    const authUser = req.authUser;
    if (!clinicId || !authUser) {
      return apiErrorI18n(req, res, "equipmentIntelligence.errors.unauthorized", undefined, 401);
    }
    try {
      const result = await createTaskFromIntelligenceRecommendation({
        clinicId,
        recommendationId: req.params.recommendationId,
        confirmed: req.body.confirmed,
        notes: req.body.notes,
        actor: { ...req, authUser },
      });
      return res.status(201).json(result);
    } catch (err) {
      if (err instanceof EquipmentIntelligenceError) {
        return apiErrorI18n(req, res, intelligenceErrorKey(err.code), undefined, err.status);
      }
      console.error("[equipment-intelligence] create-task failed", err);
      return apiErrorI18n(req, res, "equipmentIntelligence.errors.taskFailed", undefined, 500);
    }
  },
);

export default router;
