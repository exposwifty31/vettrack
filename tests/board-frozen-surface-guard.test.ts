/**
 * TV board phase 1 (Task 14) — frozen-surface guard.
 *
 * The spec's §7 "ESLint no-restricted-imports" guard, adapted to this repo's
 * guard-test convention (vitest source-scan, like i18n-no-hebrew-in-source):
 * the repo has no lint infrastructure, so the guard is code that fails the
 * unit suite when a frozen surface is disturbed.
 *
 * Frozen surfaces (plan Global Constraints):
 *   1. Code Blue is priority zero: CommandBoardScreen's early return
 *      `if (snapshot.codeBlueSession) return <CodeBlueOverlay/>` renders
 *      BEFORE any board-state-driven render path.
 *   2. The snapshot poll contract (5 s / 2 s Code Blue acceleration) on
 *      /api/display/snapshot is untouched.
 *   3. The approvals/proposal queue is CUT from the kiosk (owner decision,
 *      Task 12) — no board module may re-import it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("board frozen surfaces", () => {
  it("CommandBoardScreen keeps the Code Blue early-return before any board-state render", () => {
    const src = readFileSync("src/features/command-board/CommandBoardScreen.tsx", "utf8");
    // The hook CALL (useBoardState) legitimately precedes the early return —
    // React's rules of hooks forbid calling it after a conditional return. The
    // frozen invariant is the RENDER order: an active Code Blue session returns
    // <CodeBlueOverlay/> before any render that consumes the board state.
    const earlyReturn = /if\s*\(snapshot\.codeBlueSession\)\s*\{\s*\n\s*return <CodeBlueOverlay/m;
    expect(src).toMatch(earlyReturn);
    const codeBlueIdx = src.search(earlyReturn);
    const stateHookIdx = src.indexOf("useBoardState(");
    const stateRenderIdx = src.indexOf("state={boardState}");
    expect(stateHookIdx).toBeGreaterThan(-1);
    expect(stateRenderIdx).toBeGreaterThan(-1);
    expect(codeBlueIdx).toBeLessThan(stateRenderIdx);
  });
  it("snapshot hook keeps the frozen poll contract (5s / 2s code-blue acceleration)", () => {
    const src = readFileSync("src/hooks/useDisplaySnapshot.ts", "utf8");
    expect(src).toContain("codeBlueSession ? 2_000 : 5_000");
    expect(src).toContain('"/api/display/snapshot"');
  });
  it("board modules do not import the approvals queue (cut by owner decision)", () => {
    const files = [
      "src/features/command-board/CommandBoardScreen.tsx",
      "src/features/command-board/components/CommandBoard.tsx",
      "src/features/command-board/components/BoardAttentionSection.tsx",
    ];
    for (const f of files) expect(readFileSync(f, "utf8")).not.toContain("actionProposals");
  });
});
