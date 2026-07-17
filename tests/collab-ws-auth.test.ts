/**
 * R-RTC-1.1 — handshake auth + room-join authorization (pure logic).
 *
 * Proves the security contract the bot violated: untrusted origin rejected first,
 * cookie-only (no bearer) rejected, client-claimed identity ignored, no cross-clinic
 * join, and same-clinic-but-unauthorized record-room joins rejected.
 */
import { describe, it, expect, vi } from "vitest";
import { validateHandshake, type ResolveHandshakeIdentity } from "../server/lib/realtime-collab/handshake.js";
import {
  authorizeRoomJoin,
  chatRoom,
  boardRoom,
  recordRoom,
  type CollabIdentity,
  type RecordAccessCheck,
} from "../server/lib/realtime-collab/rooms.js";

const IDENTITY: CollabIdentity = {
  userId: "user-1",
  clinicId: "clinic-A",
  role: "vet",
  displayName: "Dr. A",
};

const okResolver: ResolveHandshakeIdentity = async () => IDENTITY;
const prodEnv = { NODE_ENV: "production", COLLAB_WS_ALLOWED_ORIGINS: "https://app.vettrack.uk" } as NodeJS.ProcessEnv;

describe("validateHandshake — R-RTC-1.1", () => {
  it("rejects an untrusted Origin BEFORE session validation", async () => {
    const resolver = vi.fn(okResolver);
    const r = await validateHandshake(
      { origin: "https://evil.example", authToken: "tok" },
      resolver,
      prodEnv,
    );
    expect(r).toEqual({ ok: false, reason: "UNTRUSTED_ORIGIN" });
    expect(resolver).not.toHaveBeenCalled(); // never reached the session
  });

  it("rejects a cookie-only handshake (no bearer token)", async () => {
    const r = await validateHandshake(
      { origin: "https://app.vettrack.uk", authToken: undefined },
      okResolver,
      prodEnv,
    );
    expect(r).toEqual({ ok: false, reason: "MISSING_BEARER_TOKEN" });
  });

  it("ignores a client-claimed userId — identity comes from the resolver (DB session)", async () => {
    const resolver: ResolveHandshakeIdentity = async () => IDENTITY;
    const r = await validateHandshake(
      { origin: "https://app.vettrack.uk", authToken: "tok", claimedUserId: "attacker-999" },
      resolver,
      prodEnv,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.identity.userId).toBe("user-1"); // NOT the claimed id
  });

  it("rejects an unauthenticated token (resolver returns null)", async () => {
    const r = await validateHandshake(
      { origin: "https://app.vettrack.uk", authToken: "bad" },
      async () => null,
      prodEnv,
    );
    expect(r).toEqual({ ok: false, reason: "UNAUTHENTICATED" });
  });

  it("allows an absent Origin only in non-production", async () => {
    const dev = await validateHandshake({ origin: undefined, authToken: "t" }, okResolver, { NODE_ENV: "development" } as NodeJS.ProcessEnv);
    expect(dev.ok).toBe(true);
    const prod = await validateHandshake({ origin: undefined, authToken: "t" }, okResolver, prodEnv);
    expect(prod).toEqual({ ok: false, reason: "UNTRUSTED_ORIGIN" });
  });
});

describe("authorizeRoomJoin — R-RTC-1.1 (no cross-clinic, record ACL)", () => {
  const allowAll: RecordAccessCheck = async () => true;
  const denyAll: RecordAccessCheck = async () => false;

  it("chat/board rooms are built from the socket's OWN clinicId (cross-clinic impossible)", async () => {
    const chat = await authorizeRoomJoin(IDENTITY, { kind: "chat" }, allowAll);
    const board = await authorizeRoomJoin(IDENTITY, { kind: "board" }, allowAll);
    expect(chat).toEqual({ ok: true, room: chatRoom("clinic-A") });
    expect(board).toEqual({ ok: true, room: boardRoom("clinic-A") });
    // There is no client-supplied clinicId in JoinRequest — the room can only ever
    // be for identity.clinicId, so a socket cannot join clinic-B's room.
    expect(chat.ok && chat.room.includes("clinic-A")).toBe(true);
  });

  it("allows a record join only when the record ACL passes", async () => {
    const ok = await authorizeRoomJoin(IDENTITY, { kind: "record", recordType: "task", recordId: "t1" }, allowAll);
    expect(ok).toEqual({ ok: true, room: recordRoom("clinic-A", "task", "t1") });
  });

  it("rejects a same-clinic record join the user is NOT authorized for", async () => {
    const denied = await authorizeRoomJoin(IDENTITY, { kind: "record", recordType: "task", recordId: "t1" }, denyAll);
    expect(denied).toEqual({ ok: false, reason: "RECORD_ACCESS_DENIED" });
  });

  it("rejects unknown record types and malformed ids before the ACL runs", async () => {
    const acl = vi.fn(allowAll);
    expect(await authorizeRoomJoin(IDENTITY, { kind: "record", recordType: "patient", recordId: "p1" }, acl)).toMatchObject({ ok: false, reason: "UNKNOWN_RECORD_TYPE" });
    expect(await authorizeRoomJoin(IDENTITY, { kind: "record", recordType: "task", recordId: "bad id!" }, acl)).toMatchObject({ ok: false, reason: "INVALID_RECORD_ID" });
    expect(acl).not.toHaveBeenCalled();
  });
});
