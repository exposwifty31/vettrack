/**
 * @vitest-environment happy-dom
 *
 * R-RTC-1 panel fix card — presence-heartbeat (HIGH #2).
 *
 * The server keeps a per-socket presence lease with a ~90s TTL
 * (`PRESENCE_TTL_MS = 90_000`, `server/lib/realtime-collab/config.ts`) and refreshes
 * every room's lease on `socket.on("presence-heartbeat")`. NOTHING was emitting that
 * event, so any user idle-connected >90s was pruned from the presence store and
 * vanished from every peer roster on the next membership change.
 *
 * The fix lives in the PRIMITIVE (`src/lib/collab-socket.ts`): ONE heartbeat per
 * SHARED socket refreshes the leases for ALL of that socket's rooms server-side, so
 * a single interval belongs in the primitive — NOT per-hook (per-hook would multi-
 * emit on the shared socket). `COLLAB_HEARTBEAT_MS = 30_000` sits comfortably under
 * the ~90s TTL. The interval only emits while `socket.connected`, and is torn down
 * when the last holder releases and on hard close.
 *
 * Frozen doctrine unchanged: ephemeral/advisory only, no core action gated on the
 * socket, client never sends its own userId (the event carries NO payload), no SSE /
 * Code Blue coupling. This file imports ONLY the collab primitive.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

interface FakeSocket {
  connected: boolean;
  emit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
}

const fakeSockets: FakeSocket[] = [];

function makeFakeSocket(): FakeSocket {
  return {
    connected: false,
    emit: vi.fn(),
    on: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
  };
}

const ioMock = vi.fn((..._args: unknown[]) => {
  const s = makeFakeSocket();
  fakeSockets.push(s);
  return s;
});

vi.mock("socket.io-client", () => ({
  io: (...args: unknown[]) => ioMock(...args),
}));

vi.mock("@/lib/api-origin", () => ({
  needsRemoteApiOrigin: () => false,
  getConfiguredApiOrigin: () => null,
  resolveApiUrl: (p: string) => p,
}));

import {
  closeCollabSocket,
  getCollabSocket,
  releaseCollabSocket,
} from "@/lib/collab-socket";

function heartbeatEmitCount(s: FakeSocket): number {
  return s.emit.mock.calls.filter((c) => c[0] === "presence-heartbeat").length;
}

afterEach(() => {
  closeCollabSocket();
  ioMock.mockClear();
  fakeSockets.length = 0;
  vi.useRealTimers();
});

describe("collab-socket presence-heartbeat (R-RTC-1 panel fix #2)", () => {
  it("emits exactly one presence-heartbeat per 30s while connected", () => {
    vi.useFakeTimers();
    getCollabSocket({ token: "t" });
    const s = fakeSockets[0];

    // Simulate a live connection.
    s.connected = true;

    expect(heartbeatEmitCount(s)).toBe(0);
    vi.advanceTimersByTime(30_000);
    expect(heartbeatEmitCount(s)).toBe(1);
    vi.advanceTimersByTime(30_000);
    expect(heartbeatEmitCount(s)).toBe(2);

    // No payload — the client never claims its own identity.
    const hb = s.emit.mock.calls.find((c) => c[0] === "presence-heartbeat");
    expect(hb).toEqual(["presence-heartbeat"]);
  });

  it("emits NOTHING while the socket is disconnected", () => {
    vi.useFakeTimers();
    getCollabSocket({ token: "t" });
    const s = fakeSockets[0];

    s.connected = false; // never connected
    vi.advanceTimersByTime(120_000);
    expect(heartbeatEmitCount(s)).toBe(0);
  });

  it("clears the interval on last release — no heartbeat after teardown", () => {
    vi.useFakeTimers();
    getCollabSocket({ token: "t" }); // refCount 1
    getCollabSocket({ token: "t" }); // refCount 2
    const s = fakeSockets[0];
    s.connected = true;

    vi.advanceTimersByTime(30_000);
    expect(heartbeatEmitCount(s)).toBe(1);

    releaseCollabSocket(); // refCount 1 — a peer still holds it; interval stays
    vi.advanceTimersByTime(30_000);
    expect(heartbeatEmitCount(s)).toBe(2);

    releaseCollabSocket(); // refCount 0 — last holder; interval cleared
    const afterTeardown = heartbeatEmitCount(s);
    vi.advanceTimersByTime(120_000);
    expect(heartbeatEmitCount(s)).toBe(afterTeardown);
  });

  it("clears the interval on closeCollabSocket — no heartbeat after hard close", () => {
    vi.useFakeTimers();
    getCollabSocket({ token: "t" });
    const s = fakeSockets[0];
    s.connected = true;

    vi.advanceTimersByTime(30_000);
    expect(heartbeatEmitCount(s)).toBe(1);

    closeCollabSocket();
    vi.advanceTimersByTime(120_000);
    expect(heartbeatEmitCount(s)).toBe(1);
  });
});
