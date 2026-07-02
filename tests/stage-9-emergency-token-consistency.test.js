import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Stage 9 — Emergency & Collaboration palette→token LOCK.
 * Crash Cart check + Code Blue history move off hardcoded green/red/amber/zinc
 * palette onto the --status-* tokens (Ready / Needs-attention banner, present/
 * missing rows, outcome pills) so both themes read from one declaration.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(repoRoot, ...p), "utf8");

const BANNED = /\b(emerald|amber|zinc|indigo|slate)-[0-9]|\b(red|green|blue|gray)-[0-9]{2,3}\b|#[0-9a-fA-F]{6}/;

describe("Stage 9 — crash-cart.tsx", () => {
  const src = read("src", "pages", "crash-cart.tsx");
  it("has no hardcoded palette", () => {
    expect(BANNED.test(src)).toBe(false);
  });
  it("uses status tokens for the ready/attention banner + present/missing rows", () => {
    expect(src.includes("var(--status-ok-")).toBe(true);
    expect(src.includes("var(--status-issue-")).toBe(true);
  });
});

describe("Stage 9 — shift-chat BroadcastCard (BUG-002)", () => {
  const src = read("src", "features", "shift-chat", "components", "BroadcastCard.tsx");
  const types = read("src", "features", "shift-chat", "types.ts");
  it("has no hardcoded palette (indigo/green/red tokenized)", () => {
    expect(BANNED.test(src)).toBe(false);
  });
  it("renders copy from i18n, not hardcoded Hebrew", () => {
    expect(src.includes("t.shiftChat.broadcast.")).toBe(true);
    expect(/[֐-׿]/.test(src)).toBe(false);
  });
  it("keeps broadcast templates as keys only (label/subtitle live in i18n)", () => {
    expect(/[֐-׿]/.test(types)).toBe(false);
    expect(types.includes("department_close: {}")).toBe(true);
  });
});

describe("Stage 9 — shift-chat SystemCard (event alignment + i18n)", () => {
  const src = read("src", "features", "shift-chat", "components", "SystemCard.tsx");

  it("has no hardcoded palette (dark-only Tailwind → status tokens)", () => {
    expect(BANNED.test(src)).toBe(false);
  });
  it("renders copy from i18n, not hardcoded Hebrew", () => {
    expect(src.includes("t.shiftChat.system.")).toBe(true);
    expect(/[֐-׿]/.test(src)).toBe(false);
  });
  it("handles every event type the server actually emits", () => {
    // Emitted via postSystemMessage() across server/ (verified 2026-07-02).
    for (const key of [
      "code_blue_start",
      "code_blue_end",
      "code_blue_unreconciled",
      "equipment_overdue",
      "alert_reopened",
      "emergency_dispense_unresolved",
      "task_escalated",
      "critical_push_delivery_failed",
      "outbox_dlq_threshold_exceeded",
    ]) {
      expect(src.includes(`${key}:`)).toBe(true);
    }
  });
  it("drops config for events removed in migrations 142–143 / never emitted", () => {
    for (const dead of [
      "med_critical",
      "hosp_critical",
      "hosp_discharged",
      "hosp_deceased",
      "low_stock",
      "shift_summary",
    ]) {
      expect(src.includes(`${dead}:`)).toBe(false);
    }
  });
  it("uses status tokens for severity tone", () => {
    expect(src.includes("var(--status-issue-")).toBe(true);
    expect(src.includes("var(--status-ok-")).toBe(true);
    expect(src.includes("var(--status-stale-")).toBe(true);
  });
});

describe("Stage 9 — code-blue-history.tsx", () => {
  const src = read("src", "pages", "code-blue-history.tsx");
  it("has no hardcoded palette (zinc + outcome colors tokenized)", () => {
    expect(BANNED.test(src)).toBe(false);
  });
  it("maps outcome pills to status/sys tokens", () => {
    expect(src.includes("var(--status-ok-fg)")).toBe(true);
    expect(src.includes("var(--status-issue-fg)")).toBe(true);
    expect(src.includes("rgb(var(--sys-blue))")).toBe(true);
  });
  it("mirrors direction by locale instead of hardcoding dir=rtl", () => {
    expect(src.includes('dir="rtl"')).toBe(false);
    expect(src.includes("useDirection")).toBe(true);
    expect(src.includes("dir={dir}")).toBe(true);
  });
});
