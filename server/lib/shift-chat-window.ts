/**
 * Roster-derived chat session window (BUG-001 root-cause fix).
 *
 * Shift-chat used to scope its conversation to the open `vt_shift_sessions`
 * row — but that clock-in table is orphaned (nothing ever writes or ends a
 * row), so one stale never-ended row kept the same transcript alive for
 * weeks. The conversation is now anchored to the caller's current roster
 * shift window (`vt_shifts` via resolveCurrentRole — the same authority the
 * home dashboard and Strategy A read), with a deterministic synthetic id
 * that rolls over when the window does.
 */
import { and, eq, gt, gte, lt, type SQL } from "drizzle-orm";
import { shiftMessages } from "../schema/ops.js";
import {
  resolveCurrentRole,
  type PermanentVetTrackRole,
} from "./role-resolution.js";
import { windowBounds, windowSessionId } from "./shift-window.js";

export interface ChatWindow {
  id: string;
  startedAt: Date;
  endsAt: Date;
}

export interface ChatWindowInput {
  clinicId: string;
  userId: string;
  userName: string;
  fallbackRole: PermanentVetTrackRole;
  secondaryRole?: string | null;
  now?: Date;
}

/** The caller's current roster shift window, or null when off-shift. */
export async function getCurrentShiftWindow(input: ChatWindowInput): Promise<ChatWindow | null> {
  const { source, activeShift } = await resolveCurrentRole(input);
  if (source !== "shift" || !activeShift) return null;
  return { id: windowSessionId(input.clinicId, activeShift), ...windowBounds(activeShift) };
}

/**
 * WHERE condition scoping `vt_shift_messages` to a clinic + window by
 * `createdAt` — never by the legacy session FK. Shared by the route and the
 * regression test so both exercise the same filter.
 */
export function windowMessagesWhere(
  clinicId: string,
  window: ChatWindow,
  after?: Date,
): SQL | undefined {
  return and(
    eq(shiftMessages.clinicId, clinicId),
    gte(shiftMessages.createdAt, window.startedAt),
    lt(shiftMessages.createdAt, window.endsAt),
    after ? gt(shiftMessages.createdAt, after) : undefined,
  );
}
