import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(repoRoot, ...p), "utf8");
const BANNED = /\b(emerald|amber|zinc|indigo|slate)-[0-9]|\b(red|green|blue|gray)-[0-9]{2,3}\b|#[0-9a-fA-F]{6}/;
const HEBREW = /[֐-׿]/;

describe("Stage 8 — admin.tsx", () => {
  // The admin page was split into a shell (admin.tsx) + per-tab section files
  // (src/pages/admin/*.tsx). The token-consistency contract covers the whole
  // admin surface, so read the shell plus every section file.
  const adminDir = path.join(repoRoot, "src", "pages", "admin");
  const src =
    read("src", "pages", "admin.tsx") +
    fs
      .readdirSync(adminDir)
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => fs.readFileSync(path.join(adminDir, f), "utf8"))
      .join("\n");

  it("has no hardcoded palette", () => {
    expect(BANNED.test(src)).toBe(false);
  });

  it("has no Hebrew glyphs in source", () => {
    expect(HEBREW.test(src)).toBe(false);
  });

  it("uses status tokens for the status/severity badges", () => {
    expect(src.includes("var(--status-ok-")).toBe(true);
    expect(src.includes("var(--status-issue-")).toBe(true);
    expect(src.includes("var(--status-stale-")).toBe(true);
  });

  it("removed the audit-logs tab (S8-D1: audit log lives in Stage 7)", () => {
    expect(src.includes("admin-tab-audit-logs")).toBe(false);
    expect(src.includes('setActiveTab("audit-logs")')).toBe(false);
  });

  it("keeps the shift-requests tab (reachability: no other route renders it)", () => {
    expect(src.includes("admin-tab-shift-requests")).toBe(true);
  });
});

describe("Stage 8 — admin-shifts.tsx", () => {
  const src = read("src", "pages", "admin-shifts.tsx");

  it("has no hardcoded palette", () => {
    expect(BANNED.test(src)).toBe(false);
  });

  it("has no Hebrew glyphs in source", () => {
    expect(HEBREW.test(src)).toBe(false);
  });

  it("uses status tokens for valid/skipped row counts", () => {
    expect(src.includes("var(--status-ok-fg)")).toBe(true);
    expect(src.includes("var(--status-stale-fg)")).toBe(true);
  });

  it("styles preview stat numbers with the numeric font token", () => {
    expect(src.includes("var(--font-num)")).toBe(true);
  });
});

describe("Stage 8 — AdminAssetTypesPage.tsx", () => {
  const src = read("src", "pages", "AdminAssetTypesPage.tsx");

  it("has no hardcoded palette", () => {
    expect(BANNED.test(src)).toBe(false);
  });

  it("has no Hebrew glyphs in source", () => {
    expect(HEBREW.test(src)).toBe(false);
  });

  it("renders a dashed empty state and a responsive two-column layout", () => {
    expect(src.includes("border-dashed")).toBe(true);
    expect(/md:grid-cols-\[/.test(src)).toBe(true);
  });
});
