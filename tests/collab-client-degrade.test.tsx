/**
 * @vitest-environment happy-dom
 *
 * R-RTC-1.6 card H1/H4/H6 — `src/lib/collab-socket.ts` client-primitive correctness.
 *
 * These lock the graceful-degradation + shared-singleton contract of the collab
 * socket wrapper (the primitive that shift-chat / `/board` / record-detail will
 * consume lazily). NO core action is ever gated on this socket, so every failure
 * mode below must degrade to `null`/no-op — never throw.
 *
 *   H1  ref-counted acquire/release — one consumer's release must NOT disconnect
 *       the shared singleton out from under another still-mounted consumer; the
 *       socket disconnects only when the LAST holder releases. `leaveCollabRoom`
 *       exists (a room leave is not a socket teardown).
 *   H4  origin defaults to a resolved API origin — `window.location.origin` is
 *       dead in the Capacitor shell (`capacitor://localhost`), so the native shell
 *       must reuse `needsRemoteApiOrigin()`/`getConfiguredApiOrigin()`.
 *   H6  auth is passed as a CALLBACK so `reconnectionAttempts: Infinity` replays a
 *       FRESH token, not the same expired one forever.
 *
 * No SSE / emergency coupling — this file imports only the collab primitive.
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

// Controllable stub for the native-origin resolver (H4).
const apiOrigin = {
  needsRemoteApiOrigin: vi.fn(() => false),
  getConfiguredApiOrigin: vi.fn<[], string | null>(() => null),
};
vi.mock("@/lib/api-origin", () => ({
  needsRemoteApiOrigin: () => apiOrigin.needsRemoteApiOrigin(),
  getConfiguredApiOrigin: () => apiOrigin.getConfiguredApiOrigin(),
  resolveApiUrl: (p: string) => p,
}));

import {
  closeCollabSocket,
  getCollabSocket,
  joinCollabRoom,
  leaveCollabRoom,
  releaseCollabSocket,
} from "@/lib/collab-socket";

afterEach(() => {
  closeCollabSocket();
  ioMock.mockClear();
  fakeSockets.length = 0;
  apiOrigin.needsRemoteApiOrigin.mockReturnValue(false);
  apiOrigin.getConfiguredApiOrigin.mockReturnValue(null);
  vi.useRealTimers();
});

describe("collab-socket client primitive — graceful degradation (R-RTC-1.6)", () => {
  it("returns null (no throw, no socket) when no auth token is available", () => {
    expect(getCollabSocket(null)).toBeNull();
    expect(getCollabSocket({ token: "" })).toBeNull();
    expect(ioMock).not.toHaveBeenCalled();
  });

  it("returns the SAME singleton socket on re-acquire (one io() connection)", () => {
    const a = getCollabSocket({ token: "t" });
    const b = getCollabSocket({ token: "t" });
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(ioMock).toHaveBeenCalledTimes(1);
  });

  it("ref-counts acquire/release: first release keeps the socket alive, second disconnects (H1)", () => {
    const s1 = getCollabSocket({ token: "t" }) as unknown as FakeSocket; // refCount 1
    getCollabSocket({ token: "t" }); // refCount 2

    releaseCollabSocket(); // refCount 1 — a peer still holds it
    expect(s1.disconnect).not.toHaveBeenCalled();

    releaseCollabSocket(); // refCount 0 — last holder released
    expect(s1.disconnect).toHaveBeenCalledTimes(1);

    // A fresh acquire after full teardown must build a NEW socket.
    getCollabSocket({ token: "t" });
    expect(ioMock).toHaveBeenCalledTimes(2);
  });

  it("leaveCollabRoom emits a room leave WITHOUT tearing down the socket (H1)", () => {
    const s = getCollabSocket({ token: "t" }) as unknown as FakeSocket;
    leaveCollabRoom(s as never, "clinic:c1:chat");
    expect(s.emit).toHaveBeenCalledWith("leave", { room: "clinic:c1:chat" });
    expect(s.disconnect).not.toHaveBeenCalled();
  });

  it("joinCollabRoom resolves null on ack timeout (silent degrade, never hangs)", async () => {
    vi.useFakeTimers();
    const s = getCollabSocket({ token: "t" }) as unknown as FakeSocket;
    const p = joinCollabRoom(s as never, { kind: "chat" });
    expect(s.emit).toHaveBeenCalledWith("join", { kind: "chat" }, expect.any(Function));
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(p).resolves.toBeNull();
  });

  it("passes auth as a CALLBACK yielding a fresh token, not a static object (H6)", () => {
    let current = "token-1";
    getCollabSocket(() => ({ token: current }));
    const opts = ioMock.mock.calls[0][1] as { auth: unknown };
    expect(typeof opts.auth).toBe("function");

    const read = () => {
      let captured: { token?: string } = {};
      (opts.auth as (cb: (d: { token?: string }) => void) => void)((d) => {
        captured = d;
      });
      return captured.token;
    };
    expect(read()).toBe("token-1");
    current = "token-2"; // simulate a refreshed session token
    expect(read()).toBe("token-2");
  });

  it("uses the configured API origin in the Capacitor native shell — window.location.origin is dead there (H4)", () => {
    apiOrigin.needsRemoteApiOrigin.mockReturnValue(true);
    apiOrigin.getConfiguredApiOrigin.mockReturnValue("https://vettrack.uk");
    getCollabSocket({ token: "t" });
    expect(ioMock.mock.calls[0][0]).toBe("https://vettrack.uk");
  });

  it("defaults origin to window.location.origin in the browser/PWA (H4)", () => {
    getCollabSocket({ token: "t" });
    expect(ioMock.mock.calls[0][0]).toBe(window.location.origin);
  });

  it("resolves a LATER consumer's fresh token after the FIRST acquirer releases (multi-consumer auth registry)", () => {
    let t1: string | null = "token-1";
    const t2 = "token-2";
    const src1 = () => (t1 ? { token: t1 } : null);
    const src2 = () => ({ token: t2 });

    getCollabSocket(src1); // first acquirer builds the io() socket
    getCollabSocket(src2); // second consumer shares the singleton

    // The first consumer unmounts: it releases AND its session token goes stale/null.
    // A naive io() auth callback that closed over the FIRST source would now replay a
    // null token on reconnect even though a live consumer still holds a fresh one.
    releaseCollabSocket(src1);
    t1 = null;

    const opts = ioMock.mock.calls[0][1] as {
      auth: (cb: (d: { token?: string }) => void) => void;
    };
    let captured: { token?: string } = {};
    opts.auth((d) => {
      captured = d;
    });
    // Reconnect resolves the FIRST still-ACTIVE source that yields a non-empty token —
    // the released first consumer is skipped, the second consumer's fresh token wins.
    expect(captured.token).toBe("token-2");
  });

  it("clears all registered auth sources on closeCollabSocket (no leak into a later socket)", () => {
    const stale = () => ({ token: "stale" });
    getCollabSocket(stale);
    closeCollabSocket();

    // A brand-new socket after a hard sign-out must NOT resolve a pre-signout source.
    const fresh = () => ({ token: "fresh" });
    getCollabSocket(fresh);
    const opts = ioMock.mock.calls[1][1] as {
      auth: (cb: (d: { token?: string }) => void) => void;
    };
    let captured: { token?: string } = {};
    opts.auth((d) => {
      captured = d;
    });
    expect(captured.token).toBe("fresh");
  });
});
