/**
 * @vitest-environment happy-dom
 *
 * R-RTC-1 panel #5 — `useCollabRoom` shared base-hook contract.
 *
 * After the panel #1/#3 fixes the socket-lifecycle scaffolding across the three
 * feature hooks was byte-for-byte identical; it was extracted into `useCollabRoom`.
 * The feature wiring tests (collab-{shift-chat,board,record-presence}-wiring) remain
 * the behavioural guard through the shipped hooks; THIS suite locks the extracted
 * base in isolation so a future change to the shared lifecycle is caught directly:
 *
 *   - GRACEFUL DEGRADATION: no token → getCollabSocket returns null → no socket,
 *     no listeners, no join, and (critically) NO releaseCollabSocket pairing.
 *   - RE-JOIN on every (re)connect (socket.io rooms are per-connection).
 *   - PRESENCE room-filter on the SHARED socket (room-A must not clobber room-B).
 *   - isJoined transitions on ack.ok; feature binder receives socket + `on` and its
 *     returned cleanup runs on unmount.
 *   - REF-COUNT lease: a real acquire releases exactly once on unmount; a degraded
 *     (null) acquire never releases.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

type FakeHandler = (payload?: unknown) => void;

interface FakeSocket {
  connected: boolean;
  emit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  // A Set of handlers PER event — socket.io allows many listeners for one event and
  // off(event, handler) removes exactly one. A single-handler Map cannot model that. — PR#112 (e).
  handlers: Map<string, Set<FakeHandler>>;
  trigger: (event: string, payload?: unknown) => void;
}

const fakeSockets: FakeSocket[] = [];

function makeFakeSocket(): FakeSocket {
  const handlers = new Map<string, Set<FakeHandler>>();
  const s: FakeSocket = {
    connected: true,
    emit: vi.fn(),
    on: vi.fn((event: string, handler: FakeHandler) => {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler);
      return s;
    }),
    off: vi.fn((event: string, handler?: FakeHandler) => {
      const set = handlers.get(event);
      if (!set) return s;
      // off(event) with no handler clears every listener; off(event, handler) removes one.
      if (handler === undefined) handlers.delete(event);
      else {
        set.delete(handler);
        if (set.size === 0) handlers.delete(event);
      }
      return s;
    }),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(() => handlers.clear()),
    handlers,
    trigger: (event, payload) => {
      const set = handlers.get(event);
      if (!set) return;
      for (const h of [...set]) h(payload);
    },
  };
  return s;
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

import { setAuthState } from "@/lib/auth-store";
import { setClerkTokenGetter } from "@/lib/auth-fetch";
import { closeCollabSocket } from "@/lib/collab-socket";
import { useCollabRoom, type CollabRoomBinding } from "@/features/collab/useCollabRoom";

const JWT = "aaa.bbb.ccc";

function seedToken(token: string | null) {
  setAuthState({ userId: "me", email: "", name: "", bearerToken: token });
}

async function connectedSocket(): Promise<FakeSocket> {
  await waitFor(() => expect(fakeSockets).toHaveLength(1));
  return fakeSockets[0]!;
}

function acceptJoin(socket: FakeSocket, room: string, members: { userId: string; displayName: string }[]) {
  const joinCall = socket.emit.mock.calls.find((c) => c[0] === "join");
  const ack = joinCall?.[2] as ((r: unknown) => void) | undefined;
  ack?.({ ok: true, room, members });
}

afterEach(() => {
  cleanup();
  closeCollabSocket();
  setClerkTokenGetter(null);
  ioMock.mockClear();
  fakeSockets.length = 0;
  seedToken(null);
});

describe("useCollabRoom — shared base-hook lifecycle (R-RTC-1 panel #5)", () => {
  it("re-joins on every (re)connect; isConnected stays true across the blip", async () => {
    seedToken(JWT);
    const { result } = renderHook(() =>
      useCollabRoom({ enabled: true, joinRequest: { kind: "chat" } }),
    );
    const socket = await connectedSocket();
    expect(socket.emit.mock.calls.filter((c) => c[0] === "join")).toHaveLength(1);

    act(() => socket.trigger("connect"));
    expect(socket.emit.mock.calls.filter((c) => c[0] === "join")).toHaveLength(2);
    expect(result.current.isConnected).toBe(true);
  });

  it("sets isJoined + joinedRoom + presentMembers from the join ack", async () => {
    seedToken(JWT);
    const { result } = renderHook(() =>
      useCollabRoom({ enabled: true, joinRequest: { kind: "chat" } }),
    );
    const socket = await connectedSocket();
    expect(result.current.isJoined).toBe(false);

    await act(async () => acceptJoin(socket, "clinic:c1:chat", [{ userId: "p1", displayName: "Dana" }]));
    expect(result.current.isJoined).toBe(true);
    expect(result.current.joinedRoom).toBe("clinic:c1:chat");
    expect(result.current.presentMembers).toEqual([{ userId: "p1", displayName: "Dana" }]);
  });

  it("drops a presence event for a DIFFERENT room (shared-socket isolation)", async () => {
    seedToken(JWT);
    const { result } = renderHook(() =>
      useCollabRoom({ enabled: true, joinRequest: { kind: "chat" } }),
    );
    const socket = await connectedSocket();
    await act(async () => acceptJoin(socket, "clinic:c1:chat", [{ userId: "chat", displayName: "Chat" }]));

    act(() =>
      socket.trigger("presence", {
        room: "clinic:c1:board",
        members: [{ userId: "board", displayName: "Board" }],
      }),
    );
    expect(result.current.presentMembers).toEqual([{ userId: "chat", displayName: "Chat" }]);

    // A presence for the JOINED room is accepted.
    act(() =>
      socket.trigger("presence", {
        room: "clinic:c1:chat",
        members: [{ userId: "chat", displayName: "Chat" }, { userId: "p2", displayName: "Noa" }],
      }),
    );
    expect(result.current.presentMembers).toHaveLength(2);
  });

  it("drops a DIFFERENT-room presence that arrives BEFORE this hook's join ack (pre-ack window)", async () => {
    seedToken(JWT);
    const { result } = renderHook(() =>
      useCollabRoom({
        enabled: true,
        joinRequest: { kind: "record", recordType: "equipment", recordId: "eq1" },
      }),
    );
    const socket = await connectedSocket();
    // Join not yet ack'd → joinedRoom unknown.
    expect(result.current.joinedRoom).toBeFalsy();

    // On the SHARED socket a foreign room's presence (e.g. a board surface already
    // joined) can arrive before THIS hook's record join acks — it must NOT populate
    // this hook's roster while the room is still unknown (panel #3 pre-ack window).
    act(() =>
      socket.trigger("presence", {
        room: "clinic:c1:board",
        members: [{ userId: "board", displayName: "Board" }],
      }),
    );
    expect(result.current.presentMembers).toEqual([]);

    // Once our own join acks, the correct roster arrives via ack.members.
    await act(async () =>
      acceptJoin(socket, "clinic:c1:record:equipment:eq1", [{ userId: "me", displayName: "Me" }]),
    );
    expect(result.current.presentMembers).toEqual([{ userId: "me", displayName: "Me" }]);
  });

  it("invokes the feature binder with a working `on`, and runs its cleanup on unmount", async () => {
    seedToken(JWT);
    const featureHandler = vi.fn();
    const featureCleanup = vi.fn();
    let bindingSocketSeen: unknown = null;

    const bindEvents = (binding: CollabRoomBinding) => {
      bindingSocketSeen = binding.socket;
      binding.on("peer-typing", featureHandler as never);
      return featureCleanup;
    };

    const { unmount } = renderHook(() =>
      useCollabRoom({ enabled: true, joinRequest: { kind: "chat" }, bindEvents }),
    );
    const socket = await connectedSocket();
    expect(bindingSocketSeen).toBe(socket as unknown);

    act(() => socket.trigger("peer-typing", { userId: "p1", on: true }));
    expect(featureHandler).toHaveBeenCalledWith({ userId: "p1", on: true });

    unmount();
    expect(featureCleanup).toHaveBeenCalledTimes(1);
    // A real acquire releases + disconnects exactly once on unmount.
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it("degrades with NO token: no socket, no binder, hook inert (and never releases)", async () => {
    seedToken(null);
    const bindEvents = vi.fn(() => vi.fn());
    const { result, unmount } = renderHook(() =>
      useCollabRoom({ enabled: true, joinRequest: { kind: "board" }, bindEvents }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(ioMock).not.toHaveBeenCalled();
    expect(fakeSockets).toHaveLength(0);
    expect(bindEvents).not.toHaveBeenCalled();
    expect(result.current.isConnected).toBe(false);
    expect(result.current.isJoined).toBe(false);
    expect(result.current.presentMembers).toEqual([]);
    // Unmounting a degraded hook must not throw (no acquire → no release).
    expect(() => unmount()).not.toThrow();
  });

  it("clears isJoined + joinedRoom + presentMembers on disconnect (no stale roster before re-join)", async () => {
    seedToken(JWT);
    const { result } = renderHook(() =>
      useCollabRoom({ enabled: true, joinRequest: { kind: "chat" } }),
    );
    const socket = await connectedSocket();
    await act(async () => acceptJoin(socket, "clinic:c1:chat", [{ userId: "p1", displayName: "Dana" }]));
    expect(result.current.isJoined).toBe(true);
    expect(result.current.joinedRoom).toBe("clinic:c1:chat");
    expect(result.current.presentMembers).toHaveLength(1);

    // A WS blip must not leave a stale joined roster showing between the disconnect
    // and the reconnect re-join — the re-join (handleConnect → doJoin) repopulates.
    act(() => socket.trigger("disconnect"));
    expect(result.current.isConnected).toBe(false);
    expect(result.current.isJoined).toBe(false);
    expect(result.current.joinedRoom).toBeNull();
    expect(result.current.presentMembers).toEqual([]);
  });

  it("degrades with NO unhandled rejection when the token fetch REJECTS", async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      // resolveBearerToken() routes through the Clerk token getter; a rejecting getter
      // simulates a failed token mint. Without a .catch this leaks an unhandled rejection.
      setClerkTokenGetter(() => Promise.reject(new Error("token fetch failed")));
      const { result } = renderHook(() =>
        useCollabRoom({ enabled: true, joinRequest: { kind: "chat" } }),
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      // Graceful degradation: no token → no socket, hook inert, and (critically) the
      // token-fetch rejection was swallowed — no unhandled promise rejection.
      expect(ioMock).not.toHaveBeenCalled();
      expect(result.current.isConnected).toBe(false);
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("fake-socket harness models MULTIPLE handlers per event with selective off (fidelity)", () => {
    // The shared fake must faithfully mirror socket.io's EventEmitter: on() ADDS a
    // listener (many per event), off(event, handler) removes ONLY that handler, and
    // trigger() invokes them ALL. A Map<string,handler> harness (one per event, off
    // deletes all) silently drops a second listener and over-removes on off — hiding
    // real cleanup regressions in the hook it stands in for. — PR#112 (e).
    const s = makeFakeSocket();
    const h1 = vi.fn();
    const h2 = vi.fn();
    s.on("evt", h1);
    s.on("evt", h2);
    s.trigger("evt", "x");
    expect(h1).toHaveBeenCalledWith("x");
    expect(h2).toHaveBeenCalledWith("x");

    // Selective off: only h1 is removed; h2 stays registered.
    s.off("evt", h1);
    s.trigger("evt", "y");
    expect(h1).toHaveBeenCalledTimes(1); // not invoked again
    expect(h2).toHaveBeenCalledTimes(2); // still invoked

    // off with no handler clears every listener for the event.
    s.off("evt");
    s.trigger("evt", "z");
    expect(h2).toHaveBeenCalledTimes(2); // no further invocation
  });

  it("does NOT reconnect when a fresh joinRequest object with the same kind is passed each render", async () => {
    seedToken(JWT);
    const { rerender } = renderHook(
      ({ n }: { n: number }) =>
        // New object literal every render; primitive-derived deps must stay stable.
        useCollabRoom({ enabled: true, joinRequest: { kind: "chat" }, bindEvents: () => () => void n }),
      { initialProps: { n: 0 } },
    );
    await connectedSocket();
    expect(ioMock).toHaveBeenCalledTimes(1);

    rerender({ n: 1 });
    rerender({ n: 2 });
    // Still a single io() connection — the effect did not re-run on identity churn.
    expect(ioMock).toHaveBeenCalledTimes(1);
  });
});
