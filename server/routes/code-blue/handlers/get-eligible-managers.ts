import type { RequestHandler } from "express";
import { listCodeBlueEligibleManagers } from "../../../lib/authority/code-blue-eligible-managers.js";
import type { CodeBlueEligibleManagersResponse } from "@vettrack/contracts";
import { resolveRequestId, apiError } from "../../../lib/route-utils.js";

// GET /api/code-blue/eligible-managers — who would the manager check accept now?
//
// DISCOVERY ONLY. Grants nothing; the enforcement boundary stays on the two POSTs
// above. It exists because the manager picker previously read
// `GET /api/users/managers`, which knows nothing about the evaluator — so in enforce
// mode the picker could offer a manager this file then rejects with 403
// MANAGER_NOT_CODE_BLUE_ELIGIBLE, mid-arrest. The list runs the same evaluator, so
// the two cannot disagree.
//
// Gate: `requireClinicalUser`, deliberately NOT the initiator's
// `requireClinicalAuthority`. Two reasons. Whoever may OPEN a Code Blue must be able
// to SEE who may manage it, so the list must not be harder to reach than the
// mutation it feeds. And the initiator gate's break-glass path emits a
// break-glass audit/counter — on a repeatedly-polled GET that would manufacture
// emergency-override signal out of ordinary reads.
export const getEligibleManagersHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    // Session-derived, never client-supplied: a query param or header here would be
    // a cross-tenant read.
    const clinicId = req.clinicId!;
    const managers = await listCodeBlueEligibleManagers({ clinicId });
    const body: CodeBlueEligibleManagersResponse = { managers };
    return res.json(body);
  } catch (err) {
    console.error("[code-blue] eligible-managers failed", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ELIGIBLE_MANAGERS_FAILED",
        message: "Failed to list Code Blue eligible managers",
        requestId,
      }),
    );
  }
};
