import type { RequestHandler } from "express";
import { resolveAuditActorRole } from "../../../lib/audit.js";
import { trackSyncFail } from "../../../lib/sync-metrics.js";
import {
  CheckoutConflictError,
  CustodyReturnVersionConflictError,
  toggleEquipmentCustody,
} from "../../../services/equipment-custody-toggle.service.js";
import { apiError, mapCheckoutGateError, resolveRequestId } from "../equipment-route-utils.js";

/** POST /api/equipment/:id/toggle — NFC quick custody flip (online-only client) */
export const postEquipmentToggleHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { isPluggedIn } = req.body as { isPluggedIn?: boolean };

    const result = await toggleEquipmentCustody({
      clinicId,
      equipmentId: req.params.id,
      actor: { id: req.authUser!.id, email: req.authUser!.email },
      isPluggedIn: isPluggedIn ?? true,
      actorRole: resolveAuditActorRole(req) ?? undefined,
    });

    if (result.kind === "not_found") {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND",
          message: "Equipment not found",
          requestId,
        }),
      );
    }

    if (result.kind === "blocked") {
      return res.json({
        equipment: result.equipment,
        action: "blocked",
        scanLogId: "",
        undoToken: "",
        checkedOutByEmail: result.checkedOutByEmail,
      });
    }

    return res.json({
      equipment: result.equipment,
      action: result.kind,
      scanLogId: result.scanLogId,
      undoToken: result.undoToken,
    });
  } catch (err) {
    const gateMapped = mapCheckoutGateError(err, req, res);
    if (gateMapped) return gateMapped;
    if (err instanceof CheckoutConflictError) {
      return res.status(409).json({
        code: "VERSION_CONFLICT",
        error: "Version conflict, please retry",
        checkedOutByEmail: err.checkedOutByEmail,
      });
    }
    if (err instanceof CustodyReturnVersionConflictError) {
      return res.status(409).json(
        apiError({
          code: "CONFLICT",
          reason: "VERSION_CONFLICT",
          message: "Equipment was updated concurrently; please retry",
          requestId,
        }),
      );
    }
    console.error(err);
    trackSyncFail();
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_TOGGLE_FAILED",
        message: "Toggle failed",
        requestId,
      }),
    );
  }
};
