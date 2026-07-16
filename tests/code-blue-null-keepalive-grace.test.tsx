/**
 * @vitest-environment happy-dom
 *
 * R-CB-02 (CLICK-PATH-010 · MEDIUM · FROZEN Code Blue surface) — a stale/racing
 * `activeCodeBlueSessionId: null` KEEPALIVE must NOT optimistically clear a
 * just-started session (an optimistic end in all but name — forbidden by the
 * Code Blue doctrine).
 *
 * Contract (grace retains FIRST, then confirm):
 *  - A null keepalive whose session is younger than RECONCILE_GRACE_MS is IGNORED
 *    — the session is retained and NO clearing refetch is issued, even if a
 *    refetch would return null.
 *  - Only AFTER the grace window may a confirming refetch run; it clears solely on
 *    a confirmed null. A refetch that still returns an active session (the null
 *    keepalive was stale) RETAINS the session.
 *
 * The frozen guardrail: server-confirmed end only; the client never optimistically
 * terminates emergency state.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { RealtimeKeepalivePayload } from "@/lib/realtime";
import type { SessionPollResult } from "@/hooks/useCodeBlueSession";

// Capture the keepalive callback so the test can fire a null keepalive on demand.
let keepaliveCb: ((p: RealtimeKeepalivePayload) => void) | null = null;
vi.mock("@/lib/realtime", () => ({
  subscribeKeepalive: (cb: (p: RealtimeKeepalivePayload) => void) => {
    keepaliveCb = cb;
    return () => {
      keepaliveCb = null;
    };
  },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ userId: "u1" }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const getActive = vi.fn<[], Promise<SessionPollResult>>();
vi.mock("@/lib/api", () => ({
  api: { codeBlue: { sessions: { getActive: () => getActive() } } },
}));

import { useCodeBlueSession, RECONCILE_GRACE_MS } from "@/hooks/useCodeBlueSession";

function activeSession(startedAtMs: number): SessionPollResult {
  return {
    session: {
      id: "s1",
      clinicId: "c1",
      status: "active",
      startedAt: new Date(startedAtMs).toISOString(),
      startedBy: "u1",
      startedByName: "Manager",
      managerUserId: "u1",
      managerUserName: "Manager",
    },
    logEntries: [],
    presence: [],
    cartStatus: null,
    linkedEquipment: [],
  };
}

const noSession: SessionPollResult = {
  session: null,
  logEntries: [],
  presence: [],
  cartStatus: null,
  linkedEquipment: [],
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const fireNullKeepalive = () =>
  act(() => keepaliveCb?.({ activeCodeBlueSessionId: null, stormHint: "none" }));

beforeEach(() => {
  keepaliveCb = null;
  getActive.mockReset();
  localStorage.clear();
});

describe("R-CB-02 · null keepalive grace", () => {
  it("within grace: a null keepalive retains a just-started session and issues NO clearing refetch", async () => {
    getActive.mockResolvedValue(activeSession(Date.now())); // age ~0 → within grace
    const { result } = renderHook(() => useCodeBlueSession(), { wrapper });
    await waitFor(() => expect(result.current.session?.id).toBe("s1"));

    const callsBefore = getActive.mock.calls.length;
    // A refetch WOULD return null — grace must prevent even issuing it.
    getActive.mockResolvedValue(noSession);

    fireNullKeepalive();
    await new Promise((r) => setTimeout(r, 50));

    expect(result.current.session?.id).toBe("s1"); // retained
    expect(getActive.mock.calls.length).toBe(callsBefore); // no clearing refetch during grace
  });

  it("after grace: a stale null keepalive does NOT clear a still-active session (confirming refetch wins)", async () => {
    getActive.mockResolvedValue(activeSession(Date.now() - 20 * RECONCILE_GRACE_MS)); // age >> grace
    const { result } = renderHook(() => useCodeBlueSession(), { wrapper });
    await waitFor(() => expect(result.current.session?.id).toBe("s1"));

    const callsBefore = getActive.mock.calls.length;
    // The confirming refetch still finds the session active — the keepalive was stale.
    getActive.mockResolvedValue(activeSession(Date.now() - 20 * RECONCILE_GRACE_MS));

    fireNullKeepalive();
    await waitFor(() => expect(getActive.mock.calls.length).toBeGreaterThan(callsBefore)); // confirming refetch ran
    await new Promise((r) => setTimeout(r, 50));

    expect(result.current.session?.id).toBe("s1"); // retained — never optimistically cleared
  });

  it("boundary: age RECONCILE_GRACE_MS−1 retains (within); exactly RECONCILE_GRACE_MS runs a confirming refetch", async () => {
    const NOW = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(NOW);
    try {
      // Session started (grace − 1) ago → age is exactly RECONCILE_GRACE_MS − 1 (within).
      getActive.mockResolvedValue(activeSession(NOW - (RECONCILE_GRACE_MS - 1)));
      const { result } = renderHook(() => useCodeBlueSession(), { wrapper });
      await waitFor(() => expect(result.current.session?.id).toBe("s1"));

      const callsWithin = getActive.mock.calls.length;
      getActive.mockResolvedValue(noSession); // a refetch WOULD return null

      fireNullKeepalive();
      await new Promise((r) => setTimeout(r, 20));
      expect(result.current.session?.id).toBe("s1"); // within (< grace) → retained
      expect(getActive.mock.calls.length).toBe(callsWithin); // and no clearing refetch

      // Advance the clock by 1ms → age is now exactly RECONCILE_GRACE_MS (the >= boundary).
      nowSpy.mockReturnValue(NOW + 1);
      fireNullKeepalive();
      await waitFor(() => expect(result.current.session).toBeNull()); // >= grace → confirming refetch cleared it
      expect(getActive.mock.calls.length).toBeGreaterThan(callsWithin);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("after grace: a confirmed null clears the session via a confirming refetch", async () => {
    getActive.mockResolvedValue(activeSession(Date.now() - 20 * RECONCILE_GRACE_MS)); // age >> grace
    const { result } = renderHook(() => useCodeBlueSession(), { wrapper });
    await waitFor(() => expect(result.current.session?.id).toBe("s1"));

    const callsBefore = getActive.mock.calls.length;
    getActive.mockResolvedValue(noSession); // the refetch confirms no active session

    fireNullKeepalive();
    await waitFor(() => expect(result.current.session).toBeNull()); // cleared
    expect(getActive.mock.calls.length).toBeGreaterThan(callsBefore); // via a confirming refetch, not an optimistic write
  });
});
