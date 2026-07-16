/**
 * @vitest-environment happy-dom
 *
 * R-CB-03 (CLICK-PATH-011 · MEDIUM · FROZEN Code Blue surface) — a failed quick-log
 * optimistic write must roll back ONLY its own optimistic entry, never restore a
 * whole pre-request snapshot. The old code snapshotted the entire session cache
 * before the optimistic write and restored it on error, discarding any teammate
 * log entry / presence update that arrived (via the 2s poll) during the request.
 *
 * Contract: cancelQueries before the optimistic write; on error remove only the
 * optimistic entry by its client id. Teammates' concurrent entries survive.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { RealtimeKeepalivePayload } from "@/lib/realtime";
import type { SessionPollResult, CodeBlueLogEntry } from "@/hooks/useCodeBlueSession";

vi.mock("@/lib/realtime", () => ({
  subscribeKeepalive: (_cb: (p: RealtimeKeepalivePayload) => void) => () => {},
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ userId: "u1" }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const getActive = vi.fn<[], Promise<SessionPollResult>>();
let rejectAppend: ((e: Error) => void) | null = null;
const appendLog = vi.fn(
  () =>
    new Promise<void>((_resolve, reject) => {
      rejectAppend = reject;
    }),
);
vi.mock("@/lib/api", () => ({
  api: {
    codeBlue: {
      sessions: {
        getActive: () => getActive(),
        appendLog: (sessionId: string, payload: unknown) => appendLog(sessionId, payload),
        sendPresence: vi.fn(async () => {}),
      },
    },
  },
}));

const ACTIVE_KEY = ["/api/code-blue/sessions/active"] as const;

import { useCodeBlueSession } from "@/hooks/useCodeBlueSession";

function activeSessionWithLogs(logs: CodeBlueLogEntry[]): SessionPollResult {
  return {
    session: {
      id: "s1",
      clinicId: "c1",
      status: "active",
      startedAt: new Date().toISOString(),
      startedBy: "u1",
      startedByName: "Manager",
      managerUserId: "u1",
      managerUserName: "Manager",
    },
    logEntries: logs,
    presence: [],
    cartStatus: null,
    linkedEquipment: [],
  };
}

const teammateEntry: CodeBlueLogEntry = {
  id: "teammate-1",
  sessionId: "s1",
  elapsedMs: 1234,
  label: "Compressions started",
  category: "note",
  equipmentId: null,
  loggedByUserId: "u2",
  loggedByName: "Teammate",
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  getActive.mockReset();
  appendLog.mockClear();
  rejectAppend = null;
  localStorage.clear();
});

describe("R-CB-03 · quick-log rollback", () => {
  it("a failed log-entry removes only the optimistic entry; a teammate entry that arrived mid-request survives", async () => {
    getActive.mockResolvedValue(activeSessionWithLogs([]));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useCodeBlueSession(), { wrapper });
    await waitFor(() => expect(result.current.session?.id).toBe("s1"));

    // Fire the quick-log (do NOT await — it hangs on the controllable appendLog).
    act(() => {
      void result.current.logEntry({ label: "Epinephrine 1mg", category: "note" });
    });
    await waitFor(() =>
      expect(result.current.logEntries.some((e) => e.id.startsWith("optimistic-"))).toBe(true),
    );

    // A teammate's entry arrives DURING the request (the 2s poll delivering it).
    act(() => {
      client.setQueryData<SessionPollResult>(ACTIVE_KEY, (prev) =>
        prev ? { ...prev, logEntries: [...prev.logEntries, teammateEntry] } : prev,
      );
    });

    // Now the append fails.
    act(() => rejectAppend?.(new Error("network")));

    await waitFor(() =>
      expect(result.current.logEntries.some((e) => e.id.startsWith("optimistic-"))).toBe(false),
    ); // optimistic entry rolled back
    expect(result.current.logEntries.some((e) => e.id === "teammate-1")).toBe(true); // teammate SURVIVES
  });
});
