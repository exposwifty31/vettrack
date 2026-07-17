import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { BoardMember, BoardPeerSelection } from "./useBoardCoPresence";

/**
 * R-RTC-1.3 · Feature 2 — bridges the EPHEMERAL board co-presence hook (owned by
 * BoardShell) to the board content, so a real board entity can both:
 *  - report itself as the locally-highlighted entity via `selectEntity` (the
 *    producer the card requires `/board` to wire), and
 *  - render a VISIBLE highlight when a remote peer has it selected (consumer).
 *
 * FROZEN guardrails: advisory + ephemeral only. The default context is INERT
 * (no-op `selectEntity`, empty peer state), so board content rendered WITHOUT a
 * provider — socket down, other routes, existing tests — behaves EXACTLY as today:
 * no highlight, no error, nothing about board rendering gated on the socket. The
 * producer sends only the entity id; the server attaches identity.
 */
export interface BoardCoPresenceContextValue {
  selectEntity: (entityId: string | null) => void;
  peerSelections: BoardPeerSelection[];
  presentMembers: BoardMember[];
}

const INERT: BoardCoPresenceContextValue = {
  selectEntity: () => {},
  peerSelections: [],
  presentMembers: [],
};

const BoardCoPresenceContext = createContext<BoardCoPresenceContextValue>(INERT);

export function BoardCoPresenceProvider({
  selectEntity,
  peerSelections,
  presentMembers,
  children,
}: BoardCoPresenceContextValue & { children: ReactNode }) {
  const value = useMemo<BoardCoPresenceContextValue>(
    () => ({ selectEntity, peerSelections, presentMembers }),
    [selectEntity, peerSelections, presentMembers],
  );
  return <BoardCoPresenceContext.Provider value={value}>{children}</BoardCoPresenceContext.Provider>;
}

export interface BoardEntityCoPresence {
  /** True when at least one remote peer currently has this entity highlighted. */
  isPeerSelected: boolean;
  /** Display names of the peers highlighting this entity (advisory label). */
  peerNames: string[];
  /** Report this entity as the locally-highlighted one. No-op when degraded. */
  onSelect: () => void;
  /** Clear the local highlight. No-op when degraded. */
  onClear: () => void;
}

/**
 * Per-entity view of the board co-presence channel. A board card passes its stable
 * entity id and gets back whether a peer is highlighting it (+ who) and the
 * advisory select/clear handlers. Under the inert default context every field is
 * empty / a no-op, so a non-provided board is byte-identical to today.
 */
export function useBoardEntityCoPresence(entityId: string): BoardEntityCoPresence {
  const { selectEntity, peerSelections, presentMembers } = useContext(BoardCoPresenceContext);
  const onSelect = useCallback(() => selectEntity(entityId), [selectEntity, entityId]);
  const onClear = useCallback(() => selectEntity(null), [selectEntity]);
  return useMemo<BoardEntityCoPresence>(() => {
    const peers = peerSelections.filter((s) => s.entityId === entityId);
    const peerNames = peers
      .map((p) => presentMembers.find((m) => m.userId === p.userId)?.displayName ?? "")
      .filter((name): name is string => name.length > 0);
    return { isPeerSelected: peers.length > 0, peerNames, onSelect, onClear };
  }, [peerSelections, presentMembers, entityId, onSelect, onClear]);
}
