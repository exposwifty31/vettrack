import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Stage 2 — Skeleton primitive token LOCK.
 *
 * Stage 2 §6.14: skeletons use a moving shimmer sweep, gated under reduced
 * motion so it degrades to a static block (no animation) for users who opt out.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const src = fs.readFileSync(
  path.join(repoRoot, "src", "components", "ui", "skeleton.tsx"),
  "utf8",
);
const tw = fs.readFileSync(path.join(repoRoot, "tailwind.config.ts"), "utf8");

describe("Stage 2 Skeleton — shimmer sweep", () => {
  it("uses the shimmer animation, not a bare pulse", () => {
    expect(src.includes("animate-shimmer")).toBe(true);
    expect(src.includes("animate-pulse")).toBe(false);
  });
  it("gates the shimmer under reduced motion", () => {
    expect(src.includes("motion-reduce:animate-none")).toBe(true);
  });
  it("tailwind registers the shimmer keyframe + animation", () => {
    expect(tw.includes("shimmer:")).toBe(true);
    expect(/shimmer\s+[\d.]+m?s/.test(tw)).toBe(true); // animation duration present
    expect(tw.includes("backgroundPosition")).toBe(true);
  });
});
