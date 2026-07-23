/**
 * VetTrack 2.0, Task 1.1 §1.5 (option 1, nudge-only) — the `proposal-queue`
 * collab room. Mirrors `tests/collab-ws-auth.test.ts`'s
 * `authorizeRoomJoin` coverage for the existing `chat`/`board` rooms: same
 * auth shape (clinic-membership only, no record ACL), cross-clinic join is
 * impossible by construction (the room name is built from the socket's own
 * `identity.clinicId`, never client input).
 */
import { describe, it, expect } from "vitest";
import {
  authorizeRoomJoin,
  proposalQueueRoom,
  type CollabIdentity,
  type RecordAccessCheck,
} from "../server/lib/realtime-collab/rooms.js";

const IDENTITY: CollabIdentity = {
  userId: "user-1",
  clinicId: "clinic-A",
  role: "lead_technician",
  displayName: "Lead Tech",
};

describe("proposalQueueRoom — R-RTC-1 / Task 1.1 §1.5", () => {
  it("builds a clinic-scoped room name", () => {
    expect(proposalQueueRoom("clinic-A")).toBe("clinic:clinic-A:proposal-queue");
    expect(proposalQueueRoom("clinic-B")).toBe("clinic:clinic-B:proposal-queue");
  });

  it("authorizes a proposal-queue join from the socket's OWN clinicId only (no record ACL)", async () => {
    const acl: RecordAccessCheck = async () => {
      throw new Error("record ACL must never be consulted for a proposal-queue join");
    };
    const decision = await authorizeRoomJoin(IDENTITY, { kind: "proposal-queue" }, acl);
    expect(decision).toEqual({ ok: true, room: proposalQueueRoom("clinic-A") });
  });

  it("cannot be joined for a different clinic (no client-supplied clinicId in the request shape)", async () => {
    const decision = await authorizeRoomJoin(IDENTITY, { kind: "proposal-queue" }, async () => true);
    expect(decision.ok && decision.room.includes("clinic-A")).toBe(true);
    expect(decision.ok && decision.room.includes("clinic-B")).toBe(false);
  });
});
