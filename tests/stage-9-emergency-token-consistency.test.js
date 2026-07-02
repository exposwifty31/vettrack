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
