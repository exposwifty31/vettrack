import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { requireAuth, requireAdmin, requireClinicalUser } from "../middleware/auth.js";
import { requireClinicalAuthority } from "../middleware/authority.js";
import { validateBody, validateUuid } from "../middleware/validate.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import { codeBlueManagerMetrics } from "../lib/authority/enforcement/code-blue-manager.metrics.js";
import { postEventsHandler } from "./code-blue/handlers/post-events.js";
import { patchEventsIdHandler } from "./code-blue/handlers/patch-events-id.js";
import { getEventsHandler } from "./code-blue/handlers/get-events.js";
import { getSessionsActiveHandler } from "./code-blue/handlers/get-sessions-active.js";
import { getEligibleManagersHandler } from "./code-blue/handlers/get-eligible-managers.js";
import { patchSessionsIdPresenceHandler } from "./code-blue/handlers/patch-sessions-id-presence.js";
import { getHistoryHandler } from "./code-blue/handlers/get-history.js";
import { getReconciliationHandler } from "./code-blue/handlers/get-reconciliation.js";
import { getSessionsIdDispensesHandler } from "./code-blue/handlers/get-sessions-id-dispenses.js";
import { patchSessionsIdReconcileHandler } from "./code-blue/handlers/patch-sessions-id-reconcile.js";
import { postSessionsIdManualBillingHandler } from "./code-blue/handlers/post-sessions-id-manual-billing.js";
import { postOneTapHandler } from "./code-blue/handlers/post-one-tap.js";
import { postSessionsIdLogsHandler } from "./code-blue/handlers/post-sessions-id-logs.js";
import { postSessionsHandler } from "./code-blue/handlers/post-sessions.js";
import { patchSessionsIdEndHandler } from "./code-blue/handlers/patch-sessions-id-end.js";
const router = Router();

// Request-body schemas live in ./code-blue/schemas.ts (moved out to break a
// router → handler → router import cycle — handlers need these types too;
// see that file's header comment). Re-exported here unchanged so existing
// consumers importing from this path (e.g. tests/strict-body-validation.test.ts)
// keep resolving exactly as before.
export {
  startSchema,
  endSchema,
  startSessionSchema,
  logEntrySchema,
  endSessionSchema,
  oneTapStartSchema,
  reconcileSchema,
  manualBillingSchema,
} from "./code-blue/schemas.js";
import {
  startSchema,
  endSchema,
  startSessionSchema,
  logEntrySchema,
  endSessionSchema,
  oneTapStartSchema,
  reconcileSchema,
  manualBillingSchema,
} from "./code-blue/schemas.js";

// POST /api/code-blue/events  — start a Code Blue event (fire-and-forget safe)
//
// Phase 4 PR 4.6 — legacy archive clinical gate. Master plan §14 notes that
// these /events routes are likely near-dead (no live HTTP callers identified;
// the modern flow uses /sessions). The clinical gate prevents NEW non-clinical
// callers from creating archive rows. A future cleanup phase may grep the
// frontend and remove the legacy routes entirely.
//
// allowSystemAdmin:false per master plan §17 — Code Blue clinical gates do
// not admit system-admin identity. Strand risk for shift-expired actors is
// accepted given these are legacy archive writes, not real-time emergency
// recording (modern flow → /sessions).
router.post(
  "/events",
  requireAuth,
  requireClinicalUser,
  requireClinicalAuthority({
    allow: ["vet", "senior_technician", "technician"],
    allowSystemAdmin: false,
  }),
  validateBody(startSchema),
  postEventsHandler,
);

// PATCH /api/code-blue/events/:id  — close a Code Blue event with outcome + timeline
//
// Phase 4 PR 4.6 — legacy archive clinical gate. Same posture as the POST
// route above. PATCH for the legacy /events archive is a one-shot close-out
// (analogous to PATCH /sessions/:id/end, which was deliberately NOT gated in
// PR 4.3 to avoid stranding active sessions). For /events specifically:
//   - the route is legacy / likely dead (modern flow → /sessions),
//   - the data being archived is the outcome of an already-completed event,
//   - the realistic call-pattern is a clinical user closing an event they
//     themselves opened, so the gate aligns with intended usage.
// Strand risk (shift-expired actor cannot finalize the archive entry) is
// accepted given these routes are scheduled for removal in a future
// cleanup phase (master plan §14).
router.patch(
  "/events/:id",
  requireAuth,
  requireClinicalUser,
  requireClinicalAuthority({
    allow: ["vet", "senior_technician", "technician"],
    allowSystemAdmin: false,
  }),
  validateUuid("id"),
  validateBody(endSchema),
  patchEventsIdHandler,
);

// GET /api/code-blue/events  — admin: list recent events for this clinic
router.get("/events", requireAuth, requireAdmin, getEventsHandler);

/**
 * Phase 4 PR 4.2 — Initiator clinical-gate denial observer.
 *
 * Runs BEFORE the clinical-gate middleware chain on POST /api/code-blue/sessions.
 * On response finish, if the gate denied (status 403) before the route handler
 * could run, emits the Code-Blue-specific initiator denial counter + audit.
 *
 * This is a tiny observability shim that runs alongside the existing
 * `requireClinicalAuthority` audit emission (`authority_denied`). It does NOT
 * make any authority decision and does NOT modify the middleware framework —
 * the gate's deny path is unchanged. The observer simply ALSO records the
 * Code-Blue-flavored signal for dashboards keyed on Code Blue routes.
 *
 * `res.locals.__cbInitiatorGatePassed` is cleared by the post-gate marker
 * (`__cbInitiatorGatePassed = true`) when the handler is reached. If it stays
 * `false` at response-finish AND status is 403, the gate denied.
 */
function codeBlueInitiatorDenialObserver(endpoint: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.locals.__cbInitiatorGatePassed = false;
    res.on("finish", () => {
      if (res.locals.__cbInitiatorGatePassed) return;
      if (res.statusCode !== 403) return;
      try {
        codeBlueManagerMetrics.initiatorDenied();
        logAudit({
          clinicId: req.clinicId ?? "",
          actionType: "code_blue_initiator_authority_denied",
          performedBy: req.authUser?.id ?? "",
          performedByEmail: req.authUser?.email ?? "",
          targetType: "code_blue_session",
          actorRole: resolveAuditActorRole(req),
          metadata: {
            endpoint,
            denialPath: "actor_clinical_gate",
            resolvedAt: new Date().toISOString(),
          },
        });
      } catch (err) {
        console.error("[code-blue] initiator-denial observer failed", err);
      }
    });
    next();
  };
}

function codeBlueInitiatorGatePassedMarker(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.locals.__cbInitiatorGatePassed = true;
  next();
}

// POST /api/code-blue/sessions — start a new live session
router.post(
  "/sessions",
  requireAuth,
  codeBlueInitiatorDenialObserver("POST /api/code-blue/sessions"),
  requireClinicalUser,
  requireClinicalAuthority({
    allow: ["vet", "senior_technician", "technician"],
    // Phase 4 master plan §5 invariant 8: system-admin identity is not an
    // emergency clinical actor. Admins without a clinical check-in are denied.
    allowSystemAdmin: false,
    // Phase 10a T1 — break-glass: a clinical identity (vet / senior_technician
    // / technician, never a student) may OPEN a Code Blue with no active shift.
    // A cardiac arrest must not wait on roster scheduling. Scoped to this gate
    // only; all other Code Blue flows (logs/end/presence) stay roster-gated.
    allowPermanentClinicalRoleForEmergency: true,
  }),
  codeBlueInitiatorGatePassedMarker,
  validateBody(startSessionSchema),
  postSessionsHandler,
);

// R-CBF-1.1 — one-tap Code Blue orchestration body.
// POST /api/code-blue/one-tap — orchestrated "one tap, everything ready" start.
// Composes: durable idempotency claim → server-authoritative nearest-ready cart
// → CAS soft-reserve → session → outbox team page (+ status), all atomic. Same
// clinical gates as POST /sessions. Emergency mutation: online-only, offline-
// blocked via classifyEmergencyEndpoint, never optimistic.
router.post(
  "/one-tap",
  requireAuth,
  codeBlueInitiatorDenialObserver("POST /api/code-blue/one-tap"),
  requireClinicalUser,
  requireClinicalAuthority({
    allow: ["vet", "senior_technician", "technician"],
    allowSystemAdmin: false,
    allowPermanentClinicalRoleForEmergency: true,
  }),
  codeBlueInitiatorGatePassedMarker,
  validateBody(oneTapStartSchema),
  postOneTapHandler,
);

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
router.get("/eligible-managers", requireAuth, requireClinicalUser, getEligibleManagersHandler);

// GET /api/code-blue/sessions/active — poll: session + log entries + presence + cart status
router.get("/sessions/active", requireAuth, getSessionsActiveHandler);

// POST /api/code-blue/sessions/:id/logs — add a log entry
//
// Phase 4 PR 4.4a — clinical gate. Anyone logging a Code Blue event must be
// a clinical-shift actor (vet / senior_technician / technician). System-admin
// identity is denied (allowSystemAdmin:false): an admin who lacks an active
// clinical check-in cannot document clinical events. Master plan §8.
//
// Unlike PATCH /sessions/:id/end (close-out of a single persisted state),
// log writes are per-event documentation by multiple actors. A vet without
// an active shift being denied the ability to log is acceptable: other
// clinical-shift actors in the room can still document. The session is not
// stranded by a denial here.
//
// Mid-session manager-downgrade detection runs AFTER the log write
// (fire-and-forget) and observes whether the PERSISTED manager has drifted
// out of Code-Blue eligibility during the active session. Shadow-only;
// never blocks the log write — the helper internally absorbs all errors.
router.post(
  "/sessions/:id/logs",
  requireAuth,
  requireClinicalUser,
  requireClinicalAuthority({
    allow: ["vet", "senior_technician", "technician"],
    allowSystemAdmin: false,
  }),
  validateUuid("id"),
  validateBody(logEntrySchema),
  postSessionsIdLogsHandler,
);

// PATCH /api/code-blue/sessions/:id/presence — heartbeat (every 10s)
router.patch("/sessions/:id/presence", requireAuth, validateUuid("id"), patchSessionsIdPresenceHandler);

// PATCH /api/code-blue/sessions/:id/end — close session (manager only for ALL outcomes)
//
// Phase 4 PR 4.3 architectural note: this route deliberately does NOT add the
// `requireClinicalAuthority` middleware that initiation (POST /sessions) uses.
// End is a *close-out* action authorized by the persisted manager identity
// (`MANAGER_ONLY` check below), not by fresh clinical authority. Adding a
// clinical-shift gate at the end would strand active sessions whenever the
// persisted manager loses their clinical shift mid-session (e.g., shift
// expires during a 30-minute resus, admin manager with no shift, vet who
// checks out before closing out), which is a real production safety risk
// flagged in PR 4.3 review (Codex P1 + Bugbot HIGH).
//
// The Phase 4 master plan §17 forbidden ("no system-admin bypass on Code
// Blue clinical gates") still applies to the gates that EXIST: initiation
// (PR 4.2) and the future log-write gates (PR 4.4a). End is fundamentally
// different — once a session is created, the persisted manager identity is
// the binding authorization for closing it.
//
// The PR 4.3 deliverable — the manager-authority evaluator at end-time and
// the drift signal — is wired below inside the handler, AFTER session load
// and identity validation. Shadow-only.
router.patch("/sessions/:id/end", requireAuth, validateUuid("id"), validateBody(endSessionSchema), patchSessionsIdEndHandler);

// GET /api/code-blue/history — admin: list ended sessions
router.get("/history", requireAuth, requireAdmin, getHistoryHandler);

// ─── Reconciliation endpoints ─────────────────────────────────────────────────

/**
 * GET /api/code-blue/reconciliation
 * Lists ended Code Blue sessions with dispense + billing summary. Admin only.
 */
router.get("/reconciliation", requireAuth, requireAdmin, getReconciliationHandler);

/**
 * GET /api/code-blue/sessions/:id/dispenses
 * Returns inventory dispenses during a Code Blue session with billing status. Admin only.
 */
router.get("/sessions/:id/dispenses", requireAuth, requireAdmin, validateUuid("id"), getSessionsIdDispensesHandler);

/**
 * PATCH /api/code-blue/sessions/:id/reconcile
 * Fix D: Validates billing completeness + no failed inventory jobs before marking reconciled.
 * Pass ?force=true + body.forceReason to override gaps. Admin only.
 */
router.patch("/sessions/:id/reconcile", requireAuth, requireAdmin, validateUuid("id"), validateBody(reconcileSchema), patchSessionsIdReconcileHandler);

/**
 * POST /api/code-blue/sessions/:id/manual-billing
 * Creates a manual billing entry for an unbilled dispense. Admin only.
 */
router.post("/sessions/:id/manual-billing", requireAuth, requireAdmin, validateBody(manualBillingSchema), postSessionsIdManualBillingHandler);

export default router;
