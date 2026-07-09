import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const repoRoot = path.resolve(__dirname, "..");
// Tasks feature source spans Tasks.tsx + the extracted task-utils.tsx (R6 split);
// read both so token definitions (in task-utils) and usages (in Tasks) are covered.
const appointments = [
  fs.readFileSync(path.join(repoRoot, "src", "pages", "Tasks.tsx"), "utf8"),
  fs.readFileSync(path.join(repoRoot, "src", "pages", "tasks", "task-utils.tsx"), "utf8"),
].join("\n");
const layout = fs.readFileSync(path.join(repoRoot, "src", "components", "layout.tsx"), "utf8");
const home = fs.readFileSync(path.join(repoRoot, "src", "pages", "home.tsx"), "utf8");

describe("Wave 3 UI token consistency checks (static)", () => {
  it("Appointments urgent badges use centralized style tokens", () => {
    expect(
      appointments.includes("const URGENT_BADGE_STYLES = {") &&
        appointments.includes("className={URGENT_BADGE_STYLES.overdue}") &&
        appointments.includes("className={URGENT_BADGE_STYLES.critical}"),
    ).toBe(true);
  });

  it("Appointments critical priority badge uses semantic destructive tokens", () => {
    expect(appointments).toContain("critical: \"bg-destructive text-destructive-foreground border-transparent\"");
  });

  it("Appointments high priority badge uses semantic accent tokens", () => {
    expect(appointments).toContain("high: \"bg-accent text-accent-foreground border-transparent\"");
  });

  it("Appointments normal task priority uses neutral semantic tokens", () => {
    expect(appointments).toContain("normal: \"bg-muted text-foreground border-border\"");
  });

  it("Appointments critical task priority uses semantic destructive tokens", () => {
    expect(appointments).toContain("critical: \"bg-destructive/10 text-destructive border-destructive/30\"");
  });

  it("Appointments high task priority uses semantic accent tokens", () => {
    expect(appointments).toContain("high: \"bg-accent text-accent-foreground border-border\"");
  });

  it("Layout bottom navigation uses Ivory design token classes", () => {
    expect(
      layout.includes("fixed bottom-0 left-0 right-0") &&
        layout.includes("border-t") &&
        layout.includes("border-ivory-border") &&
        layout.includes("text-ivory-green"),
    ).toBe(true);
  });

  it("Home status visuals use semantic design tokens", () => {
    // Phase 3 (A2): status visuals moved into the home surfaces.
    const surfaces = [
      ["src", "features", "today", "surfaces", "HomeShell.tsx"],
      ["src", "features", "today", "surfaces", "OnShiftHero.tsx"],
      ["src", "features", "today", "surfaces", "ops", "ops-tile-helpers.tsx"],
    ]
      .map((p) => fs.readFileSync(path.join(repoRoot, ...p), "utf8"))
      .join("\n");
    expect(
      surfaces.includes("var(--sys-red)") && surfaces.includes("var(--sys-green)"),
    ).toBe(true);
  });
});
