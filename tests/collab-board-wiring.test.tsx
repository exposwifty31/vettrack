/**
 * @vitest-environment happy-dom
 *
 * R-RTC-1.3 card BD — command-board co-presence wiring (Feature 2).
 *
 * The collab channel is EPHEMERAL + ADVISORY. On `/board` it carries peer cursors,
 * co-presence, and selection highlights only — a pure overlay on top of the board.
 * These lock the wiring contract:
 *
 *   1. A peer `peer-cursor` event surfaces that peer's cursor; the overlay maps the
 *      NORMALIZED {x,y} in [0,1] back to the board viewport (x*100% / y*100%).
 *   2. A `presence` event shows the co-presence indicator (who is on the board).
 *   3. With the socket unavailable (no token → getCollabSocket returns null) the
 *      board renders EXACTLY as today (static): no peer overlay, no error, and the
 *      board content is NEVER gated on the socket.
 *   4. The client THROTTLES cursor emission (~<=15/s, under the server 20/s cap),
 *      sends NO client-supplied userId (the server attaches identity), and the
 *      emitted x/y are finite numbers in [0,1] (normalized pointer / viewport).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// ── Fake socket.io-client (reuse the real collab-socket primitive) ────────────
interface FakeSocket {
  connected: boolean;
  emit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  handlers: Map<string, (payload?: unknown) => void>;
  trigger: (event: string, payload?: unknown) => void;
}

const fakeSockets: FakeSocket[] = [];

function makeFakeSocket(): FakeSocket {
  const handlers = new Map<string, (payload?: unknown) => void>();
  const s: FakeSocket = {
    connected: true,
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (payload?: unknown) => void) => {
      handlers.set(event, handler);
      return s;
    }),
    off: vi.fn((event: string) => {
      handlers.delete(event);
      return s;
    }),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(() => handlers.clear()),
    handlers,
    trigger: (event, payload) => {
      const h = handlers.get(event);
      if (h) h(payload);
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
import { useBoardCoPresence } from "@/board/useBoardCoPresence";
import { BoardCoPresenceOverlay } from "@/board/BoardCoPresenceOverlay";
import { BoardCoPresenceProvider } from "@/board/board-copresence-context";
import { CommandBoard } from "@/features/command-board/components/CommandBoard";
import type { EquipmentCommandBoardSnapshot } from "@/types/safety-surfaces";
import { t } from "@/lib/i18n";

const JWT = "aaa.bbb.ccc"; // isLikelyJwt: three non-empty dot-parts

function seedToken(token: string | null) {
  setAuthState({ userId: "me", email: "", name: "", bearerToken: token });
}

/** Flush the async fresh-token mint → connect, then assert the socket exists. */
async function connectedSocket(): Promise<FakeSocket> {
  await waitFor(() => expect(fakeSockets).toHaveLength(1));
  return fakeSockets[0]!;
}

function dispatchPointer(clientX: number, clientY: number) {
  window.dispatchEvent(new MouseEvent("pointermove", { clientX, clientY }));
}

afterEach(() => {
  cleanup();
  closeCollabSocket();
  setClerkTokenGetter(null);
  ioMock.mockClear();
  fakeSockets.length = 0;
  seedToken(null);
});

describe("useBoardCoPresence — Feature 2 wiring (R-RTC-1.3)", () => {
  it("surfaces a peer cursor (server-attached userId) and peer presence", async () => {
    seedToken(JWT);
    const { result } = renderHook(() => useBoardCoPresence());
    const socket = await connectedSocket();

    act(() =>
      socket.trigger("presence", {
        room: "clinic:c1:board",
        members: [{ userId: "peer-1", displayName: "Dana" }],
      }),
    );
    act(() => socket.trigger("peer-cursor", { userId: "peer-1", x: 0.5, y: 0.25 }));

    expect(result.current.presentMembers).toEqual([{ userId: "peer-1", displayName: "Dana" }]);
    const cursor = result.current.peerCursors.find((c) => c.userId === "peer-1");
    expect(cursor).toEqual({ userId: "peer-1", x: 0.5, y: 0.25 });
  });

  it("re-joins the board room on every (re)connect (rooms are per-connection)", async () => {
    // On the long-lived /board kiosk a WS blip is PERMANENT death for the overlay
    // unless the `connect` handler re-emits join. Panel #1 (HIGH).
    seedToken(JWT);
    const { result } = renderHook(() => useBoardCoPresence());
    const socket = await connectedSocket();
    expect(socket.emit.mock.calls.filter((c) => c[0] === "join")).toHaveLength(1);

    act(() => socket.trigger("connect"));
    expect(socket.emit.mock.calls.filter((c) => c[0] === "join")).toHaveLength(2);
    expect(result.current.isConnected).toBe(true);
  });

  it("ignores a `presence` event for a DIFFERENT room (shared-socket isolation)", async () => {
    // A room-A presence must NOT overwrite the board's room-B roster on the shared
    // socket. Panel #3 (MEDIUM).
    seedToken(JWT);
    const { result } = renderHook(() => useBoardCoPresence());
    const socket = await connectedSocket();
    await act(async () => {
      const joinCall = socket.emit.mock.calls.find((c) => c[0] === "join");
      (joinCall?.[2] as ((r: unknown) => void) | undefined)?.({
        ok: true,
        room: "clinic:c1:board",
        members: [{ userId: "board-peer", displayName: "BoardPeer" }],
      });
    });
    expect(result.current.presentMembers).toEqual([{ userId: "board-peer", displayName: "BoardPeer" }]);

    act(() =>
      socket.trigger("presence", {
        room: "clinic:c1:chat",
        members: [{ userId: "chat-peer", displayName: "ChatPeer" }],
      }),
    );
    expect(result.current.presentMembers).toEqual([{ userId: "board-peer", displayName: "BoardPeer" }]);
  });

  it("surfaces a peer selection (highlighted entity id)", async () => {
    seedToken(JWT);
    const { result } = renderHook(() => useBoardCoPresence());
    const socket = await connectedSocket();

    act(() => socket.trigger("peer-selection", { userId: "peer-2", entityId: "eq-42" }));

    expect(result.current.peerSelections).toContainEqual({ userId: "peer-2", entityId: "eq-42" });
  });

  it("THROTTLES cursor emission, sends NO userId, and emits x/y in [0,1]", async () => {
    seedToken(JWT);
    const clock = { t: 0 };
    const { result } = renderHook(() => useBoardCoPresence({ now: () => clock.t }));
    const socket = await connectedSocket();
    // join must have been acknowledged for real relaying, but the client emits
    // regardless (the server drops un-joined emits) — accept the join anyway.
    const joinCall = socket.emit.mock.calls.find((c) => c[0] === "join");
    (joinCall?.[2] as ((r: unknown) => void) | undefined)?.({ ok: true, room: "clinic:c1:board", members: [] });

    // Three pointer moves in the SAME throttle window → exactly ONE emit.
    act(() => {
      dispatchPointer(512, 384);
      dispatchPointer(520, 390);
      dispatchPointer(530, 400);
    });
    let cursorEmits = socket.emit.mock.calls.filter((c) => c[0] === "board-cursor");
    expect(cursorEmits).toHaveLength(1);

    const payload = cursorEmits[0]![1] as { x: number; y: number; userId?: string };
    expect(payload).not.toHaveProperty("userId"); // server attaches identity
    expect(Number.isFinite(payload.x)).toBe(true);
    expect(Number.isFinite(payload.y)).toBe(true);
    expect(payload.x).toBeGreaterThanOrEqual(0);
    expect(payload.x).toBeLessThanOrEqual(1);
    expect(payload.y).toBeGreaterThanOrEqual(0);
    expect(payload.y).toBeLessThanOrEqual(1);

    // Next window → a further move emits again (throttle is time-gated, not one-shot).
    clock.t += 1_000;
    act(() => dispatchPointer(600, 500));
    cursorEmits = socket.emit.mock.calls.filter((c) => c[0] === "board-cursor");
    expect(cursorEmits).toHaveLength(2);

    // Out-of-viewport coordinates are CLAMPED into [0,1], never relayed raw.
    clock.t += 1_000;
    act(() => dispatchPointer(999_999, 999_999));
    const last = socket.emit.mock.calls.filter((c) => c[0] === "board-cursor").at(-1)![1] as {
      x: number;
      y: number;
    };
    expect(last.x).toBeLessThanOrEqual(1);
    expect(last.y).toBeLessThanOrEqual(1);

    // Selection emission carries only the entity id — no client userId.
    act(() => result.current.selectEntity("eq-7"));
    const selCall = socket.emit.mock.calls.find((c) => c[0] === "board-selection");
    expect(selCall).toBeTruthy();
    expect(selCall![1]).toEqual({ entityId: "eq-7" });
    expect(selCall![1]).not.toHaveProperty("userId");
  });

  it("degrades with NO token: no socket, hook inert, pointer moves never throw/emit", async () => {
    seedToken(null);
    const { result } = renderHook(() => useBoardCoPresence());

    // Give the async mint a chance to run — it resolves null → never connects.
    await act(async () => {
      await Promise.resolve();
    });

    expect(ioMock).not.toHaveBeenCalled();
    expect(fakeSockets).toHaveLength(0);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.peerCursors).toEqual([]);
    expect(result.current.presentMembers).toEqual([]);
    // Pointer moves + selection are no-ops when the socket is unavailable.
    act(() => dispatchPointer(100, 100));
    act(() => result.current.selectEntity("eq-1"));
    expect(fakeSockets).toHaveLength(0);
  });
});

describe("BoardCoPresenceOverlay — render + degradation", () => {
  it("maps a peer's normalized cursor back to the board viewport (x*100% / y*100%)", () => {
    render(
      <BoardCoPresenceOverlay
        peerCursors={[{ userId: "peer-1", x: 0.5, y: 0.25 }]}
        presentMembers={[{ userId: "peer-1", displayName: "Dana" }]}
      />,
    );
    const cursor = screen.getByTestId("board-cursor-peer-1");
    expect(cursor.style.left).toBe("50%");
    expect(cursor.style.top).toBe("25%");
    // The cursor is labelled with the peer's display name.
    expect(cursor.textContent).toContain("Dana");
  });

  it("shows the co-presence indicator naming who is on the board", () => {
    render(
      <BoardCoPresenceOverlay
        peerCursors={[]}
        presentMembers={[{ userId: "peer-1", displayName: "Dana" }]}
      />,
    );
    expect(screen.getByText(t.board.collab.present)).toBeTruthy();
    expect(screen.getByText(/Dana/)).toBeTruthy();
  });

  it("renders the board content with NO peer overlay when there are no peers (degraded)", () => {
    render(
      <div>
        <div>BOARD CONTENT</div>
        <BoardCoPresenceOverlay peerCursors={[]} presentMembers={[]} />
      </div>,
    );
    // Board content is present and unaffected.
    expect(screen.getByText("BOARD CONTENT")).toBeTruthy();
    // No peer cursor / co-presence indicator elements exist.
    expect(screen.queryByTestId(/^board-cursor-/)).toBeNull();
    expect(screen.queryByText(t.board.collab.present)).toBeNull();
  });
});

// ── Selection: real producer + visible highlight (board content wiring) ───────
// The reviewer required Feature 2's selection third to be functional end-to-end:
// `/board` must actually EMIT board-selection (a real producer), and a peer's
// selection must render a VISIBLE highlight keyed to the entity — not an inert
// hidden marker. These render the REAL CommandBoard content so the producer +
// consumer are proven through the shipped component, not a stand-in.

type BoardUnit = EquipmentCommandBoardSnapshot["criticalUnits"][number];

function unit(equipmentId: string): BoardUnit {
  // status !== ready/in_use → surfaces in the board's needs-attention UnitRow list.
  return {
    equipmentId,
    displayName: `Unit ${equipmentId}`,
    status: "blocked",
    blockingReasons: [],
    citationsCount: 0,
    truthHref: "#",
  };
}

function boardWith(units: BoardUnit[]): EquipmentCommandBoardSnapshot {
  return {
    generatedAt: "2026-07-16T00:00:00.000Z",
    clinicId: "c1",
    overview: {
      totalCritical: units.length,
      ready: 0,
      inUse: 0,
      blocked: units.length,
      stale: 0,
      overdue: 0,
      unknown: 0,
      belowThresholdTypes: 0,
      activeEmergencyUnits: 0,
    },
    byType: [],
    byLocation: [],
    criticalUnits: units,
    alerts: [], // no critical alerts → calm layout (deterministic UnitRow render)
    roiSignals: {
      overusedUnits: [],
      underusedUnits: [],
      repairReplaceCandidates: [],
      typeShortages: [],
      duplicatePurchaseRisks: [],
    },
  };
}

function renderBoardContent(
  board: EquipmentCommandBoardSnapshot,
  provider?: {
    selectEntity?: (id: string | null) => void;
    peerSelections?: { userId: string; entityId: string }[];
    presentMembers?: { userId: string; displayName: string }[];
  },
) {
  const { hook } = memoryLocation({ path: "/board" });
  const content = (
    <CommandBoard
      board={board}
      currentTime="2026-07-16T00:00:00.000Z"
      currentShift={[]}
      kioskMode={false}
    />
  );
  return render(
    <Router hook={hook}>
      {provider ? (
        <BoardCoPresenceProvider
          selectEntity={provider.selectEntity ?? (() => {})}
          peerSelections={provider.peerSelections ?? []}
          presentMembers={provider.presentMembers ?? []}
        >
          {content}
        </BoardCoPresenceProvider>
      ) : (
        content
      )}
    </Router>,
  );
}

describe("board selection — real producer + visible highlight (R-RTC-1.3)", () => {
  it("emits board-selection (entity id, NO userId) when a real board unit is highlighted", () => {
    const selectEntity = vi.fn();
    renderBoardContent(boardWith([unit("eq-1")]), { selectEntity });
    const row = screen.getByTestId("board-unit-row-eq-1");
    fireEvent.pointerEnter(row);
    expect(selectEntity).toHaveBeenCalledWith("eq-1");
    fireEvent.pointerLeave(row);
    expect(selectEntity).toHaveBeenCalledWith(null);
  });

  it("renders a VISIBLE highlight (not a hidden marker) on the peer-selected unit, keyed to entity id", () => {
    renderBoardContent(boardWith([unit("eq-9"), unit("eq-8")]), {
      peerSelections: [{ userId: "peer-3", entityId: "eq-9" }],
      presentMembers: [{ userId: "peer-3", displayName: "Noa" }],
    });
    const selected = screen.getByTestId("board-unit-row-eq-9");
    const other = screen.getByTestId("board-unit-row-eq-8");
    expect(selected.getAttribute("data-board-peer-selected")).toBe("true");
    expect(selected.hasAttribute("hidden")).toBe(false); // visible, not the old inert marker
    expect(selected.textContent).toContain("Noa"); // advisory: names who is looking
    expect(other.getAttribute("data-board-peer-selected")).toBeNull(); // only the selected entity
  });

  it("renders the board unit with NO highlight and no error when there is no provider (degraded)", () => {
    expect(() => renderBoardContent(boardWith([unit("eq-1")]))).not.toThrow();
    const row = screen.getByTestId("board-unit-row-eq-1");
    expect(row.getAttribute("data-board-peer-selected")).toBeNull();
    // Hovering is a harmless no-op under the inert default context — nothing gated.
    fireEvent.pointerEnter(row);
    expect(row.getAttribute("data-board-peer-selected")).toBeNull();
  });
});
