/**
 * VetTrack 2.0, Task 1.1 §1.5 (option 1, nudge-only) — advisory "the
 * approval queue changed, go refetch" ping over the collab channel.
 *
 * Binding contract (payload-tested in `tests/collab-proposal-queue-nudge.test.ts`):
 *  - The emitted payload is EXACTLY `{ kind: "proposal_queue_changed" }` —
 *    never a proposal id, kind, summary, citation, or count. This channel
 *    NEVER carries domain state (`server/lib/realtime-collab/server.ts:1-9`);
 *    the REST route (`GET /api/action-proposals`) stays the sole authority,
 *    this is only a "go refetch" ping.
 *  - `notifyProposalQueueChanged` NEVER throws and NEVER blocks its caller —
 *    collab-disabled, an uninitialized io singleton, and an `io.to().emit()`
 *    failure are all swallowed and logged at debug. Call sites (route
 *    handlers, workers) call this fire-and-forget after a successful
 *    decision/stage — it must never be able to fail the surrounding request
 *    or scan.
 */
import { getCollabIo } from "./registry.js";
import { proposalQueueRoom } from "./rooms.js";

export function notifyProposalQueueChanged(clinicId: string): void {
  try {
    const io = getCollabIo();
    if (!io) {
      console.debug("[collab-ws] proposal-queue nudge skipped — collab channel not initialized");
      return;
    }
    io.to(proposalQueueRoom(clinicId)).emit("proposal-queue-changed", { kind: "proposal_queue_changed" });
  } catch (err) {
    console.debug("[collab-ws] proposal-queue nudge failed (non-fatal)", err);
  }
}
