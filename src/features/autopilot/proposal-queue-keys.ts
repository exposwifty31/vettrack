import type { ActionProposalKind, ActionProposalStatus } from "@/types/action-proposals";

/**
 * VetTrack 2.0, Task 1.1 §6 — the proposal-queue TanStack Query key builder,
 * split into its own zero-dependency module so presentational components
 * (e.g. `ProposalCard`, which only needs the key to invalidate on a
 * decision) don't have to import `use-proposal-queue.ts` and its
 * `useCollabRoom` → `collab-socket.ts` → `socket.io-client` chain.
 */
export const PROPOSAL_QUEUE_QUERY_ROOT_KEY = "/api/action-proposals";

export function proposalQueueQueryKey(
  params: { status?: ActionProposalStatus; kind?: ActionProposalKind } = {},
) {
  return [PROPOSAL_QUEUE_QUERY_ROOT_KEY, params] as const;
}

/**
 * Query options for the kiosk board's ambient proposal count (§6 review
 * follow-up): the board tab has no collab-ws nudge subscription and never
 * refocuses, so a bounded `refetchInterval` is its only way to track a
 * mid-session queue change. 60s is deliberate — an ambient glance number,
 * not a task surface.
 */
export const boardProposalCountQueryOptions = {
  staleTime: 30_000,
  retry: false,
  refetchOnWindowFocus: false,
  refetchInterval: 60_000,
} as const;
