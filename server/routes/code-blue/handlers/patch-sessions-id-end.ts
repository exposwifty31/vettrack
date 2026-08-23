import type { RequestHandler } from "express";
import type { z } from "zod";
import { randomUUID } from "crypto";
import { db, codeBlueEvents, codeBlueSessions, codeBlueLogEntries, users } from "../../../db.js";
import { eq, and } from "drizzle-orm";
import {
  DrizzleCartReservationStore,
  clearReservationForSession,
} from "../../../lib/code-blue-soft-reserve.js";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { insertRealtimeDomainEvent } from "../../../lib/realtime-outbox.js";
import { postSystemMessage } from "../../../lib/shift-chat-presence.js";
import { invalidateActiveCodeBlueCache } from "../../../lib/code-blue-keepalive.js";
import { evaluateCodeBlueManagerForRoute } from "../../../lib/authority/code-blue-manager.wiring.js";
import { codeBlueManagerMetrics } from "../../../lib/authority/enforcement/code-blue-manager.metrics.js";
import { resolveRequestId, apiError } from "../../../lib/route-utils.js";
import type { endSessionSchema } from "../schemas.js";

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
export const patchSessionsIdEndHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { id: sessionId } = req.params;
    const { outcome, earlyStopReason: rawEarlyStopReason } = req.body as z.infer<typeof endSessionSchema>;
    const earlyStopReason = rawEarlyStopReason ? rawEarlyStopReason.trim() : undefined;
    if (earlyStopReason !== undefined && earlyStopReason.length < 3) {
      return res.status(400).json(
        apiError({ code: "EARLY_STOP_REASON_REQUIRED", reason: "EARLY_STOP_REASON_REQUIRED", message: "earlyStopReason must be at least 3 characters", requestId }),
      );
    }

    const [session] = await db
      .select()
      .from(codeBlueSessions)
      .where(and(eq(codeBlueSessions.id, sessionId), eq(codeBlueSessions.clinicId, clinicId)))
      .limit(1);

    if (!session) {
      return res.status(404).json(
        apiError({ code: "NOT_FOUND", reason: "SESSION_NOT_FOUND", message: "Session not found", requestId }),
      );
    }

    // Manager-only gate — applies to ALL outcomes
    if (session.managerUserId !== req.authUser!.id) {
      return res.status(403).json(
        apiError({ code: "MANAGER_ONLY", reason: "MANAGER_ONLY", message: "Only the resuscitation manager can end this session", requestId }),
      );
    }

    // Verify manager still holds vet or admin role and is still active.
    const [managerUser] = await db
      .select({ id: users.id, role: users.role, status: users.status })
      .from(users)
      .where(and(eq(users.id, session.managerUserId), eq(users.clinicId, clinicId)))
      .limit(1);

    if (!managerUser || !["vet", "admin"].includes(managerUser.role)) {
      return res.status(422).json(
        apiError({ code: "NO_VET_MANAGER", reason: "NO_VET_MANAGER", message: "Assigned manager must be a vet or admin to end this session", requestId }),
      );
    }

    if (managerUser.status !== "active") {
      return res.status(403).json(
        apiError({ code: "MANAGER_INACTIVE", reason: "MANAGER_INACTIVE", message: "Assigned manager account is no longer active", requestId }),
      );
    }

    // Phase 4 PR 4.3 — Code Blue manager authority evaluator wiring at end.
    // Runs AFTER the existing persisted-manager identity and state validation,
    // BEFORE the 15-minute gate and any write/update flow. Shadow-only in
    // PR 4.3: the evaluator may emit audit/metric internally but the verdict
    // is NOT acted on by this PR. PR 4.5 introduces the enforce-mode response.
    //
    // The evaluator targets the persisted session.managerUserId (NOT the
    // request actor's id — that may coincide here because the manager-only
    // identity check above requires it, but the evaluator semantically
    // resolves the manager's authority via the existing resolver framework
    // applied to the persisted manager identity, and would behave identically
    // if a non-manager actor invoked end through some future code path).
    //
    // Drift signal: when the end-side evaluator shadow-denies or denies, the
    // manager is no longer Code-Blue-eligible at end time. The session was
    // accepted at init time (otherwise it would not exist to end here), so
    // this is the "init eligible but end ineligible" crossover — the headline
    // Phase 4 signal per master plan §10.
    if (session.managerUserId) {
      // Defensive try/catch: a throw from audit emission, metric increment,
      // or a future edge case must NEVER strand session end. The
      // shadow-only / never-blocks contract for the EVALUATOR's internal
      // emission is preserved; ENFORCE-mode 403 is opt-in via per-clinic
      // vt_server_config and is acceptable to the operator who flipped it.
      //
      // PR 4.5: in enforce mode the evaluator returns `action: "deny"`. The
      // route returns 403 with a stable reason code. Per-clinic config
      // `code_blue.manager_enforce.<clinicId>.end = "enforce"` activates
      // this path; default (`off`) is unchanged.
      //
      // The evaluator's `resolver_fault` lookup branch returns
      // `protected: "FAULT_OPEN"` even in enforce mode (DECISION-2:
      // fail-open in emergency context), so resolver/cache infrastructure
      // failures cannot strand session end.
      let endVerdict:
        | Awaited<ReturnType<typeof evaluateCodeBlueManagerForRoute>>["verdict"]
        | null = null;
      try {
        const { verdict } = await evaluateCodeBlueManagerForRoute({
          clinicId,
          managerUserId: session.managerUserId,
          endpoint: "end",
          now: new Date(),
        });
        endVerdict = verdict;
        const endWouldDeny =
          verdict.action === "deny" ||
          verdict.protected === "SHADOW_WOULD_HAVE_DENIED";
        if (endWouldDeny) {
          codeBlueManagerMetrics.driftBetweenInitAndEnd();
        }
      } catch (evalErr) {
        console.error(
          "[code-blue] manager evaluator threw at end; session-end continues (fault-open)",
          evalErr,
        );
      }
      if (endVerdict?.action === "deny") {
        // Codex P2 lesson (initiation review): USER_MISSING and
        // MANAGER_CROSS_CLINIC are input/data-corruption signals, not
        // operational-role denials. For end specifically, the existing
        // MANAGER_INACTIVE / NO_VET_MANAGER checks already ran above and
        // passed, so USER_MISSING here would only fire on a race with
        // user deletion mid-request. Conservative posture: also confine
        // the new 403 to operational-role reasons; other deny reasons
        // fall through to the existing flow (15-min gate + write), which
        // is the pre-PR-4.5 behavior for those scenarios.
        const reason = endVerdict.reason;
        if (reason === "OPROLE_NOT_IN_CB_ALLOWLIST" || reason === "NO_OPEN_CHECK_IN") {
          return res.status(403).json(
            apiError({
              code: "MANAGER_NOT_CODE_BLUE_ELIGIBLE",
              reason,
              message:
                "Persisted manager is not currently Code-Blue-eligible (operational role check). Reconfigure the clinic to shadow / off to bypass.",
              requestId,
            }),
          );
        }
        // USER_MISSING / MANAGER_CROSS_CLINIC: continue with the existing
        // flow (pre-PR-4.5 behavior preserved for these edge cases).
      }
    }

    const endedAt = new Date();

    // Fetch log entries for auto-summary
    const logEntries = await db
      .select()
      .from(codeBlueLogEntries)
      .where(eq(codeBlueLogEntries.sessionId, sessionId));

    const participants = [...new Set(logEntries.map((e) => e.loggedByName))];
    if (!participants.includes(session.startedByName)) participants.unshift(session.startedByName);

    const interventionCounts = logEntries.reduce<Record<string, number>>((acc, e) => {
      acc[e.category] = (acc[e.category] ?? 0) + 1;
      return acc;
    }, {});

    const equipmentAttached = logEntries
      .filter((e) => e.category === "equipment")
      .map((e) => e.label);

    const durationMinutes = Math.round((endedAt.getTime() - session.startedAt.getTime()) / 60000);

    const summary = JSON.stringify({
      duration_minutes: durationMinutes,
      manager: session.managerUserName,
      interventions: interventionCounts,
      equipment_attached: equipmentAttached,
      participants,
      pre_check_passed: session.preCheckPassed ?? null,
      outcome,
      ...(earlyStopReason ? { early_stop_reason: earlyStopReason } : {}),
    });

    // Update session + emit outbox event in same TX for display propagation
    await db.transaction(async (tx) => {
      await tx
        .update(codeBlueSessions)
        .set({ status: "ended", outcome, endedAt })
        .where(and(eq(codeBlueSessions.id, sessionId), eq(codeBlueSessions.clinicId, clinicId)));
      // R-CBF-1: release this session's advisory cart soft-reserve in the SAME txn,
      // so the nearest-ready-cart resolver returns the cart to the ready pool on end.
      // Without this, every ended one-tap session permanently removes its cart
      // (the resolver excludes rows where reservedForSessionId IS NOT NULL).
      await clearReservationForSession(new DrizzleCartReservationStore(tx), clinicId, sessionId);
      await insertRealtimeDomainEvent(tx, {
        clinicId,
        type: "CODE_BLUE_STATUS_CHANGED",
        payload: { sessionId, status: "ended", outcome },
        occurredAt: endedAt,
      });
    });

    // Archive to vt_code_blue_events (backward compat)
    await db.insert(codeBlueEvents).values({
      id: randomUUID(),
      clinicId,
      startedByUserId: session.startedBy,
      startedAt: session.startedAt,
      endedAt,
      outcome,
      notes: summary,
      timeline: logEntries.map((e) => ({ elapsed: e.elapsedMs, label: e.label })),
    });

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "code_blue_ended",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email ?? "",
      targetId: sessionId,
      targetType: "code_blue_session",
      metadata: { outcome, durationMinutes, ...(earlyStopReason ? { earlyStopReason } : {}) },
    });

    // Phase 9 PR 9.4 — invalidate the keepalive's active-session cache so
    // the next SSE KEEPALIVE event reflects the end within ≤ 5 s.
    invalidateActiveCodeBlueCache(clinicId);

    postSystemMessage(clinicId, "code_blue_end", {
      outcome: outcome ?? "unknown",
      endedAt: endedAt.toISOString(),
    }).catch(() => {});

    res.json({ id: sessionId, endedAt: endedAt.toISOString(), summary: JSON.parse(summary) });
  } catch (err) {
    console.error("[code-blue] end session failed", err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "SESSION_END_FAILED", message: "Failed to end session", requestId }),
    );
  }
};
