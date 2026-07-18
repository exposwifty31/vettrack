import { randomUUID } from "crypto";
import { db, auditLogs, eventOutbox } from "../db.js";
import { OUTBOX_TYPE_AUDIT_LOG } from "./event-publisher.js";

export type AuditActionType =
  | "pharmacy_order_sent"
  | "user_login"
  | "user_provisioned"
  | "user_display_name_changed"
  | "user_role_changed"
  | "user_secondary_role_changed"
  | "user_status_changed"
  | "user_deleted"
  | "user_restored"
  // Self-service account deletion (App Store Guideline 5.1.1(v)).
  | "account_self_deleted"
  | "apple_token_linked"
  | "apple_token_revoked"
  | "apple_token_revoke_failed"
  | "equipment_created"
  | "equipment_updated"
  | "equipment_deleted"
  | "equipment_scanned"
  | "equipment_checked_out"
  | "equipment_returned"
  | "equipment_reverted"
  | "equipment_bulk_deleted"
  | "equipment_bulk_moved"
  | "equipment_imported"
  | "folder_created"
  | "folder_updated"
  | "folder_deleted"
  | "alert_acknowledged"
  | "alert_acknowledgment_removed"
  | "room_created"
  | "room_updated"
  | "room_deleted"
  | "room_bulk_verified"
  | "task_created"
  | "task_updated"
  | "task_started"
  | "task_completed"
  | "task_cancelled"
  | "CRITICAL_TASK_EXECUTED"
  | "CRITICAL_NOTIFICATION_SENT"
  | "TASK_ESCALATED"
  | "TASK_AUTO_ASSIGNED"
  | "TASK_STUCK_NOTIFIED"
  | "medication_task_created"
  | "medication_task_taken"
  | "medication_task_completed"
  | "medication_task_released_stale"
  | "users_backfilled_from_clerk"
  | "billing_voided"
  | "billing_bulk_synced"
  | "inventory_item_created"
  | "inventory_item_updated"
  | "inventory_item_deleted"
  | "clinic_pharmacy_email_updated"
  | "forecast_exclusion_created"
  | "forecast_exclusion_deleted"
  | "billing_charge_created"
  | "equipment_restored"
  | "code_blue_started"
  | "code_blue_ended"
  | "integration_config_created"
  | "integration_config_updated"
  | "integration_config_deleted"
  | "integration_credentials_stored"
  | "integration_vendor_rollback"
  | "integration_vendor_promoted"
  | "users_hard_purged"
  | "inventory_dispensed"
  | "code_blue_session_reconciled"
  | "er_intake_created"
  | "er_intake_assigned"
  | "er_handoff_created"
  | "er_handoff_acknowledged"
  | "er_handoff_forced_ack_override"
  | "er_mode_changed"
  | "er_mode_state_changed"
  | "er_global_mode_changed"
  | "container_created"
  | "containers_defaults_seeded"
  | "crash_cart_item_created"
  | "crash_cart_item_updated"
  | "crash_cart_item_deactivated"
  | "crash_cart_check_saved"
  | "forecast_parse_saved"
  | "patient_admitted"
  | "shift_session_started"
  | "shift_session_ended"
  | "shifts_csv_imported"
  | "shift_adjustment_requested"
  | "shift_adjustment_approved"
  | "shift_adjustment_rejected"
  | "shift_adjustment_cancelled"
  | "whatsapp_alert_created"
  | "code_blue_log_entry_created"
  | "code_blue_presence_heartbeat"
  | "forecast_parse_keepalive"
  | "formulary_entry_upserted"
  | "formulary_entry_created"
  | "formulary_entry_updated"
  | "formulary_entry_deleted"
  | "integration_mapping_review_updated"
  | "hospitalization_status_updated"
  | "patient_updated"
  | "patient_discharged"
  | "animal_soft_deleted"
  | "animal_restored"
  | "animals_hard_purged"
  | "push_subscription_created"
  | "push_subscription_updated"
  | "push_subscription_deleted"
  | "shift_chat_message_posted"
  | "shift_chat_broadcast_ack"
  | "shift_chat_message_pinned"
  | "shift_chat_reaction_removed"
  | "shift_chat_reaction_added"
  | "emergency_dispense_reconciled"
  | "support_ticket_created"
  | "support_ticket_updated"
  | "cursor_bug_fixer_dispatched"
  | "er_intake_patient_accepted"
  | "er_intake_patient_accept_released"
  | "er_admission_state_entered"
  | "er_admission_state_cleared"
  | "er_intake_admission_complete"
  | "er_intake_enriched"
  | "doctor_shifts_csv_imported"
  | "inventory_job_retried"
  | "test_scheduled_notification_scenario_created"
  | "outbox_dlq_retry_all"
  | "outbox_dlq_drop"
  | "dispense_confirmed"
  | "dispense_emergency_created"
  | "medication_task_dose_corrected"
  | "medication_task_cancelled"
  | "formulary_created"
  | "formulary_version_created"
  | "formulary_deleted"
  | "inventory_item_deactivated"
  | "inventory_item_price_added"
  | "purchase_order_created"
  | "purchase_order_submitted"
  | "purchase_order_received"
  | "purchase_order_cancelled"
  | "task_approved"
  | "alert_seen"
  | "alert_resolved"
  | "alert_reopened"
  | "billing_reversed"
  | "patient_handoff_submitted"
  | "patient_handoff_reviewed"
  | "patient_handoff_cancelled"
  | "clinical_check_in"
  | "clinical_check_out"
  | "operational_roles_updated"
  | "authority_cache_invalidated"
  | "code_blue_replay_authority_denied"
  | "authority_denied"
  | "authority_resolution_failed"
  | "dispense_legacy_role_fallback_used"
  // Phase 10a T1 — Code Blue emergency break-glass grant. Emitted when the
  // POST /code-blue/sessions gate admits a clinical-non-student identity with
  // no active shift via the `allowPermanentClinicalRoleForEmergency` opt-in.
  // Distinct from `dispense_legacy_role_fallback_used` so audit dashboards can
  // separate emergency break-glass from legacy dispense compatibility grants.
  | "code_blue_break_glass_used"
  | "authority_enforcement_denied_stale"
  | "authority_enforcement_denied_oprole"
  | "MANUAL_OWNERSHIP_CONFIRMATION"
  | "task_assignment_enforcement_denied"
  | "stale_task_ownership_would_have_revoked"
  | "stale_task_ownership_sweeper_started"
  | "stale_task_ownership_sweeper_completed"
  | "stale_task_ownership_revoked"
  // Phase 4 PR 4.1 — Code Blue manager authority enforcement audit kinds.
  // Registered in PR 4.1 foundation; wired by PR 4.2 (initiation) and
  // PR 4.3 (end).
  | "code_blue_initiator_authority_denied"
  | "code_blue_manager_authority_shadow_denied"
  | "code_blue_manager_authority_denied"
  | "code_blue_manager_authority_fault_open"
  // Phase 4 PR 4.4a — mid-session manager-downgrade shadow detection.
  // Emitted from POST /api/code-blue/sessions/:id/logs when the persisted
  // manager's authority no longer satisfies the Code-Blue allowlist at
  // log-write time. Shadow-only; never blocks the log write.
  | "code_blue_manager_midsession_authority_shadow_denied"
  // Phase 4 PR 4.4b — drug/shock actor oprole shadow detection.
  // Emitted from POST /api/code-blue/sessions/:id/logs for category ∈
  // {drug, shock} when the request actor's own snapshot fails the
  // Code-Blue allowlist. Shadow-only; never blocks the log write in
  // PR 4.4b. PR 4.5 wires enforce-mode 403 separately.
  | "code_blue_log_drug_shock_authority_shadow_denied"
  // Phase 4 PR 4.5 — drug/shock actor oprole enforce-mode deny.
  // Emitted from POST /api/code-blue/sessions/:id/logs in enforce mode
  // when the request actor's snapshot fails the Code-Blue allowlist.
  // Distinct from the shadow kind so dashboards can separate observation
  // from enforcement-driven denials.
  | "code_blue_log_drug_shock_authority_denied"
  // Phase 5 PR 5.5 — clinical-invariant shadow-mode observability.
  // Fire-and-forget post-commit, sampled 1 per 5 min per
  // (clinicId, animalId), gated by `AUTHORITY_OBS_V1`. Best-effort
  // per CI-25 — failure must never affect request outcome.
  | "clinical_invariant_shadow_would_have_blocked"
  // Phase 5 PR 5.7 — clinical-invariant enforce-mode audit kinds:
  //   - `_orphan_dispense_denied`: in-tx attempt before the 422
  //     response is sent (best-effort, non-durable per CI-26).
  //   - `_emergency_bypass`: fire-and-forget post-commit when the
  //     evaluator's emergency carve-out fires (CI-7).
  //   - `_fail_open`: fire-and-forget post-commit when
  //     `SMART_COP_VALIDATION_FAIL_OPEN=true` AND the evaluator
  //     threw, and the wiring degraded to allow.
  | "clinical_invariant_orphan_dispense_denied"
  | "clinical_invariant_emergency_bypass"
  | "clinical_invariant_fail_open"
  | "pilot_config_updated"
  // Equipment Operational State V1
  | "equipment_dock_return"
  | "equipment_condition_verified"
  | "equipment_custody_state_changed"
  | "equipment_readiness_state_changed"
  | "equipment_readiness_rules_updated"
  | "equipment_usage_state_changed"
  | "equipment_emergency_checkout"
  | "equipment_custody_chain_broken"
  | "equipment_staged"
  | "equipment_stage_cancelled"
  | "equipment_stage_fulfilled"
  | "equipment_stage_expired"
  | "equipment_emergency_staging_expired"
  | "equipment_waitlist_joined"
  | "equipment_waitlist_left"
  | "equipment_waitlist_promoted"
  | "equipment_waitlist_expired"
  | "equipment_waitlist_fulfilled"
  | "equipment_rfid_observed_room_changed"
  | "rfid_reader_offline"
  | "rfid_reader_recovered"
  // R-M1.1b/1.1c — admin-only RFID reader lifecycle + ingest-enablement audit trail.
  | "rfid_reader_created"
  | "rfid_reader_renamed"
  | "rfid_reader_deactivated"
  | "rfid_ingest_enabled_changed"
  | "equipment_semi_dock_notified"
  | "equipment_stale_checkout_nudged"
  // T3.5 — staleReturnedSweep nudge worker (returned-unverified → nudge managers).
  | "equipment_stale_returned_nudged"
  // Sprint 1.7 — inference engine fires when no location signal exists for a device.
  | "equipment_location_unknown"
  // T-24b — damage report flips conditionStatus to a non-"ok" value (R-EQ-F3).
  | "equipment_damage_reported"
  // T1.4 — docking-as-first-class: admin assigns/reassigns an item's Home
  // Room + Category (ownership metadata). Distinct from custody events
  // (checkout/return/dock-return) — ownership answers "where does this item
  // belong", custody answers "where is it / who has it right now" — keeping
  // them separate audit kinds lets reconciliation reporting attribute
  // "who reassigned this item's home" without wading through custody noise.
  | "equipment_home_assigned"
  // P2 T2.5 — docking-as-first-class citizen-driven anchor lifecycle.
  // `_created`: anyone confirms a resting item is at its home station
  // (createAnchor source:"citizen"), healing the map. `_contradicted`:
  // a seeker reports a claimed/expected item missing
  // (invalidateCurrentAnchor reason:"not_found_here").
  | "equipment_anchor_created"
  | "equipment_anchor_contradicted"
  // P3 T3.2a — Room Sweep commit: a per-shift confirm pass over a room's
  // homed items. Emitted once per sweep with `{confirmed, missing}` counts
  // in metadata; targetId is the swept roomId.
  | "room_swept"
  // P3 T3.4-i-a — Equipment Coordinator model. `_eligibility_set`: admin
  // flips a user's `is_equipment_coordinator` flag (targetId = the user).
  // `_assigned`: a senior tech/admin confirms which eligible tech is THIS
  // shift's coordinator when the auto-derivation was ambiguous (targetId =
  // the confirmed coordinator's userId; metadata carries shiftDate).
  | "equipment_coordinator_eligibility_set"
  | "equipment_coordinator_assigned"
  // P3 T3.4-ii — Room Sweep escalation ladder. `_escalated`: the worker
  // advances a shift's escalation stage (targetId = the shift's coordinator
  // row's clinicId-scoped shiftDate context; metadata carries {stage}).
  // `_responsibility_transferred`: emitted additionally at stage 3, when
  // responsibility auto-transfers from the Coordinator to the Senior Tech
  // (targetId = the senior tech's userId).
  | "room_sweep_escalated"
  | "room_sweep_responsibility_transferred"
  // Phase 9 — Display device pairing
  | "display_pairing_code_issued"
  | "display_device_paired"
  | "display_device_renamed"
  | "display_device_revoked"
  // Phase 10 (T21) — admin removes a dead (already-revoked) registry row.
  | "display_device_deleted"
  // R-SH-F1 — Shift-handover artifact. `_generated`: the artifact is generated
  // at shift end (in-process generator; targetId = the handover id). `_acknowledged`:
  // the incoming-shift actor confirms receipt — records acknowledgedBy/At and
  // flips the clinic-scoped notification read-state to read. `_unconfirmed`: the
  // persisted reversal (DELETE .../acknowledge) — clears the ack and restores the
  // unread read-state; audited with actor, clinicId, handover id, and the
  // ack→unread transition so the reversal is a real, attributable event.
  | "shift_handover_generated"
  | "shift_handover_acknowledged"
  | "shift_handover_unconfirmed";

export interface LogAuditParams {
  clinicId: string;
  actionType: AuditActionType;
  performedBy: string;
  performedByEmail: string;
  targetId?: string | null;
  targetType?: string | null;
  metadata?: Record<string, unknown> | null;
  /**
   * When set, merged into stored metadata as `actorRole` (shift-aware effective role when provided).
   * Skipped if metadata already defines `actorRole`.
   */
  actorRole?: string | null;
}

/** Drizzle transaction client from `db.transaction` — use with `logAudit` for atomic business + audit + outbox. */
export type AuditDbExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type LogAuditWithTxParams = LogAuditParams & { tx: AuditDbExecutor };

/** Minimal shape for Express `req` after auth middleware (avoids importing Express in this module). */
export type AuditActorSource = {
  effectiveRole?: string;
  authUser?: { role?: string };
};

export function resolveAuditActorRole(source: AuditActorSource): string | null {
  const r = String(source.effectiveRole ?? source.authUser?.role ?? "").trim().toLowerCase();
  return r.length > 0 ? r : null;
}

function mergeAuditMetadata(
  metadata: Record<string, unknown> | null | undefined,
  actorRole: string | null | undefined,
): Record<string, unknown> | null {
  const base: Record<string, unknown> =
    metadata && typeof metadata === "object" && !Array.isArray(metadata) ? { ...metadata } : {};
  const trimmed = actorRole != null ? String(actorRole).trim() : "";
  if (trimmed && base.actorRole === undefined) {
    base.actorRole = trimmed;
  }
  return Object.keys(base).length > 0 ? base : null;
}

async function insertAuditAndOutbox(
  executor: AuditDbExecutor | typeof db,
  params: LogAuditParams,
): Promise<void> {
  const auditId = randomUUID();
  const occurredAt = new Date();
  const mergedMetadata = mergeAuditMetadata(params.metadata, params.actorRole);

  await executor.insert(auditLogs).values({
    id: auditId,
    clinicId: params.clinicId,
    actionType: params.actionType,
    performedBy: params.performedBy,
    performedByEmail: params.performedByEmail,
    targetId: params.targetId ?? null,
    targetType: params.targetType ?? null,
    metadata: mergedMetadata,
    timestamp: occurredAt,
  });

  await executor.insert(eventOutbox).values({
    clinicId: params.clinicId,
    type: OUTBOX_TYPE_AUDIT_LOG,
    payload: {
      auditLogId: auditId,
      actionType: params.actionType,
      performedBy: params.performedBy,
      performedByEmail: params.performedByEmail,
      targetId: params.targetId ?? null,
      targetType: params.targetType ?? null,
      metadata: mergedMetadata,
    },
    occurredAt,
  });
}

export function logAudit(params: LogAuditWithTxParams): Promise<void>;
export function logAudit(params: LogAuditParams): void;
export function logAudit(params: LogAuditParams & { tx?: AuditDbExecutor }): void | Promise<void> {
  try {
    if (!params.clinicId) {
      console.error("[audit] skipped: missing clinicId", { actionType: params.actionType });
      return;
    }

    const { tx, ...auditParams } = params;

    if (tx) {
      return insertAuditAndOutbox(tx, auditParams);
    }

    void db
      .transaction(async (innerTx) => {
        await insertAuditAndOutbox(innerTx, auditParams);
      })
      .catch((err) => {
        console.error("[audit] Failed to write audit log:", err);
      });
  } catch (err) {
    console.error("[audit] write failed (non-fatal):", {
      action: params.actionType,
      targetId: params.targetId,
      err: err instanceof Error ? err.message : err,
    });
  }
}
