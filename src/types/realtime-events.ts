export type RealtimeEventType =
  | "RESET_STATE"
  | "TASK_CREATED"
  | "TASK_STARTED"
  | "TASK_COMPLETED"
  | "TASK_APPROVED"
  | "TASK_UPDATED"
  | "TASK_CANCELLED"
  | "AUTOMATION_TRIGGERED"
  /** Domain mutation committed a request to notify (same TX); delivery is asynchronous. */
  | "NOTIFICATION_REQUESTED"
  /** Push/WebPush accepted by at least one endpoint after successful vendor API call. */
  | "NOTIFICATION_SENT"
  /** Push/WebPush could not be delivered (network, invalid subscription, circuit open, etc.). */
  | "NOTIFICATION_FAILED"
  | "ER_INTAKE_CREATED"
  | "ER_INTAKE_UPDATED"
  | "ER_MODE_CHANGED"
  | "QUEUE_SEVERITY_ESCALATED"
  | "ER_HANDOFF_CREATED"
  | "ER_HANDOFF_ACKNOWLEDGED"
  | "ER_HANDOFF_SLA_BREACHED"
  /** Ward / hospitalization → ward display snapshot refresh (outbox); “WARD_*” naming maps here. */
  | "PATIENT_STATUS_UPDATED"
  /** Code Blue session started or ended — triggers display snapshot refresh. */
  | "CODE_BLUE_STATUS_CHANGED"
  /** Container dispense / emergency reconciliation — inventory + billing committed with this outbox row. */
  | "INVENTORY_ALERT"
  /** Medication charged without matching active order / admission (Smart Cop). */
  | "POTENTIAL_ORPHAN_USE"
  /** Cabinet charge to patient A but no matching medication administration within the policy window. */
  | "SUSPECTED_ORPHAN_STOCK"
  /** Medication task completed without a prior matching cabinet dispense (probable leftover use). */
  | "PROBABLE_ORPHAN_USAGE"
  /** Reconcile or retroactive billing cleared a shadow-inventory alert. */
  | "SHADOW_ORPHAN_ALERT_RESOLVED"
  | "EQUIPMENT_CUSTODY_STATE_CHANGED"
  | "EQUIPMENT_USAGE_STATE_CHANGED"
  | "EQUIPMENT_READINESS_STATE_CHANGED"
  | "EQUIPMENT_DOCK_RETURN"
  | "EQUIPMENT_STAGED"
  | "EQUIPMENT_STAGE_CANCELLED"
  | "EQUIPMENT_EMERGENCY_CHECKOUT"
  | "EQUIPMENT_WAITLIST_JOINED"
  | "EQUIPMENT_WAITLIST_LEFT"
  | "EQUIPMENT_WAITLIST_PROMOTED"
  | "EQUIPMENT_WAITLIST_AVAILABLE"
  | "EQUIPMENT_WAITLIST_EXPIRED"
  | "EQUIPMENT_RFID_OBSERVED";

export type RealtimeEvent = {
  type: RealtimeEventType;
  payload: unknown;
  timestamp: string;
  /** Monotonic `vt_event_outbox.id` when sourced from the outbox SSE (`id` field / legacy `outboxId`). */
  id?: number;
  /** @deprecated Use `id` — kept for older payloads. */
  outboxId?: number;
  eventVersion?: number;
};
