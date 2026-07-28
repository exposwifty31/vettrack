/**
 * @vitest-environment happy-dom
 *
 * VetTrack 2.0, Task 1.1 §6 / §1.5(d) — the approval-queue client hook.
 * Binding contract:
 *  - Polling fallback works IDENTICALLY whether or not the collab-ws nudge
 *    ever arrives: `refetchOnWindowFocus: true` + a bounded
 *    `refetchInterval` (60s), never solely socket-driven.
 *  - When the collab-ws `proposal-queue-changed` nudge fires, the queue
 *    query is invalidated (refetched) — the socket is ADVISORY only, never
 *    the source of truth for content (it carries no payload the hook reads).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const listMock = vi.fn();
let capturedNudgeHandler: (() => void) | undefined;

vi.mock("@/lib/api", () => ({
  api: { actionProposals: { list: (...args: unknown[]) => listMock(...args) } },
}));

vi.mock("@/features/collab/useCollabRoom", () => ({
  useCollabRoom: (opts: {
    bindEvents?: (binding: {
      on: (event: string, handler: (...args: unknown[]) => void) => void;
    }) => void;
  }) => {
    opts.bindEvents?.({
      on: (event, handler) => {
        if (event === "proposal-queue-changed") capturedNudgeHandler = handler as () => void;
      },
    });
    return { isConnected: false, isJoined: false, presentMembers: [], joinedRoom: null, socketRef: { current: null } };
  },
}));

import {
  useProposalQueue,
  PROPOSAL_QUEUE_REFETCH_INTERVAL_MS,
  proposalQueueQueryKey,
} from "@/features/autopilot/use-proposal-queue";

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe("useProposalQueue — Task 1.1 §6 / §1.5(d)", () => {
  beforeEach(() => {
    listMock.mockReset();
    listMock.mockResolvedValue({ proposals: [] });
    capturedNudgeHandler = undefined;
  });
  afterEach(() => cleanup());

  it("configures a bounded 60s poll + refetch-on-focus, independent of the socket", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useProposalQueue(), { wrapper: makeWrapper(qc) });

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));

    const query = qc.getQueryCache().find({ queryKey: proposalQueueQueryKey({ status: "staged" }) });
    expect(query).toBeDefined();
    expect(query!.options.refetchOnWindowFocus).toBe(true);
    expect(query!.options.refetchInterval).toBe(PROPOSAL_QUEUE_REFETCH_INTERVAL_MS);
    expect(PROPOSAL_QUEUE_REFETCH_INTERVAL_MS).toBe(60_000);
  });

  it("invalidates the queue query when the collab-ws nudge fires", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useProposalQueue(), { wrapper: makeWrapper(qc) });

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
    expect(capturedNudgeHandler).toBeTypeOf("function");

    capturedNudgeHandler!();

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["/api/action-proposals"] }),
    );
  });

  it("passes status/kind filters through to the list call", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useProposalQueue({ status: "staged", kind: "restock_po_on_burn" }), {
      wrapper: makeWrapper(qc),
    });

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
    expect(listMock).toHaveBeenCalledWith({ status: "staged", kind: "restock_po_on_burn" });
  });
});
