import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Stage 4 — Command board token LOCK.
 *
 * The board was already largely tokenized. Stage 4 finishes it:
 *   - overdue reads the orange (maintenance) token, not red (issue).
 *   - the CodeBlueOverlay drops hardcoded #0d0505 / red-* / gray-* / green-*
 *     palette onto the theme-independent emergency-* + --sys-* tokens
 *     (restyle only — the overlay's SSE/timer behavior is frozen).
 *   - additive skeleton loading state + a footer status strip.
 *
 * Phase 4 C1: the board moved out of src/pages/display.tsx into the
 * command-board feature module. Each assertion is repointed to the file that
 * now owns the token — the palette lock spans the whole surface (all four
 * files concatenated).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

const tokensSrc = read("src/features/command-board/status-tokens.ts");
const boardSrc = read("src/features/command-board/components/CommandBoard.tsx");
const overlaySrc = read("src/features/command-board/components/CodeBlueOverlay.tsx");
const screenSrc = read("src/features/command-board/CommandBoardScreen.tsx");
const allSrc = tokensSrc + boardSrc + overlaySrc + screenSrc;

describe("Stage 4 board — no hardcoded palette (incl. Code Blue overlay)", () => {
  const banned = [
    "#0d0505", "emerald-", "indigo-", "zinc-",
    "red-100", "red-200", "red-300", "red-400", "red-500", "red-600", "red-700", "red-900",
    "amber-300", "amber-400", "green-400", "green-500", "gray-400", "gray-500", "gray-600",
    "blue-300", "blue-900",
  ];
  for (const token of banned) {
    it(`does not use the "${token}" palette`, () => {
      expect(allSrc.includes(token)).toBe(false);
    });
  }
  it("Code Blue overlay reads the emergency-* tokens", () => {
    expect(overlaySrc.includes("bg-emergency-bg")).toBe(true);
    expect(overlaySrc.includes("bg-emergency-accent")).toBe(true);
    expect(overlaySrc.includes("text-emergency-text2")).toBe(true);
  });
  it("fallback board unavailable notice uses the emergency-amber token", () => {
    expect(screenSrc.includes("text-emergency-amber")).toBe(true);
  });
});

describe("Stage 4 board — overdue reads orange, not red", () => {
  it("overdue maps to the maintenance (orange) token in all three maps", () => {
    // STATUS_COLOR / STATUS_BG / STATUS_BAR_COLOR overdue rows carry maintenance/maint.
    // (statusLabel's `overdue: t.board.overdue` map line has no class token — excluded.)
    const overdueLines = tokensSrc
      .split(/\r?\n/)
      .filter((l) => /overdue:/.test(l) && /var\(--status/.test(l));
    expect(overdueLines.length).toBeGreaterThanOrEqual(3);
    for (const line of overdueLines) {
      expect(/maintenance|maint-/.test(line)).toBe(true);
      expect(/status-issue/.test(line)).toBe(false);
    }
  });
});

describe("Stage 4 board — additive skeleton + footer", () => {
  it("renders a board skeleton while the snapshot loads", () => {
    expect(screenSrc.includes('data-testid="board-skeleton"')).toBe(true);
    expect(screenSrc.includes("motion-safe:animate-pulse")).toBe(true);
  });
  it("keeps the accessible loading label", () => {
    expect(screenSrc.includes("t.board.loading")).toBe(true);
  });
  it("renders a footer status strip reusing board.updated + board.live", () => {
    expect(/<footer/.test(boardSrc)).toBe(true);
    expect(boardSrc.includes("t.board.updated")).toBe(true);
    expect(boardSrc.includes("t.board.live")).toBe(true);
  });
});
