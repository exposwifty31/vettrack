import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Stage 2 — Card primitive token LOCK (static source assertions).
 *
 * Stage 2 iOS Card (docs/design-handoff/stages-full/project/Stage 2 -
 * Component Library.dc.html §6): flat surface with an inset top highlight
 * (no drop shadow at rest in light), attention (orange) + critical (red)
 * leading rails via logical border-inline-start, and a 12/20/16
 * header/content/footer padding rhythm.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const src = fs.readFileSync(
  path.join(repoRoot, "src", "components", "ui", "card.tsx"),
  "utf8",
);

describe("Stage 2 Card — surface treatment", () => {
  it("drops the resting drop shadow for an inset top highlight", () => {
    expect(src.includes("shadow-card")).toBe(false);
    expect(src.includes("shadow-[inset_0_1px_0")).toBe(true);
  });
});

describe("Stage 2 Card — attention + critical rails", () => {
  it("exposes attention/critical variants", () => {
    expect(src.includes("attention")).toBe(true);
    expect(src.includes("critical")).toBe(true);
  });
  it("attention uses an orange leading rail (logical border-inline-start)", () => {
    expect(src.includes("border-s-4")).toBe(true);
    expect(src.includes("var(--sys-orange)")).toBe(true);
  });
  it("critical uses a red rail lifted onto the floating shadow", () => {
    expect(src.includes("var(--sys-red)")).toBe(true);
    expect(src.includes("shadow-floating")).toBe(true);
  });
});

describe("Stage 2 Card — 12/20/16 rhythm", () => {
  it("content is inset 20px; header gap 12px; footer 16px", () => {
    expect(src.includes("px-5")).toBe(true); // 20px content inset
    expect(src.includes("pb-3")).toBe(true); // 12px header→content gap
    expect(src.includes("pb-4")).toBe(true); // 16px footer
  });
});
