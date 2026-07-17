/**
 * R-RTC-1.4 (integration) — the SECURITY-sensitive record co-presence fan-out over a
 * REAL Socket.io server + clients on a live port (panel #6 coverage gap).
 *
 * The `record-presence` handler in server.ts derives recordType+recordId from the
 * socket's AUTHORIZED room membership, attaches the SERVER identity, and restricts the
 * fan-out to `:record:` rooms only. Every other collab test stubs the record ACL or
 * asserts room-name shape; NONE drives the live fan-out. A regression that trusted a
 * client-supplied recordId (leaking peer-record to a record the socket never joined) or
 * a client-supplied userId (spoofed identity) would pass the whole existing suite.
 *
 * This proves, end-to-end:
 *   - two sockets in the SAME clinic:<id>:record:equipment:<id> room see each other's
 *     peer-record tagged with the SERVER-attached userId (client claim ignored);
 *   - a client-supplied userId/recordId in the record-presence PAYLOAD is ignored — the
 *     server derives both from room membership, so the fan-out still reaches only the
 *     joined room with the DB identity;
 *   - a socket in a DIFFERENT record room (same clinic) receives NO peer-record;
 *   - a socket NOT in any record room receives NO peer-record, and a sender that holds
 *     no record room fans out nothing at all;
 *   - co-presence is ADVISORY: two sockets can both be "editing" the same record at once
 *     (no exclusive lock) and record-presence carries no ack that could block an edit.
 *
 * Live-server style (own http.Server + injected identity resolver, no Clerk/DB/Redis).
 * Run: pnpm test tests/collab-record-presence.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { type AddressInfo } from "node:net";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { initCollabServer, type CollabServer } from "../server/lib/realtime-collab/server.js";
import type { ResolveHandshakeIdentity } from "../server/lib/realtime-collab/handshake.js";

// Identity is encoded in the token for the test; the resolver "reads it from the DB" —
// the client never dictates identity, the resolver does.
const resolveIdentity: ResolveHandshakeIdentity = async (token) => {
  try {
    const parsed = JSON.parse(token) as { userId: string; clinicId: string };
    return { userId: parsed.userId, clinicId: parsed.clinicId, role: "vet", displayName: parsed.userId };
  } catch {
    return null;
  }
};

let httpServer: HttpServer;
let collab: CollabServer;
let url: string;
const openSockets: ClientSocket[] = [];

function connect(auth: Record<string, unknown> | undefined): ClientSocket {
  const s = ioClient(url, {
    path: "/collab-ws",
    transports: ["websocket"],
    auth,
    reconnection: false,
    forceNew: true,
  });
  openSockets.push(s);
  return s;
}

function waitConnect(s: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    s.on("connect", () => resolve());
    s.on("connect_error", (e) => reject(e));
    setTimeout(() => reject(new Error("connect timeout")), 4_000);
  });
}

interface PeerRecord {
  userId: string;
  mode: string;
}

/** Resolve with the FIRST peer-record this socket receives, or reject on timeout. */
function nextPeerRecord(s: ClientSocket, timeoutMs = 1_500): Promise<PeerRecord> {
  return new Promise((resolve, reject) => {
    s.once("peer-record", (p) => resolve(p as PeerRecord));
    setTimeout(() => reject(new Error("peer-record timeout")), timeoutMs);
  });
}

/** Collect every peer-record over `windowMs`, then resolve with the list. */
function collectPeerRecords(s: ClientSocket, windowMs = 400): Promise<PeerRecord[]> {
  const seen: PeerRecord[] = [];
  s.on("peer-record", (p) => seen.push(p as PeerRecord));
  return new Promise((resolve) => setTimeout(() => resolve(seen), windowMs));
}

const tokenFor = (userId: string, clinicId: string) => JSON.stringify({ userId, clinicId });

/** Join a record room and await the server ack; returns the authorized room name. */
function joinRecord(s: ClientSocket, recordType: string, recordId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    s.emit("join", { kind: "record", recordType, recordId }, (ack: unknown) => {
      const a = ack as { ok?: boolean; room?: string; reason?: string };
      if (a?.ok && a.room) resolve(a.room);
      else reject(new Error(`join failed: ${a?.reason ?? "unknown"}`));
    });
  });
}

function joinKind(s: ClientSocket, kind: "chat" | "board"): Promise<void> {
  // Mirror joinRecord: REJECT on a non-ok ack. Resolving on EVERY ack regardless of
  // `ack.ok` would let a rejected chat/board join yield a false "chat-only peer" pass
  // (the socket never actually entered the room). — PR#112 (d).
  return new Promise((resolve, reject) => {
    s.emit("join", { kind }, (ack: unknown) => {
      const a = ack as { ok?: boolean; reason?: string };
      if (a?.ok) resolve();
      else reject(new Error(`join failed: ${a?.reason ?? "unknown"}`));
    });
  });
}

beforeAll(async () => {
  httpServer = createServer();
  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
  const port = (httpServer.address() as AddressInfo).port;
  url = `http://127.0.0.1:${port}`;
  collab = await initCollabServer(httpServer, {
    resolveIdentity,
    // The join ACL is exercised by collab-record-access.integration.test.ts; here we
    // grant every record join so the test can isolate the FAN-OUT behavior — the point
    // is that the fan-out uses the room the socket actually joined, never the payload.
    recordAccess: async () => true,
    skipRedisAdapter: true,
  });
  expect(collab.enabled).toBe(true);
});

afterAll(async () => {
  for (const s of openSockets) s.close();
  await collab?.close();
  await new Promise<void>((r) => httpServer.close(() => r()));
});

describe("R-RTC-1.4 record co-presence fan-out — integration (panel #6)", () => {
  it("two sockets in the SAME record room exchange peer-record with a SERVER-attached userId; a spoofed payload userId/recordId is IGNORED", async () => {
    const a = connect({ token: tokenFor("alice", "clinic-A"), userId: "SPOOFED" });
    const b = connect({ token: tokenFor("bob", "clinic-A") });
    await Promise.all([waitConnect(a), waitConnect(b)]);
    await Promise.all([joinRecord(a, "equipment", "eq-1"), joinRecord(b, "equipment", "eq-1")]);

    const got = nextPeerRecord(b);
    // The client crams a spoofed identity AND a foreign recordId into the payload. The
    // server reads ONLY `editing`; recordType/recordId come from room membership, userId
    // from the DB-resolved identity. If the server trusted payload.recordId, the fan-out
    // would target a room `b` is not in and this would time out; if it trusted
    // payload.userId, the assertion below would see "SPOOFED".
    a.emit("record-presence", { editing: true, userId: "SPOOFED", recordType: "task", recordId: "eq-999" });
    const evt = await got;
    expect(evt.userId).toBe("alice");
    expect(evt.mode).toBe("editing");
  });

  it("derives mode from the payload's `editing` flag: an absent flag → mode 'viewing'", async () => {
    const a = connect({ token: tokenFor("alice", "clinic-A") });
    const b = connect({ token: tokenFor("bob", "clinic-A") });
    await Promise.all([waitConnect(a), waitConnect(b)]);
    await Promise.all([joinRecord(a, "equipment", "eq-mode"), joinRecord(b, "equipment", "eq-mode")]);

    const got = nextPeerRecord(b);
    a.emit("record-presence", {});
    const evt = await got;
    expect(evt.userId).toBe("alice");
    expect(evt.mode).toBe("viewing");
  });

  it("a socket in a DIFFERENT record room (same clinic) receives NO peer-record — recordId is derived from membership, not spoofable", async () => {
    const a = connect({ token: tokenFor("alice", "clinic-A") });
    const other = connect({ token: tokenFor("bob", "clinic-A") });
    await Promise.all([waitConnect(a), waitConnect(other)]);
    // a holds eq-1; `other` holds eq-2. A payload claiming eq-2 must NOT reach `other`.
    await Promise.all([joinRecord(a, "equipment", "eq-1"), joinRecord(other, "equipment", "eq-2")]);

    const collected = collectPeerRecords(other);
    a.emit("record-presence", { editing: true, recordId: "eq-2", recordType: "equipment" });
    expect(await collected).toEqual([]);
  });

  it("a socket NOT in any record room receives NO peer-record; a sender holding no record room fans out nothing", async () => {
    const chatOnly = connect({ token: tokenFor("carol", "clinic-A") });
    const recordSocket = connect({ token: tokenFor("alice", "clinic-A") });
    await Promise.all([waitConnect(chatOnly), waitConnect(recordSocket)]);
    await joinKind(chatOnly, "chat");
    await joinRecord(recordSocket, "equipment", "eq-only");

    // 1) A record-room sender never leaks to a non-record (chat) peer.
    const chatCollected = collectPeerRecords(chatOnly);
    recordSocket.emit("record-presence", { editing: true });
    expect(await chatCollected).toEqual([]);

    // 2) A sender that holds NO record room (chat only) emits record-presence → the
    //    per-room loop skips (no `:record:` room) → nobody, anywhere, gets peer-record.
    const peer = connect({ token: tokenFor("dave", "clinic-A") });
    await waitConnect(peer);
    await joinRecord(peer, "equipment", "eq-only");
    const peerCollected = collectPeerRecords(peer);
    chatOnly.emit("record-presence", { editing: true, recordId: "eq-only", recordType: "equipment" });
    expect(await peerCollected).toEqual([]);
  });

  it("co-presence is ADVISORY: two sockets both 'editing' the same record coexist (no lock) and record-presence carries no ack that could block an edit", async () => {
    const a = connect({ token: tokenFor("alice", "clinic-A") });
    const b = connect({ token: tokenFor("bob", "clinic-A") });
    await Promise.all([waitConnect(a), waitConnect(b)]);
    await Promise.all([joinRecord(a, "equipment", "eq-shared"), joinRecord(b, "equipment", "eq-shared")]);

    const aSees = nextPeerRecord(a);
    const bSees = nextPeerRecord(b);
    // Both declare themselves editing at once. An advisory channel lets both through —
    // there is no server-side lock that rejects the second editor.
    a.emit("record-presence", { editing: true });
    b.emit("record-presence", { editing: true });
    const [aEvt, bEvt] = await Promise.all([aSees, bSees]);
    expect(aEvt).toEqual({ userId: "bob", mode: "editing" });
    expect(bEvt).toEqual({ userId: "alice", mode: "editing" });

    // record-presence is fire-and-forget: the server registers NO ack, so a callback
    // passed by the client is never invoked. There is no return channel that could deny
    // or gate an edit — the co-presence signal can never block a mutation.
    let ackInvoked = false;
    a.emit("record-presence", { editing: true }, () => {
      ackInvoked = true;
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(ackInvoked).toBe(false);
  });
});
