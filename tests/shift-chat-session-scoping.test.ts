/**
 * BUG-001 — Shift Chat must show only the CURRENT open shift's messages.
 *
 * The panel accumulates polled messages so the transcript grows without a full
 * refetch. `reconcileMessages` scopes that accumulation to the session the
 * SERVER reports as open (`shiftSessionId`), never inferred from the messages:
 *   - no open shift (null) → clear immediately (the "messages still appear" fix)
 *   - shift rollover → previous session drops out
 *   - same shift → append + dedupe
 */
import { describe, it, expect } from "vitest";
import type { ShiftMessage } from "@/features/shift-chat/types";
import { reconcileMessages } from "@/features/shift-chat/message-scoping";

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

describe("reconcileMessages — BUG-001 session scoping", () => {
  it("clears immediately when there is no open shift (server session → null)", () => {
    const prev = [msg("a", "s-1"), msg("b", "s-1")];
    expect(reconcileMessages(prev, [], "s-1", null)).toEqual([]);
  });

  it("stays empty (by reference) when already empty and no shift is open", () => {
    const prev: ShiftMessage[] = [];
    expect(reconcileMessages(prev, [], null, null)).toBe(prev);
  });

  it("loads the full batch on first open (prev session unknown)", () => {
    const result = reconcileMessages([], [msg("a", "s-1"), msg("b", "s-1")], null, "s-1");
    expect(result.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("accumulates new messages within the same session", () => {
    const prev = [msg("a", "s-1")];
    const result = reconcileMessages(prev, [msg("b", "s-1")], "s-1", "s-1");
    expect(result.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("dedupes messages already present by id (same reference when nothing new)", () => {
    const prev = [msg("a", "s-1"), msg("b", "s-1")];
    expect(reconcileMessages(prev, [msg("b", "s-1")], "s-1", "s-1")).toBe(prev);
  });

  it("returns prev by reference when the batch is empty within the same session", () => {
    const prev = [msg("a", "s-1")];
    expect(reconcileMessages(prev, [], "s-1", "s-1")).toBe(prev);
  });

  it("swaps in the new conversation when the shift rolls over", () => {
    const prev = [msg("a", "s-1"), msg("b", "s-1")];
    const result = reconcileMessages(prev, [msg("c", "s-2")], "s-1", "s-2");
    expect(result.map((m) => m.id)).toEqual(["c"]);
    expect(result.every((m) => m.shiftSessionId === "s-2")).toBe(true);
  });

  it("scopes a boundary batch that mixes sessions to the new session only", () => {
    const prev = [msg("a", "s-1")];
    const result = reconcileMessages(prev, [msg("a", "s-1"), msg("c", "s-2")], "s-1", "s-2");
    expect(result.map((m) => m.id)).toEqual(["c"]);
  });
});
