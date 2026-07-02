import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Stage 2 — Badge primitive token LOCK.
 *
 * Stage 2 §6.12: a count-overlay badge — a small circular red pill sized to sit
 * over an icon, driven by --sys-red, growing for two digits.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const src = fs.readFileSync(
  path.join(repoRoot, "src", "components", "ui", "badge.tsx"),
  "utf8",
);

describe("Stage 2 Badge — count overlay", () => {
  it("exposes a `count` variant bound to --sys-red", () => {
    expect(/count:\s*"/.test(src)).toBe(true);
    expect(src.includes("rgb(var(--sys-red))")).toBe(true);
  });
  it("count is a self-sizing circle (min-width for two digits)", () => {
    expect(src.includes("min-w-")).toBe(true);
    expect(src.includes("justify-center")).toBe(true);
  });
});
