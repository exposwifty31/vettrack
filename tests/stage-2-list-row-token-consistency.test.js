import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Stage 2 — ListRow primitive token LOCK.
 *
 * Stage 2 §6.18: a reusable list row — optional leading dot/icon, label (+
 * description), trailing meta + RTL-aware drill-in chevron, with hover / pressed
 * / selected states on the surface ramp and a 44px minimum touch target. Rows
 * use logical properties so they mirror correctly in Hebrew RTL.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const p = path.join(repoRoot, "src", "components", "ui", "list-row.tsx");
const src = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";

describe("ListRow — exists + exports", () => {
  it("exports a ListRow component", () => {
    expect(src.includes("export")).toBe(true);
    expect(src.includes("ListRow")).toBe(true);
  });
});

describe("ListRow — touch target + surface states", () => {
  it("meets the 44px minimum touch target", () => {
    expect(src.includes("min-h-11")).toBe(true);
  });
  it("hover + pressed read the surface ramp; selected is highlighted", () => {
    expect(src.includes("var(--surface-hover)")).toBe(true);
    expect(src.includes("var(--surface-active)")).toBe(true);
    expect(src.includes("selected")).toBe(true);
  });
});

describe("ListRow — RTL-safe drill-in", () => {
  it("uses the reading-forward chevron and logical properties", () => {
    expect(src.includes("ForwardChevron")).toBe(true);
    expect(src.includes("text-start")).toBe(true);
    expect(src.includes("ms-auto")).toBe(true);
  });
});
