/**
 * R-RTC-1 — two panel-flagged coverage gaps, tied to real behavior:
 *
 *  (1) The single-instance opt-in success path (R-RTC-1.5): in production with no
 *      Redis the channel is DISABLED (REDIS_REQUIRED) UNLESS
 *      COLLAB_WS_ALLOW_SINGLE_INSTANCE=true, which keeps it enabled on the bounded
 *      in-process fallback. Both sides of the branch are asserted.
 *
 *  (2) The join-ack contract + the `presence` broadcast on join (R-RTC-1.2/1.5):
 *      a successful join acks {ok,room,members}; a bad join acks {ok:false,reason};
 *      and every room member receives a `presence` broadcast with the converged
 *      member list when a peer joins.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { type AddressInfo } from "node:net";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { initCollabServer, type CollabServer } from "../server/lib/realtime-collab/server.js";
import type { ResolveHandshakeIdentity } from "../server/lib/realtime-collab/handshake.js";

const resolveIdentity: ResolveHandshakeIdentity = async (token) => {
  try {
    const parsed = JSON.parse(token) as { userId: string; clinicId: string };
    return { userId: parsed.userId, clinicId: parsed.clinicId, role: "vet", displayName: parsed.userId };
  } catch {
    return null;
  }
};

// ── (1) single-instance opt-in success path ─────────────────────────────────
describe("R-RTC-1.5 — single-instance opt-in (in-process fallback)", () => {
  async function initWith(env: Record<string, string | undefined>): Promise<CollabServer> {
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(env)) {
      saved[k] = process.env[k];
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    const http = createServer();
    try {
      // No Redis available; do NOT skip the adapter wiring so the prod/opt-in branch runs.
      return await initCollabServer(http, {
        resolveIdentity,
        recordAccess: async () => true,
        getRedisClient: async () => null,
      });
    } finally {
      for (const k of Object.keys(saved)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      http.close();
    }
  }

  it("DISABLES the channel in production with no Redis and no opt-in (REDIS_REQUIRED)", async () => {
    const collab = await initWith({ NODE_ENV: "production", COLLAB_WS_ALLOW_SINGLE_INSTANCE: undefined });
    expect(collab.enabled).toBe(false);
    expect(collab.reason).toBe("REDIS_REQUIRED");
    await collab.close();
  });

  it("KEEPS the channel enabled with COLLAB_WS_ALLOW_SINGLE_INSTANCE=true (explicit opt-in)", async () => {
    const collab = await initWith({ NODE_ENV: "production", COLLAB_WS_ALLOW_SINGLE_INSTANCE: "true" });
    expect(collab.enabled).toBe(true);
    expect(collab.reason).toBeUndefined();
    await collab.close();
  });
});

// ── (2) join-ack shape + presence broadcast (live sockets) ──────────────────
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
const tokenFor = (userId: string, clinicId: string) => JSON.stringify({ userId, clinicId });

describe("R-RTC-1.2/1.5 — join ack shape + presence broadcast", () => {
  beforeAll(async () => {
    httpServer = createServer();
    await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
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

  it("acks a successful join with {ok,room,members} (server-attached identity)", async () => {
    const a = connect({ token: tokenFor("alice", "clinic-A"), userId: "SPOOFED" });
    await waitConnect(a);
    const ack = await new Promise<{ ok: boolean; room: string; members: Array<{ userId: string; displayName: string }> }>(
      (resolve) => a.emit("join", { kind: "chat" }, resolve),
    );
    expect(ack.ok).toBe(true);
    expect(ack.room).toBe("clinic:clinic-A:chat");
    // Identity is the DB-resolved "alice", never the client-claimed "SPOOFED".
    expect(ack.members).toEqual([{ userId: "alice", displayName: "alice" }]);
    a.close();
  });

  it("acks a malformed join with {ok:false,reason} and never joins a room", async () => {
    const a = connect({ token: tokenFor("alice", "clinic-A") });
    await waitConnect(a);
    const ack = await new Promise<{ ok: boolean; reason?: string }>((resolve) =>
      a.emit("join", { kind: "record", recordType: "patient", recordId: "p1" }, resolve),
    );
    expect(ack.ok).toBe(false);
    expect(ack.reason).toBe("UNKNOWN_RECORD_TYPE");
    a.close();
  });

  it("broadcasts `presence` with the converged member list when a peer joins", async () => {
    const a = connect({ token: tokenFor("alice", "clinic-A") });
    const b = connect({ token: tokenFor("bob", "clinic-A") });
    await Promise.all([waitConnect(a), waitConnect(b)]);
    await new Promise((r) => a.emit("join", { kind: "chat" }, r));

    // `a` is already in the chat room; when `b` joins, `a` must receive a presence
    // broadcast whose member list now includes both users.
    const presence = new Promise<{ room: string; members: Array<{ userId: string }> }>((resolve) => {
      a.on("presence", (p) => {
        const evt = p as { room: string; members: Array<{ userId: string }> };
        if (evt.members.length >= 2) resolve(evt);
      });
    });
    b.emit("join", { kind: "chat" });
    const evt = await presence;
    expect(evt.room).toBe("clinic:clinic-A:chat");
    expect(evt.members.map((m) => m.userId).sort()).toEqual(["alice", "bob"]);
    a.close();
    b.close();
  });
});
