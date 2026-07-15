/**
 * S2-7 (pre-PR review, MINOR): the clinic's "manager tier" for broadcast
 * notifications (no single holder to notify — e.g. a returned item, or an
 * escalation that's been opened to all). DB roles are
 * admin | vet | technician | student (no `manager` role string in the
 * schema) — admin + vet are the management tier that gets these broadcasts.
 * Single shared constant so server/workers/sweep-escalation.worker.ts and
 * server/workers/stale-returned-sweep.worker.ts can't drift on the role set.
 */
export const MANAGER_NOTIFY_ROLES = ["admin", "vet"] as const;
