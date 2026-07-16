import { t } from "@/lib/i18n";
import type { BoardMember, BoardPeerCursor } from "./useBoardCoPresence";

type Props = {
  peerCursors: BoardPeerCursor[];
  presentMembers: BoardMember[];
};

/**
 * R-RTC-1.3 · Feature 2 — the EPHEMERAL board overlay. Pure presentation: it maps
 * each peer's server-attached, NORMALIZED {x,y} back to the board viewport and
 * shows who is on the board. It owns no durable state, never fetches, and renders
 * NOTHING when there are no peers — so a socket-down board is byte-identical to
 * today's static kiosk. Peer SELECTION highlights are NOT drawn here — they render
 * as a visible ring on the selected board entity itself (see useBoardEntityCoPresence),
 * because a normalized cursor overlay cannot know an entity's on-screen rect.
 */
export function BoardCoPresenceOverlay({ peerCursors, presentMembers }: Props) {
  const nameOf = (userId: string): string =>
    presentMembers.find((m) => m.userId === userId)?.displayName ?? "";

  const hasPeers = presentMembers.length > 0 || peerCursors.length > 0;
  if (!hasPeers) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-40 overflow-hidden"
      data-board-copresence-overlay
      aria-hidden="true"
    >
      {presentMembers.length > 0 && (
        <div
          className="absolute right-4 top-4 flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/80 backdrop-blur"
          data-board-copresence
        >
          <span className="font-medium uppercase tracking-wide text-white/60">
            {t.board.collab.present}
          </span>
          <span className="flex items-center gap-1.5">
            {presentMembers.map((m) => (
              <span
                key={m.userId}
                className="rounded-full bg-white/15 px-2 py-0.5 text-white/90"
                data-board-present={m.userId}
              >
                {m.displayName}
              </span>
            ))}
          </span>
        </div>
      )}

      {peerCursors.map((c) => (
        <div
          key={c.userId}
          className="absolute flex -translate-x-1 -translate-y-1 items-center gap-1"
          style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
          data-testid={`board-cursor-${c.userId}`}
        >
          <span className="h-2.5 w-2.5 rounded-full bg-sky-400 shadow-[0_0_0_2px_rgba(0,0,0,0.4)]" />
          {nameOf(c.userId) && (
            <span className="whitespace-nowrap rounded bg-sky-500/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
              {nameOf(c.userId)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
