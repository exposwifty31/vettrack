import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Stage 4 — Command board (display.tsx) token LOCK.
 *
 * The board was already largely tokenized. Stage 4 finishes it:
 *   - overdue reads the orange (maintenance) token, not red (issue).
 *   - the CodeBlueOverlay drops hardcoded #0d0505 / red-* / gray-* / green-*
 *     palette onto the theme-independent emergency-* + --sys-* tokens
 *     (restyle only — the overlay's SSE/timer behavior is frozen).
 *   - additive skeleton loading state + a footer status strip.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(repoRoot, "src", "pages", "display.tsx"), "utf8");

describe("Stage 4 board — no hardcoded palette (incl. Code Blue overlay)", () => {
  const banned = [
    "#0d0505", "emerald-", "indigo-", "zinc-",
    "red-100", "red-200", "red-300", "red-400", "red-500", "red-600", "red-700", "red-900",
    "amber-300", "amber-400", "green-400", "green-500", "gray-400", "gray-500", "gray-600",
    "blue-300", "blue-900",
  ];
  for (const token of banned) {
    it(`does not use the "${token}" palette`, () => {
      expect(src.includes(token)).toBe(false);
    });
  }
  it("Code Blue overlay reads the emergency-* tokens", () => {
    expect(src.includes("bg-emergency-bg")).toBe(true);
    expect(src.includes("bg-emergency-accent")).toBe(true);
    expect(src.includes("text-emergency-text2")).toBe(true);
  });
  it("fallback board unavailable notice uses the emergency-amber token", () => {
    expect(src.includes("text-emergency-amber")).toBe(true);
  });
});

describe("Stage 4 board — overdue reads orange, not red", () => {
  it("overdue maps to the maintenance (orange) token in all three maps", () => {
    // STATUS_COLOR / STATUS_BG / STATUS_BAR_COLOR overdue rows carry maintenance/maint.
    // (statusLabel's `overdue: t.board.overdue` map line has no class token — excluded.)
    const overdueLines = src
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
    expect(src.includes('data-testid="board-skeleton"')).toBe(true);
    expect(src.includes("motion-safe:animate-pulse")).toBe(true);
  });
  it("keeps the accessible loading label", () => {
    expect(src.includes("t.board.loading")).toBe(true);
  });
  it("renders a footer status strip reusing board.updated + board.live", () => {
    expect(/<footer/.test(src)).toBe(true);
    expect(src.includes("t.board.updated")).toBe(true);
    expect(src.includes("t.board.live")).toBe(true);
  });
});
