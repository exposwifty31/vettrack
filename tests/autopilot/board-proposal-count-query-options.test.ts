import { describe, it, expect } from "vitest";
import { boardProposalCountQueryOptions } from "../../src/features/autopilot/proposal-queue-keys";

describe("boardProposalCountQueryOptions (§6 review follow-up)", () => {
  it("gives the kiosk board a bounded refresh cadence — the ambient count must track reality without a socket", () => {
    // §6 review, non-blocking finding 1: the board tab has no nudge
    // subscription and no focus events; without a refetchInterval the count
    // freezes at mount for the whole kiosk session.
    expect(boardProposalCountQueryOptions.refetchInterval).toBe(60_000);
    expect(boardProposalCountQueryOptions.refetchOnWindowFocus).toBe(false);
    expect(boardProposalCountQueryOptions.staleTime).toBe(30_000);
    expect(boardProposalCountQueryOptions.retry).toBe(false);
  });
});
