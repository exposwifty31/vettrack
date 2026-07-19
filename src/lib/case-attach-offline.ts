/**
 * VetTrack 2.0 — Case Spine offline attach (task 0.2 spike, client side).
 *
 * Proves the offline half of the spike: an "attach this event to a case"
 * action taken while offline is queued locally and reconciles on reconnect
 * through the ALREADY-PROVEN pendingSync queue + sync-engine `processQueue`
 * machinery (option (a) — reuse, not a new Dexie store). See
 * docs/plans/2.0/case-spine-spike-findings.md for the reasoning.
 *
 * NOTE (spike boundary): the real `addPendingSync` enqueue passes through
 * `assertPendingSyncEnqueueAllowed`, which requires an offline-mutation-registry
 * allow-producer entry. That registry row + the server route are Task 1.2 work;
 * this helper is exercised in tests with `offline-db` mocked, exactly like the
 * existing OFF-05 sync-engine tests.
 */
import { addPendingSync } from "./offline-db";
import { isOnline } from "./safe-browser";

export interface CaseAttachPayload {
  /** Operational case to attach to. */
  caseId: string;
  /** The physical event being attached. Spike proves the dispense path. */
  dispenseEventId: string;
  /** Clinic scope — carried so the server can enforce multi-tenancy. */
  clinicId: string;
}

/** Canonical attach endpoint (Task 1.2 implements the route + auth + clinicId check). */
export function buildCaseAttachEndpoint(caseId: string): string {
  return `/api/cases/${caseId}/attachments`;
}

export function buildCaseAttachBody(payload: CaseAttachPayload): string {
  return JSON.stringify({
    dispenseEventId: payload.dispenseEventId,
    clinicId: payload.clinicId,
  });
}

export type CaseAttachOutcome =
  | { mode: "online" }
  | { mode: "queued"; pendingId: number | undefined };

/**
 * Attach an event to a case. Offline → enqueue on the pendingSync queue for
 * `processQueue` to reconcile later. Online → the caller performs the direct
 * POST (returned as `mode: "online"`); the spike proves the offline path.
 */
export async function queueCaseAttachIfOffline(
  payload: CaseAttachPayload,
): Promise<CaseAttachOutcome> {
  if (isOnline()) {
    return { mode: "online" };
  }

  const pendingId = await addPendingSync({
    type: "case_attach",
    endpoint: buildCaseAttachEndpoint(payload.caseId),
    method: "POST",
    body: buildCaseAttachBody(payload),
    createdAt: new Date(),
    retries: 0,
    status: "pending",
    clientTimestamp: Date.now(),
  });

  return { mode: "queued", pendingId };
}
