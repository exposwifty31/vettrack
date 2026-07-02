import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Stage 6 — facility surfaces (Rooms list + Room Radar) palette→token LOCK.
 * The readiness chips, health rings and status text move off hardcoded
 * emerald/amber/red palette onto the --status-* / --sys-* tokens so both
 * themes are covered by one declaration.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(repoRoot, ...p), "utf8");

const BANNED = /\b(emerald|amber|zinc|indigo|slate)-[0-9]|\b(red|green|blue|gray)-[0-9]{2,3}\b|#[0-9a-fA-F]{6}/;

describe("Stage 6 facility — rooms-list.tsx", () => {
  const src = read("src", "pages", "rooms-list.tsx");
  it("has no hardcoded palette", () => {
    expect(BANNED.test(src)).toBe(false);
  });
  it("uses the status tokens for readiness chips + ring", () => {
    expect(src.includes("var(--status-ok-")).toBe(true);
    expect(src.includes("var(--status-issue-")).toBe(true);
    expect(src.includes("rgb(var(--sys-green))")).toBe(true);
  });
});

describe("Stage 6 facility — room-radar.tsx", () => {
  const src = read("src", "pages", "room-radar.tsx");
  it("has no hardcoded palette", () => {
    expect(BANNED.test(src)).toBe(false);
  });
  it("uses the status/sys tokens for readiness rings + chips", () => {
    expect(src.includes("var(--status-ok-")).toBe(true);
    expect(src.includes("var(--status-issue-")).toBe(true);
  });
});
