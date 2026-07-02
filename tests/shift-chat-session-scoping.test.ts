/**
 * BUG-001 — Shift Chat retains stale messages across a shift-session change.
 *
 * The panel accumulates polled messages so the transcript grows without a full
 * refetch. `mergeSessionScoped` must scope that accumulation to the CURRENT
 * shift session: when the active shift rolls over while the panel is open, the
 * previous session's messages must drop out instead of lingering forever.
 */
import { describe, it, expect } from "vitest";
import type { ShiftMessage } from "@/features/shift-chat/types";
import { mergeSessionScoped } from "@/features/shift-chat/message-scoping";

// Distinct, monotonically increasing createdAt per synthetic message so
// ordering assertions can't pass by coincidence of identical timestamps.
let _msgSeq = 0;
const msg = (id: string, shiftSessionId: string): ShiftMessage => ({
  id,
  shiftSessionId,
  clinicId: "c-1",
  senderId: "u-1",
  senderName: "Dana",
  senderRole: "vet_tech",
  body: `body-${id}`,
  type: "regular",
  broadcastKey: null,
  systemEventType: null,
  systemEventPayload: null,
  roomTag: null,
  isUrgent: false,
  mentionedUserIds: [],
  pinnedAt: null,
  pinnedByUserId: null,
  createdAt: new Date(Date.UTC(2026, 6, 2, 10, 0, _msgSeq++)).toISOString(),
  acks: [],
  reactions: [],
});

describe("mergeSessionScoped — BUG-001 session scoping", () => {
  it("accumulates new messages within the same session", () => {
    const prev = [msg("a", "s-1")];
    const result = mergeSessionScoped(prev, [msg("a", "s-1"), msg("b", "s-1")]);
    expect(result.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("dedupes messages already present by id", () => {
    const prev = [msg("a", "s-1"), msg("b", "s-1")];
    const result = mergeSessionScoped(prev, [msg("b", "s-1")]);
    expect(result).toBe(prev); // nothing new, same reference
  });

  it("drops prior-session messages when a new session's message arrives", () => {
    const prev = [msg("a", "s-1"), msg("b", "s-1")];
    const result = mergeSessionScoped(prev, [msg("c", "s-2")]);
    expect(result.map((m) => m.id)).toEqual(["c"]);
    expect(result.every((m) => m.shiftSessionId === "s-2")).toBe(true);
  });

  it("returns prev by reference when the batch is empty", () => {
    const prev = [msg("a", "s-1")];
    expect(mergeSessionScoped(prev, [])).toBe(prev);
  });

  it("keeps only the current session when a batch mixes sessions at the boundary", () => {
    const prev = [msg("a", "s-1")];
    const result = mergeSessionScoped(prev, [msg("a", "s-1"), msg("c", "s-2")]);
    expect(result.map((m) => m.id)).toEqual(["c"]);
  });
});
