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
} from "../server/lib/realtime-collab/config.js";
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
