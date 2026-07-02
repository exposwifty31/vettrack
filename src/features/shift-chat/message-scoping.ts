import type { ShiftMessage } from "./types";

/**
 * Merge a freshly-polled batch of messages into the local accumulator, scoped
 * to the current shift session (BUG-001).
 *
 * The chat panel accumulates messages across polls so the transcript grows
 * without a full refetch. Accumulation must never retain messages from a prior
 * shift session: when the active shift rolls over while the panel is open, the
 * new session's messages define the current conversation and the previous
 * session's messages must drop out. The current session is taken from the most
 * recent incoming message.
 *
 * Returns `prev` by reference when nothing changed, so React can skip the
 * re-render.
 */
export function mergeSessionScoped(
  prev: ShiftMessage[],
  incoming: ShiftMessage[],
): ShiftMessage[] {
  if (incoming.length === 0) return prev;

  // Safe: the length === 0 early return above guarantees a last element exists.
  const currentSession = incoming[incoming.length - 1]!.shiftSessionId;
  const existingIds = new Set(prev.map((m) => m.id));
  const newOnes = incoming.filter((m) => !existingIds.has(m.id));
  const merged = newOnes.length > 0 ? [...prev, ...newOnes] : prev;

  const scoped = merged.filter((m) => m.shiftSessionId === currentSession);
  return scoped.length === merged.length ? merged : scoped;
}
