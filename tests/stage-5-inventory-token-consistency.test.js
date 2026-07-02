import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Stage 5 — Inventory (inventory-page.tsx) token LOCK (static source assertions).
 *
 * The dominant audited defect on this screen is hardcoded Tailwind palette
 * (emerald/amber/red hex) instead of the Stage-1 semantic tokens. The Stage 5
 * prototype binds only --status-* / --action; it ships no brand hex of its own.
 *
 * BUG-010: the "Take Consumables" dispense button was position:fixed and stayed
 * pinned while the page scrolled. It must be inlined into the scroll flow.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(repoRoot, "src", "pages", "inventory-page.tsx"), "utf8");
const procSrc = fs.readFileSync(path.join(repoRoot, "src", "pages", "procurement.tsx"), "utf8");

describe("Stage 5 Inventory — consumes semantic status tokens", () => {
  it("stock indicators read the --status-* HSL tokens, not hardcoded palette", () => {
    expect(src.includes("hsl(var(--status-ok))")).toBe(true);
    expect(src.includes("hsl(var(--status-issue))")).toBe(true);
    expect(src.includes("hsl(var(--status-stale))")).toBe(true);
  });
  it("status banners/chips read the --status-*-{bg,fg,border} tokens", () => {
    expect(src.includes("var(--status-ok-bg)")).toBe(true);
    expect(src.includes("var(--status-issue-bg)")).toBe(true);
    expect(src.includes("var(--status-stale-bg)")).toBe(true);
  });
  it("confirm-green actions read the --action token (Button action variant)", () => {
    expect(/variant="action"/.test(src) || src.includes("var(--action)")).toBe(true);
  });
});

describe("Stage 5 Inventory — no hardcoded palette", () => {
  const banned = [
    "emerald-", "amber-", "red-500", "red-100", "red-900",
    "green-500", "green-600", "zinc-", "indigo-",
  ];
  for (const token of banned) {
    it(`does not use the "${token}" palette`, () => {
      expect(src.includes(token)).toBe(false);
    });
  }
});

describe("Stage 5 Procurement — no hardcoded palette", () => {
  const banned = ["emerald-", "amber-", "red-500", "indigo-", "green-6"];
  for (const token of banned) {
    it(`does not use the "${token}" palette`, () => {
      expect(procSrc.includes(token)).toBe(false);
    });
  }
  it("received-quantity emphasis reads the --status-ok token", () => {
    expect(procSrc.includes("var(--status-ok-fg)")).toBe(true);
  });
});

describe("Stage 5 Inventory — BUG-010 dispense button inlined", () => {
  it("the take-consumables control is no longer position:fixed", () => {
    // The old floating wrapper pinned the button with `fixed inset-x-0 ... z-40`.
    expect(/fixed inset-x-0[^"]*z-40/.test(src)).toBe(false);
  });
  it("still opens the dispense sheet via handleOpenDispense", () => {
    expect(src.includes("handleOpenDispense")).toBe(true);
    expect(src.includes("takeConsumables")).toBe(true);
  });
});
