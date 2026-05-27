import type { Router } from "express";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { validateUuid } from "../middleware/validate.js";
import { logAudit } from "../lib/audit.js";
import { apiError } from "../lib/apiError.js";
import {
  buildWaitlistSnapshot,
  EquipmentWaitlistError,
  joinEquipmentWaitlist,
  leaveEquipmentWaitlist,
} from "../services/equipment-waitlist.service.js";

export function mountEquipmentWaitlistRoutes(router: Router): void {
  router.get(
    "/:id/waitlist",
    requireAuth,
    requireEffectiveRole("student"),
    validateUuid("id"),
    async (req, res) => {
      const clinicId = req.clinicId!;
      const equipmentId = req.params.id;
      const snapshot = await buildWaitlistSnapshot(clinicId, equipmentId, req.authUser!.id);
      res.json(snapshot);
    },
  );

  router.post(
    "/:id/waitlist",
    requireAuth,
    requireEffectiveRole("student"),
    validateUuid("id"),
    async (req, res) => {
      const clinicId = req.clinicId!;
      const equipmentId = req.params.id;
      const { id: userId, email } = req.authUser!;

      try {
        const snapshot = await joinEquipmentWaitlist(clinicId, equipmentId, userId);
        logAudit({
          clinicId,
          actionType: "equipment_waitlist_joined",
          performedBy: userId,
          performedByEmail: email,
          targetId: equipmentId,
          metadata: { position: snapshot.myPosition, queueSize: snapshot.queueSize },
        });
        res.status(201).json(snapshot);
      } catch (err) {
        if (err instanceof EquipmentWaitlistError) {
          const status =
            err.code === "EQUIPMENT_NOT_FOUND" ? 404
            : err.code === "WAITLIST_ALREADY_JOINED" ? 409
            : 422;
          return apiError(req, res, `equipmentWaitlist.${err.code}`, undefined, status);
        }
        throw err;
      }
    },
  );

  router.delete(
    "/:id/waitlist",
    requireAuth,
    requireEffectiveRole("student"),
    validateUuid("id"),
    async (req, res) => {
      const clinicId = req.clinicId!;
      const equipmentId = req.params.id;
      const { id: userId, email } = req.authUser!;

      try {
        const snapshot = await leaveEquipmentWaitlist(clinicId, equipmentId, userId);
        logAudit({
          clinicId,
          actionType: "equipment_waitlist_left",
          performedBy: userId,
          performedByEmail: email,
          targetId: equipmentId,
          metadata: { queueSize: snapshot.queueSize },
        });
        res.json(snapshot);
      } catch (err) {
        if (err instanceof EquipmentWaitlistError) {
          const status = err.code === "WAITLIST_NOT_ON_WAITLIST" ? 404 : 422;
          return apiError(req, res, `equipmentWaitlist.${err.code}`, undefined, status);
        }
        throw err;
      }
    },
  );
}
