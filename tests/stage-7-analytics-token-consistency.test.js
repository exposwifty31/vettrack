import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(repoRoot, ...p), "utf8");

const BANNED = /\b(emerald|amber|zinc|indigo|slate)-[0-9]|\b(red|green|blue|gray)-[0-9]{2,3}\b|#[0-9a-fA-F]{6}/;
const HEBREW = /[֐-׿]/;

describe("Stage 7 — analytics.tsx", () => {
  const src = read("src", "pages", "analytics.tsx");
  it("has no hardcoded palette", () => {
    expect(BANNED.test(src)).toBe(false);
  });
  it("themes the stat-tile icons with status tokens", () => {
    expect(src.includes("hsl(var(--status-ok))")).toBe(true);
    expect(src.includes("hsl(var(--status-issue))")).toBe(true);
    expect(src.includes("hsl(var(--status-stale))")).toBe(true);
    expect(src.includes("hsl(var(--status-sterilized))")).toBe(true);
  });
  it("themes the recharts axes/grid with theme neutrals", () => {
    expect(src.includes("hsl(var(--border))")).toBe(true);
    expect(src.includes("hsl(var(--muted-foreground))")).toBe(true);
  });
  it("themes the status-distribution donut with status tokens", () => {
    expect(src.includes("hsl(var(--status-maintenance))")).toBe(true);
  });
});

describe("Stage 7 — management-dashboard.tsx", () => {
  const src = read("src", "pages", "management-dashboard.tsx");
  it("has no hardcoded palette", () => {
    expect(BANNED.test(src)).toBe(false);
  });
  it("has no dark: palette overrides on the summary strip", () => {
    expect(/dark:(bg|text|border)-(emerald|amber|red)/.test(src)).toBe(false);
  });
  it("uses pre-formed status surfaces for the summary strip", () => {
    expect(src.includes("var(--status-ok-bg)")).toBe(true);
    expect(src.includes("var(--status-stale-bg)")).toBe(true);
    expect(src.includes("var(--status-issue-bg)")).toBe(true);
  });
});

describe("Stage 7 — shift-leaderboard.tsx", () => {
  const src = read("src", "pages", "shift-leaderboard.tsx");
  it("has no hardcoded palette", () => {
    expect(BANNED.test(src)).toBe(false);
  });
  it("has no Hebrew glyphs in source", () => {
    expect(HEBREW.test(src)).toBe(false);
  });
  it("uses stale status tokens for the zero-capture highlight", () => {
    expect(src.includes("var(--status-stale-bg)")).toBe(true);
    expect(src.includes("var(--status-stale-fg)")).toBe(true);
  });
});
