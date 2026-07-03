import type { ShiftMessage } from "./types";

/**
 * Reconcile a freshly-polled batch into the local accumulator, scoped to the
 * shift session the SERVER reports as currently open (BUG-001).
 *
 * The chat panel accumulates messages across incremental polls so the transcript
 * grows without a full refetch. The current session is taken from the server's
 * authoritative `shiftSessionId` — never inferred from the messages — so the two
 * cases the old inference got wrong are now correct:
 *
 *   - `currentSessionId === null` (no open shift, e.g. the shift just ended):
 *     the panel empties immediately. An empty poll batch is otherwise
 *     ambiguous ("no new messages" vs "no shift"); the session id disambiguates.
 *   - `currentSessionId !== prevSessionId` (shift rolled over): the incoming
 *     batch defines the new conversation; the previous session drops out.
 *
 * Within one session, new messages are appended and deduped by id. Returns
 * `prev` by reference when nothing changed so React can skip the re-render.
 */
export function reconcileMessages(
  prev: ShiftMessage[],
  incoming: ShiftMessage[],
  prevSessionId: string | null,
  currentSessionId: string | null,
): ShiftMessage[] {
  if (currentSessionId === null) return prev.length === 0 ? prev : [];

  if (currentSessionId !== prevSessionId) {
    return incoming.filter((m) => m.shiftSessionId === currentSessionId);
  }

  if (incoming.length === 0) return prev;
  const existingIds = new Set(prev.map((m) => m.id));
  const fresh = incoming.filter(
    (m) => !existingIds.has(m.id) && m.shiftSessionId === currentSessionId,
  );
  return fresh.length > 0 ? [...prev, ...fresh] : prev;
}
