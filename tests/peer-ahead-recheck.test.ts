/**
 * Phase 10 P1-8 regression: handlePeerAhead must re-check cursor
 * after awaiting in-flight recovery, matching handleCodeBlueSeenGossip.
 */
import { describe, it, expect } from "vitest";

describe("P1-8: handlePeerAhead re-checks after await", () => {
  it("re-evaluates cursor after awaiting peerRecoveryInFlight", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/realtime.ts", "utf8");
    const peerAheadFn = source.slice(
      source.indexOf("private async handlePeerAhead"),
      source.indexOf("private async establishBaselineAfterFullRefresh"),
    );
    expect(peerAheadFn).toContain("await this.peerRecoveryInFlight");
    const awaitIdx = peerAheadFn.indexOf("await this.peerRecoveryInFlight");
    const recheckAfterAwait = peerAheadFn.slice(awaitIdx + 30);
    expect(recheckAfterAwait).toContain("peerCursor <= this.lastAppliedEventId");
  });
});
