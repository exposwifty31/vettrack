import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(repoRoot, ...p), "utf8");

const BANNED =
  /\b(emerald|amber|zinc|indigo|slate)-[0-9]|\b(red|green|blue|gray)-[0-9]{2,3}\b|#[0-9a-fA-F]{6}/;
const HEBREW = /[֐-׿]/;

describe("Stage 10 — help.tsx", () => {
  const src = read("src", "pages", "help.tsx");

  it("has no hardcoded palette", () => {
    expect(BANNED.test(src)).toBe(false);
  });

  it("adopts status surface tokens for the cheat-sheet rows", () => {
    expect(src.includes("var(--status-ok-bg)")).toBe(true);
    expect(src.includes("var(--status-ok-fg)")).toBe(true);
    expect(src.includes("var(--status-issue-bg)")).toBe(true);
    expect(src.includes("var(--status-issue-fg)")).toBe(true);
    expect(src.includes("var(--status-stale-bg)")).toBe(true);
    expect(src.includes("var(--status-stale-fg)")).toBe(true);
    expect(src.includes("var(--status-sterilized-bg)")).toBe(true);
  });
});

describe("Stage 10 — signin.tsx", () => {
  const src = read("src", "pages", "signin.tsx");

  it("has no Hebrew glyphs in source", () => {
    expect(HEBREW.test(src)).toBe(false);
  });

  it("renders user-facing copy through the authPage i18n namespace", () => {
    expect(src.includes("t.authPage.")).toBe(true);
  });
});

describe("Stage 10 — signup.tsx", () => {
  const src = read("src", "pages", "signup.tsx");

  it("has no Hebrew glyphs in source", () => {
    expect(HEBREW.test(src)).toBe(false);
  });

  it("renders user-facing copy through the authPage i18n namespace", () => {
    expect(src.includes("t.authPage.")).toBe(true);
  });
});
