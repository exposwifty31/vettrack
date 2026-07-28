import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useCollabRoom } from "@/features/collab/useCollabRoom";
import { PROPOSAL_QUEUE_QUERY_ROOT_KEY, proposalQueueQueryKey } from "./proposal-queue-keys";
import type { ActionProposalKind, ActionProposalStatus, ListActionProposalsResponse } from "@/types/action-proposals";

export { PROPOSAL_QUEUE_QUERY_ROOT_KEY, proposalQueueQueryKey };

/**
 * VetTrack 2.0, Task 1.1 §6 / §1.5(d) — the Shift Autopilot approval-queue
 * data hook. Two independent refresh paths, deliberately not exclusive:
 *
 *  1. Polling fallback — `refetchOnWindowFocus: true` + a bounded interval
 *     (`PROPOSAL_QUEUE_REFETCH_INTERVAL_MS`). This is the hook's baseline
 *     behavior; it works identically whether or not the collab-ws channel
 *     ever connects (Capacitor native / restrictive network / channel
 *     disabled all degrade gracefully — see `useCollabRoom`'s contract).
 *  2. The `/collab-ws` `proposal-queue-changed` advisory nudge (§1.5,
 *     option 1) — when it arrives, invalidate the same query so a change
 *     surfaces faster than the poll interval. The nudge payload itself
 *     carries NO content (bare `{ kind: "proposal_queue_changed" }`); this
 *     hook only ever reads it as a trigger to refetch via the authenticated
 *     REST path, never as a data source.
 */
export const PROPOSAL_QUEUE_REFETCH_INTERVAL_MS = 60_000;

export interface UseProposalQueueOptions {
  status?: ActionProposalStatus;
  kind?: ActionProposalKind;
  /** Acquire the collab-ws nudge listener only while the surface is actually mounted (default true). */
  enableNudge?: boolean;
}

export function useProposalQueue(
  options: UseProposalQueueOptions = {},
): UseQueryResult<ListActionProposalsResponse> {
  const { status = "staged", kind, enableNudge = true } = options;
  const queryClient = useQueryClient();

  const query = useQuery<ListActionProposalsResponse>({
    queryKey: proposalQueueQueryKey({ status, kind }),
    queryFn: () => api.actionProposals.list({ status, kind }),
    refetchOnWindowFocus: true,
    refetchInterval: PROPOSAL_QUEUE_REFETCH_INTERVAL_MS,
  });

  useCollabRoom({
    enabled: enableNudge,
    joinRequest: { kind: "proposal-queue" },
    bindEvents: ({ on }) => {
      on("proposal-queue-changed", () => {
        void queryClient.invalidateQueries({ queryKey: [PROPOSAL_QUEUE_QUERY_ROOT_KEY] });
      });
    },
  });

  return query;
}
