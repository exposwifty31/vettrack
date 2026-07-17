/**
 * R-RTC-1.2/1.3 (integration) — a REAL Socket.io server + clients over a live port,
 * with an injected identity resolver (no Clerk needed). Proves the wiring:
 *   - an unauthenticated handshake is rejected;
 *   - two same-clinic sockets exchange typing + presence with SERVER-attached ids;
 *   - a client-supplied userId is ignored;
 *   - cross-clinic isolation (clinic-B never sees clinic-A's chat);
 *   - the server drops cursor floods beyond the rate limit.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { type AddressInfo } from "node:net";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { initCollabServer, type CollabServer } from "../server/lib/realtime-collab/server.js";
import type { ResolveHandshakeIdentity } from "../server/lib/realtime-collab/handshake.js";

// Identity is encoded in the token for the test; the resolver "reads it from the
// DB" — i.e. the client never dictates identity, the resolver does.
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
  return ioClient(url, {
    path: "/collab-ws",
    transports: ["websocket"],
    auth,
    reconnection: false,
    forceNew: true,
  });
}

function waitConnect(s: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    s.on("connect", () => resolve());
    s.on("connect_error", (e) => reject(e));
    setTimeout(() => reject(new Error("connect timeout")), 4_000);
  });
}

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

const tokenFor = (userId: string, clinicId: string) => JSON.stringify({ userId, clinicId });

describe("R-RTC-1 collaboration channel — integration", () => {
  it("rejects an unauthenticated handshake (no token)", async () => {
    const s = connect({});
    await expect(waitConnect(s)).rejects.toBeTruthy();
    s.close();
  });

  it("two same-clinic sockets exchange typing with a SERVER-attached userId (client claim ignored)", async () => {
    const a = connect({ token: tokenFor("alice", "clinic-A"), userId: "SPOOFED" });
    const b = connect({ token: tokenFor("bob", "clinic-A") });
    await Promise.all([waitConnect(a), waitConnect(b)]);

    await new Promise((r) => a.emit("join", { kind: "chat" }, r));
    await new Promise((r) => b.emit("join", { kind: "chat" }, r));

    const got = new Promise<{ userId: string; on: boolean }>((resolve) => {
      b.on("peer-typing", (p) => resolve(p as { userId: string; on: boolean }));
    });
    a.emit("typing", { on: true });
    const evt = await got;
    // Identity is the DB-resolved "alice", never the client-claimed "SPOOFED".
    expect(evt.userId).toBe("alice");
    expect(evt.on).toBe(true);
    a.close();
    b.close();
  });

  it("does NOT leak chat across clinics (clinic-B never sees clinic-A typing)", async () => {
    const a = connect({ token: tokenFor("alice", "clinic-A") });
    const c = connect({ token: tokenFor("carol", "clinic-B") });
    await Promise.all([waitConnect(a), waitConnect(c)]);
    await new Promise((r) => a.emit("join", { kind: "chat" }, r));
    await new Promise((r) => c.emit("join", { kind: "chat" }, r));

    let leaked = false;
    c.on("peer-typing", () => { leaked = true; });
    a.emit("typing", { on: true });
    await new Promise((r) => setTimeout(r, 400)); // give any (wrong) delivery time to arrive
    expect(leaked).toBe(false);
    a.close();
    c.close();
  });

  it("drops cursor events beyond the per-socket rate limit", async () => {
    const a = connect({ token: tokenFor("alice", "clinic-A") });
    const b = connect({ token: tokenFor("bob", "clinic-A") });
    await Promise.all([waitConnect(a), waitConnect(b)]);
    await new Promise((r) => a.emit("join", { kind: "board" }, r));
    await new Promise((r) => b.emit("join", { kind: "board" }, r));

    let received = 0;
    b.on("peer-cursor", () => { received += 1; });
    // Fire 60 cursors instantly — the server caps at 20/s, so b sees ≤ 20.
    for (let i = 0; i < 60; i++) a.emit("board-cursor", { x: 0.5, y: 0.5 });
    await new Promise((r) => setTimeout(r, 500));
    expect(received).toBeLessThanOrEqual(20);
    expect(received).toBeGreaterThan(0);
    a.close();
    b.close();
  });
});
