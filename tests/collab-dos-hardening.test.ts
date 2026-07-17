/**
 * R-RTC-1 card H2H3 — DoS + unhandled-rejection hardening.
 *
 * H3: authorizeRoomJoin must NOT throw on a malformed request (`socket.emit("join")`
 *     with no arg, or `join, null`) — it returns INVALID_JOIN_REQUEST instead of
 *     letting a TypeError escape into the async listener (unhandled rejection).
 * H2: join / chat-nudge (and the other control events) are rate-limited, and a socket
 *     cannot hold more than MAX_ROOMS_PER_SOCKET rooms — bounding both DB round-trips
 *     per join and the unbounded socket.data.rooms Set.
 *
 * Isolation is unchanged: rooms are still built only from identity.clinicId, every
 * assertion stays within one clinic, and no emergency/SSE surface is touched.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { type AddressInfo } from "node:net";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { initCollabServer, type CollabServer } from "../server/lib/realtime-collab/server.js";
import {
  authorizeRoomJoin,
  type CollabIdentity,
  type RecordAccessCheck,
} from "../server/lib/realtime-collab/rooms.js";
import {
  JOIN_MAX_PER_SEC,
  MAX_ROOMS_PER_SOCKET,
  NUDGE_MAX_PER_SEC,
  HEARTBEAT_MAX_PER_SEC,
  CURSOR_MAX_PER_SEC,
} from "../server/lib/realtime-collab/config.js";
import { createRateLimiter, type RateLimiter } from "../server/lib/realtime-collab/rate-limit.js";
import { createPresenceStore, type PresenceStore } from "../server/lib/realtime-collab/presence-store.js";
import type { ResolveHandshakeIdentity } from "../server/lib/realtime-collab/handshake.js";

// ── H3: pure guard on authorizeRoomJoin ──────────────────────────────────────
describe("authorizeRoomJoin — H3 malformed-request guard (no throw)", () => {
  const allowAll: RecordAccessCheck = async () => true;
  const identity: CollabIdentity = { userId: "u", clinicId: "clinic-A", role: "vet", displayName: "U" };

  it("returns INVALID_JOIN_REQUEST for null instead of throwing", async () => {
    await expect(
      // socket.io delivers `null` for `emit("join", null)` — must not deref .kind.
      authorizeRoomJoin(identity, null as unknown as never, allowAll),
    ).resolves.toEqual({ ok: false, reason: "INVALID_JOIN_REQUEST" });
  });

  it("returns INVALID_JOIN_REQUEST for undefined (bare emit('join'))", async () => {
    expect(await authorizeRoomJoin(identity, undefined as unknown as never, allowAll)).toEqual({
      ok: false,
      reason: "INVALID_JOIN_REQUEST",
    });
  });

  it("returns INVALID_JOIN_REQUEST for a non-object and an object with no kind", async () => {
    expect(await authorizeRoomJoin(identity, "join" as unknown as never, allowAll)).toEqual({
      ok: false,
      reason: "INVALID_JOIN_REQUEST",
    });
    expect(await authorizeRoomJoin(identity, {} as unknown as never, allowAll)).toEqual({
      ok: false,
      reason: "INVALID_JOIN_REQUEST",
    });
  });

  it("still authorizes a well-formed chat join (guard does not over-reject)", async () => {
    expect(await authorizeRoomJoin(identity, { kind: "chat" }, allowAll)).toEqual({
      ok: true,
      room: "clinic:clinic-A:chat",
    });
  });
});

// ── H2: live-server rate limits + rooms cap ──────────────────────────────────
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

function connect(auth: Record<string, unknown> | undefined): ClientSocket {
  return ioClient(url, { path: "/collab-ws", transports: ["websocket"], auth, reconnection: false, forceNew: true });
}
function waitConnect(s: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    s.on("connect", () => resolve());
    s.on("connect_error", (e) => reject(e));
    setTimeout(() => reject(new Error("connect timeout")), 4_000);
  });
}
type Ack = { ok: boolean; reason?: string; room?: string };
function joinAck(s: ClientSocket, req: unknown): Promise<Ack> {
  return new Promise((resolve) => s.emit("join", req, (r: Ack) => resolve(r)));
}
const tokenFor = (userId: string, clinicId: string) => JSON.stringify({ userId, clinicId });

beforeAll(async () => {
  httpServer = createServer();
  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
  const port = (httpServer.address() as AddressInfo).port;
  url = `http://127.0.0.1:${port}`;
  collab = await initCollabServer(httpServer, {
    resolveIdentity,
    recordAccess: async () => true,
    skipRedisAdapter: true,
  });
  expect(collab.enabled).toBe(true);
});

afterAll(async () => {
  await collab?.close();
  await new Promise<void>((r) => httpServer.close(() => r()));
});

describe("R-RTC-1 collaboration channel — H2 DoS hardening (live server)", () => {
  it("rejects a bare/null join over the wire with INVALID_JOIN_REQUEST (no server crash)", async () => {
    const a = connect({ token: tokenFor("alice", "clinic-A") });
    await waitConnect(a);
    const nullAck = await joinAck(a, null);
    const emptyAck = await joinAck(a, {});
    expect(nullAck).toEqual({ ok: false, reason: "INVALID_JOIN_REQUEST" });
    expect(emptyAck).toEqual({ ok: false, reason: "INVALID_JOIN_REQUEST" });
    // Server still healthy: a well-formed join right after still succeeds.
    const good = await joinAck(a, { kind: "chat" });
    expect(good.ok).toBe(true);
    a.close();
  });

  it("rejects join floods beyond JOIN_MAX_PER_SEC with RATE_LIMITED", async () => {
    const a = connect({ token: tokenFor("alice", "clinic-A") });
    await waitConnect(a);
    // Flood the SAME room so the rooms cap never trips — only the rate limit can.
    const acks = await Promise.all(
      Array.from({ length: JOIN_MAX_PER_SEC + 15 }, () => joinAck(a, { kind: "chat" })),
    );
    const limited = acks.filter((r) => r.ok === false && r.reason === "RATE_LIMITED");
    expect(limited.length).toBeGreaterThan(0);
    a.close();
  });

  it("caps a socket at MAX_ROOMS_PER_SOCKET rooms (ROOM_LIMIT_EXCEEDED beyond it)", async () => {
    const a = connect({ token: tokenFor("alice", "clinic-A") });
    await waitConnect(a);
    const acks: Ack[] = [];
    for (let i = 0; i <= MAX_ROOMS_PER_SOCKET; i++) {
      acks.push(await joinAck(a, { kind: "record", recordType: "task", recordId: `r${i}` }));
    }
    expect(acks.filter((r) => r.ok === true).length).toBe(MAX_ROOMS_PER_SOCKET);
    expect(acks.filter((r) => r.ok === false && r.reason === "ROOM_LIMIT_EXCEEDED").length).toBeGreaterThan(0);
    a.close();
  });

  it("rate-limits chat-nudge fan-out beyond NUDGE_MAX_PER_SEC (amplification guard)", async () => {
    const a = connect({ token: tokenFor("alice", "clinic-A") });
    const b = connect({ token: tokenFor("bob", "clinic-A") });
    await Promise.all([waitConnect(a), waitConnect(b)]);
    await joinAck(a, { kind: "chat" });
    await joinAck(b, { kind: "chat" });

    let received = 0;
    b.on("chat-nudge", () => { received += 1; });
    for (let i = 0; i < NUDGE_MAX_PER_SEC + 20; i++) a.emit("chat-nudge", { messageId: `m${i}` });
    await new Promise((r) => setTimeout(r, 400));
    expect(received).toBeGreaterThan(0);
    expect(received).toBeLessThanOrEqual(NUDGE_MAX_PER_SEC);
    a.close();
    b.close();
  });
});

// ── #7: per-socket rate-key namespacing → leak-proof disconnect cleanup ────────
// Every per-socket rate-limit key is namespaced `${socketId}:${verb}` so the ENTIRE
// disconnect cleanup is ONE prefix-clear — a future verb whose reset is forgotten can
// never leak a windows-Map key. The per-room board aggregate ("curroom:<room>") is
// deliberately NOT socket-scoped and must survive a single socket's disconnect.
describe("R-RTC-1 collaboration channel — #7 per-socket rate-key namespacing (leak-proof cleanup)", () => {
  let http2: HttpServer;
  let collab2: CollabServer;
  let url2: string;
  let limiter: RateLimiter;

  beforeAll(async () => {
    http2 = createServer();
    await new Promise<void>((r) => http2.listen(0, "127.0.0.1", r));
    const port = (http2.address() as AddressInfo).port;
    url2 = `http://127.0.0.1:${port}`;
    limiter = createRateLimiter();
    collab2 = await initCollabServer(http2, {
      resolveIdentity,
      recordAccess: async () => true,
      skipRedisAdapter: true,
      rateLimiter: limiter,
    });
    expect(collab2.enabled).toBe(true);
  });

  afterAll(async () => {
    await collab2?.close();
    await new Promise<void>((r) => http2.close(() => r()));
  });

  it("namespaces EVERY per-socket verb under `${socketId}:` and clears them ALL on disconnect", async () => {
    const a = ioClient(url2, {
      path: "/collab-ws",
      transports: ["websocket"],
      auth: { token: tokenFor("alice", "clinic-A") },
      reconnection: false,
      forceNew: true,
    });
    await waitConnect(a);
    const sid = a.id as string; // socket.io: client id === server socket id post-connect

    // Exercise every per-socket verb so each mints its own rate-limit window key.
    await joinAck(a, { kind: "chat" }); // join (+ enters chat room)
    await joinAck(a, { kind: "board" }); // join again (+ enters board room)
    a.emit("typing", { on: true }); // typing (needs chat room)
    a.emit("chat-nudge", { messageId: "m1" }); // nudge (needs chat room)
    a.emit("board-cursor", { x: 0.5, y: 0.5 }); // cur (needs board room; also mints curroom:<room>)
    a.emit("board-selection", { entityId: "e1" }); // sel (needs board room)
    a.emit("record-presence", { editing: true }); // recpres (rate-checked first)
    a.emit("leave", { room: "clinic:clinic-A:board" }); // leave (rate-checked first)
    // Ordered per-socket delivery: this ack resolves only after every prior event was
    // dispatched, so all their (synchronous) rate-limit prologues have already run.
    await joinAck(a, { kind: "chat" });

    const suffixes = limiter
      .keys()
      .filter((k) => k.startsWith(`${sid}:`))
      .map((k) => k.slice(sid.length + 1))
      .sort();
    // RED before the fix: keys were `${verb}:${socketId}`, so NONE start with `${socketId}:`.
    expect(suffixes).toEqual(["cur", "join", "leave", "nudge", "recpres", "sel", "typing"]);
    // No per-socket key escapes the `${socketId}:` namespace.
    expect(limiter.keys().filter((k) => k.includes(sid) && !k.startsWith(`${sid}:`))).toEqual([]);

    a.close();
    await new Promise((r) => setTimeout(r, 300));

    // The ENTIRE cleanup is one prefix-clear: NO key referencing this socket survives —
    // for EVERY verb — while the per-room board aggregate is untouched.
    expect(limiter.keys().filter((k) => k.includes(sid))).toEqual([]);
    expect(limiter.keys().some((k) => k.startsWith("curroom:"))).toBe(true);
  });
});

// ── PR#112 (a): join handler never leaks an unhandled rejection ────────────────
// authorizeRoomJoin → defaultRecordAccessCheck is a REAL db.select. A transient DB
// rejection must NOT escape the async listener (which never acks → client hangs and
// an unhandled promise rejection fires). The handler must catch and ack JOIN_FAILED.
describe("R-RTC-1 collaboration channel — PR#112 (a) join DB rejection acks JOIN_FAILED", () => {
  let http3: HttpServer;
  let collab3: CollabServer;
  let url3: string;
  let sawUnhandled = false;
  const onUnhandled = () => { sawUnhandled = true; };

  beforeAll(async () => {
    process.on("unhandledRejection", onUnhandled);
    http3 = createServer();
    await new Promise<void>((r) => http3.listen(0, "127.0.0.1", r));
    const port = (http3.address() as AddressInfo).port;
    url3 = `http://127.0.0.1:${port}`;
    collab3 = await initCollabServer(http3, {
      resolveIdentity,
      // A record-access check that rejects (simulates a transient db.select failure).
      recordAccess: async () => {
        throw new Error("simulated DB failure during record ACL");
      },
      skipRedisAdapter: true,
    });
    expect(collab3.enabled).toBe(true);
  });

  afterAll(async () => {
    process.off("unhandledRejection", onUnhandled);
    await collab3?.close();
    await new Promise<void>((r) => http3.close(() => r()));
  });

  it("acks {ok:false, reason:'JOIN_FAILED'} when the record ACL rejects (no unhandled rejection, no hang)", async () => {
    const a = ioClient(url3, {
      path: "/collab-ws",
      transports: ["websocket"],
      auth: { token: tokenFor("alice", "clinic-A") },
      reconnection: false,
      forceNew: true,
    });
    await waitConnect(a);
    const ack = await joinAck(a, { kind: "record", recordType: "task", recordId: "r1" });
    expect(ack).toEqual({ ok: false, reason: "JOIN_FAILED" });
    // Server still healthy: a well-formed chat join (no record ACL) succeeds right after.
    const good = await joinAck(a, { kind: "chat" });
    expect(good.ok).toBe(true);
    a.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(sawUnhandled).toBe(false);
  });
});

// ── PR#112 (b): presence-heartbeat is rate-limited (amplification guard) ───────
// A heartbeat fans presence.refresh across EVERY joined room — the ONLY control
// handler that previously had no rate limit. A flood past HEARTBEAT_MAX_PER_SEC must
// be throttled BEFORE the room iteration, so refresh is not amplified.
describe("R-RTC-1 collaboration channel — PR#112 (b) heartbeat flood is throttled", () => {
  let http4: HttpServer;
  let collab4: CollabServer;
  let url4: string;
  let refreshCount = 0;

  beforeAll(async () => {
    http4 = createServer();
    await new Promise<void>((r) => http4.listen(0, "127.0.0.1", r));
    const port = (http4.address() as AddressInfo).port;
    url4 = `http://127.0.0.1:${port}`;
    const base = createPresenceStore();
    const presence: PresenceStore = {
      ...base,
      refresh: async (room, socketId) => {
        refreshCount += 1;
        return base.refresh(room, socketId);
      },
    };
    collab4 = await initCollabServer(http4, {
      resolveIdentity,
      recordAccess: async () => true,
      skipRedisAdapter: true,
      presence,
    });
    expect(collab4.enabled).toBe(true);
  });

  afterAll(async () => {
    await collab4?.close();
    await new Promise<void>((r) => http4.close(() => r()));
  });

  it("caps presence.refresh fan-out at HEARTBEAT_MAX_PER_SEC per second (one joined room)", async () => {
    const a = ioClient(url4, {
      path: "/collab-ws",
      transports: ["websocket"],
      auth: { token: tokenFor("alice", "clinic-A") },
      reconnection: false,
      forceNew: true,
    });
    await waitConnect(a);
    await joinAck(a, { kind: "chat" }); // exactly one joined room
    refreshCount = 0;
    for (let i = 0; i < HEARTBEAT_MAX_PER_SEC + 20; i++) a.emit("presence-heartbeat");
    // Ordered per-socket delivery: this ack resolves only after every heartbeat's
    // synchronous rate-limit prologue has run.
    await joinAck(a, { kind: "chat" });
    await new Promise((r) => setTimeout(r, 100));
    expect(refreshCount).toBeGreaterThan(0);
    expect(refreshCount).toBeLessThanOrEqual(HEARTBEAT_MAX_PER_SEC);
    a.close();
  });
});

// ── PR#112 (c): a cursor over its per-socket budget does NOT charge the room ────
// The shared `curroom:<room>` limiter is a single INCREMENTING counter across all
// sockets in a room. If it is checked BEFORE the per-socket drop verdict, one abuser
// who is already over its own budget still charges the room allowance → starves peers'
// cursors. The per-room check must run ONLY for a cursor that passed its per-socket budget.
describe("R-RTC-1 collaboration channel — PR#112 (c) over-budget cursor spares the room aggregate", () => {
  let http5: HttpServer;
  let collab5: CollabServer;
  let url5: string;
  const curroomChecks: string[] = [];
  let base: RateLimiter;

  beforeAll(async () => {
    http5 = createServer();
    await new Promise<void>((r) => http5.listen(0, "127.0.0.1", r));
    const port = (http5.address() as AddressInfo).port;
    url5 = `http://127.0.0.1:${port}`;
    base = createRateLimiter();
    const spy: RateLimiter = {
      check(key, perSec) {
        if (key.startsWith("curroom:")) curroomChecks.push(key);
        return base.check(key, perSec);
      },
      reset: (prefix) => base.reset(prefix),
      keys: () => base.keys(),
    };
    collab5 = await initCollabServer(http5, {
      resolveIdentity,
      recordAccess: async () => true,
      skipRedisAdapter: true,
      rateLimiter: spy,
    });
    expect(collab5.enabled).toBe(true);
  });

  afterAll(async () => {
    await collab5?.close();
    await new Promise<void>((r) => http5.close(() => r()));
  });

  it("checks curroom:<room> at most CURSOR_MAX_PER_SEC times when one socket floods past its per-socket budget", async () => {
    const a = ioClient(url5, {
      path: "/collab-ws",
      transports: ["websocket"],
      auth: { token: tokenFor("alice", "clinic-A") },
      reconnection: false,
      forceNew: true,
    });
    await waitConnect(a);
    await joinAck(a, { kind: "board" });
    const flood = CURSOR_MAX_PER_SEC + 10; // stays under the disconnect multiplier
    for (let i = 0; i < flood; i++) a.emit("board-cursor", { x: 0.5, y: 0.5 });
    // Flush ordered per-socket delivery so every cursor's synchronous prologue has run.
    await joinAck(a, { kind: "board" });
    await new Promise((r) => setTimeout(r, 100));
    // RED before the fix: the room aggregate is checked once PER emit (flood times).
    // After the fix: only cursors that passed the per-socket budget charge the room.
    expect(curroomChecks.length).toBeGreaterThan(0);
    expect(curroomChecks.length).toBeLessThanOrEqual(CURSOR_MAX_PER_SEC);
    expect(flood).toBeGreaterThan(CURSOR_MAX_PER_SEC);
    a.close();
  });
});
