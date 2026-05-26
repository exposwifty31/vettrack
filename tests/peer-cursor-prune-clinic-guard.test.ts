/**
 * Codex P1 (PR #485): peer cursor 0 must not RESET_STATE across clinics.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("peer cursor prune — clinic guard", () => {
  it("handlePeerAhead gates cursor-zero reset on shouldApplyPeerPruneReset", () => {
    const src = readFileSync("src/lib/realtime.ts", "utf8");
    const fn = src.slice(
      src.indexOf("private async handlePeerAhead"),
      src.indexOf("private shouldApplyPeerPruneReset"),
    );
    expect(fn).toMatch(
      /peerCursor === 0[\s\S]*shouldApplyPeerPruneReset\(peerClinicId\)[\s\S]*handleResetState/,
    );
  });

  it("shouldApplyPeerPruneReset requires matching peer and local clinicId", () => {
    const src = readFileSync("src/lib/realtime.ts", "utf8");
    const fn = src.slice(
      src.indexOf("private shouldApplyPeerPruneReset"),
      src.indexOf("private async establishBaselineAfterFullRefresh"),
    );
    expect(fn).toContain("getCurrentClinicId");
    expect(fn).toContain("peerClinicId === localClinicId");
    expect(fn).toMatch(/if\s*\(\s*!peerClinicId\s*\)\s*return false/);
  });

  it("publishCursor includes clinicId in envelope payload when known", () => {
    const src = readFileSync("src/lib/realtime.ts", "utf8");
    const fn = src.slice(src.indexOf("function publishCursor"), src.indexOf("export function publishBuildTagGossip"));
    expect(fn).toContain("getCurrentClinicId");
    expect(fn).toMatch(/payload:\s*clinicId\s*\?\s*\{\s*clinicId\s*\}/);
  });
});
