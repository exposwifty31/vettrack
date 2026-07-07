/**
 * Epic 8 Slice 1 — UI state primitives regression guard.
 *
 * These are static file-content checks that verify the primitives exist and
 * are wired up correctly. They run in the default vitest suite (no DB or live
 * server required) and should remain green on every commit.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

const loadingSection = read("src/components/ui/loading-section.tsx");
const errorCard      = read("src/components/ui/error-card.tsx");
const emptyState     = read("src/components/ui/empty-state.tsx");
const equipmentList  = read("src/pages/equipment-list.tsx");
const home           = read("src/pages/home.tsx");
const enLocale       = JSON.parse(read("locales/en.json"));
const heLocale       = JSON.parse(read("locales/he.json"));

// ── LoadingSection primitive ──────────────────────────────────────────────────

describe("LoadingSection primitive", () => {
  it("renders a skeleton-based loading state (never blank)", () => {
    expect(loadingSection).toContain("Skeleton");
    expect(loadingSection).toContain("Array.from");
  });

  it("has role=status and aria-busy for screen-reader accessibility", () => {
    expect(loadingSection).toContain('role="status"');
    expect(loadingSection).toContain('aria-busy="true"');
  });

  it("uses t.common.loading — no hardcoded loading text", () => {
    expect(loadingSection).toContain("t.common.loading");
    expect(loadingSection).not.toContain('"Loading"');
    expect(loadingSection).not.toContain("'Loading'");
  });

  it("exposes a sr-only span for non-visual feedback", () => {
    expect(loadingSection).toContain("sr-only");
  });
});

// ── ErrorCard primitive ───────────────────────────────────────────────────────

describe("ErrorCard primitive", () => {
  it("accepts onRetry callback and renders a retry button", () => {
    expect(errorCard).toContain("onRetry");
    expect(errorCard).toContain("handleRetry");
  });

  it("uses i18n keys — no raw error strings exposed", () => {
    expect(errorCard).toContain("t.errorCard.defaultMessage");
    expect(errorCard).toContain("t.errorCard.retry");
  });

  it("caps retry attempts before switching to page-reload CTA", () => {
    expect(errorCard).toContain("MAX_RETRIES");
    expect(errorCard).toContain("safeReloadPage");
  });
});

// ── EmptyState primitive ──────────────────────────────────────────────────────

describe("EmptyState primitive", () => {
  it("accepts icon, message, subMessage, and optional action", () => {
    expect(emptyState).toContain("icon: Icon");
    expect(emptyState).toContain("message");
    expect(emptyState).toContain("subMessage");
    expect(emptyState).toContain("action");
  });

  it("applies motion-safe animation to avoid jarring transitions", () => {
    expect(emptyState).toContain("motion-safe:animate-in");
  });
});

// ── Equipment-list integration ────────────────────────────────────────────────

describe("Equipment list state integration", () => {
  it("loading state: uses skeleton, not blank or hardcoded text (mobile)", () => {
    expect(equipmentList).toContain("EquipmentListSkeleton");
    expect(equipmentList).toContain("isLoading ? (");
  });

  it("loading state: list view uses EquipmentListSkeleton (no raw text)", () => {
    expect(equipmentList).toContain("<EquipmentListSkeleton count={PAGE_SIZE} />");
    expect(equipmentList).not.toContain("טוען...");
  });

  it("error state: ErrorCard with retry handler", () => {
    expect(equipmentList).toContain("<ErrorCard");
    expect(equipmentList).toContain("onRetry={() => refetchAll()}");
  });

  it("empty state: EmptyState with CTA for both filtered and unfiltered cases", () => {
    expect(equipmentList).toContain("<EmptyState");
    expect(equipmentList).toContain("t.equipmentList.empty.message");
    expect(equipmentList).toContain("t.equipmentList.empty.filteredHint");
    expect(equipmentList).toContain("t.equipmentList.empty.emptyHint");
  });

  it("rendering order: loading checked before empty", () => {
    const loadingIdx = equipmentList.indexOf("isLoading ? (");
    const emptyIdx   = equipmentList.indexOf("displayList.length === 0");
    expect(loadingIdx).toBeGreaterThan(-1);
    expect(emptyIdx).toBeGreaterThan(-1);
    expect(loadingIdx).toBeLessThan(emptyIdx);
  });
});

// ── Home dashboard integration ────────────────────────────────────────────────

// Phase 3 (A2): home.tsx is now a thin ops/floor fork; the state primitives moved
// into the shared surface pieces. These guards follow them to their new homes.
describe("Home dashboard state integration", () => {
  const recentActivity = read("src/features/today/surfaces/RecentActivityCard.tsx");
  const onShiftHero = read("src/features/today/surfaces/OnShiftHero.tsx");
  const floorSurface = read("src/features/today/surfaces/FloorHomeSurface.tsx");
  const opsSurface = read("src/features/today/surfaces/OpsHomeSurface.tsx");

  it("home.tsx forks to the ops/floor surfaces (no inline body left)", () => {
    expect(home).toContain("homeSurface");
    expect(home).toContain("OpsHomeSurface");
    expect(home).toContain("FloorHomeSurface");
  });

  it("loading state: activity feed shows LoadingSection while fetching", () => {
    expect(recentActivity).toContain("isLoading ? (");
    expect(recentActivity).toContain("<LoadingSection rows={4} />");
  });

  it("loading state: shift hero renders a skeleton while the pulse loads", () => {
    expect(onShiftHero).toContain('heroState === "loading"');
  });

  it("empty state: activity feed uses EmptyState with i18n keys", () => {
    expect(recentActivity).toContain("t.homePage.activityFeedEmpty");
    expect(recentActivity).toContain("t.homePage.activityFeedEmptyHint");
    expect(recentActivity).toContain("<EmptyState");
  });

  it("rest state: no-shift hero renders a designed empty state, not a blank", () => {
    expect(onShiftHero).toContain("t.home.shift.noShift");
    expect(onShiftHero).toContain("t.homePage.noShiftSub");
  });

  it("error state: home surfaces show ErrorCard with retry", () => {
    for (const surface of [floorSurface, opsSurface]) {
      expect(surface).toContain("<ErrorCard");
      expect(surface).toContain("onRetry");
    }
  });

  it("no hardcoded empty-state prose strings remain in the home surfaces", () => {
    for (const src of [recentActivity, onShiftHero, floorSurface, opsSurface]) {
      expect(src).not.toContain("No recent activity");
      expect(src).not.toContain("No inventory alerts");
      expect(src).not.toContain("Scans, status changes, and moves show up here");
      expect(src).not.toContain("Sterilization, maintenance, and issues appear here");
    }
  });
});

// ── Locale coverage ───────────────────────────────────────────────────────────

describe("Locale keys for new state strings", () => {
  it("en.json has all four new homePage keys", () => {
    const hp = enLocale.homePage;
    expect(hp).toHaveProperty("activityFeedEmpty");
    expect(hp).toHaveProperty("activityFeedEmptyHint");
    expect(hp).toHaveProperty("alertsEmpty");
    expect(hp).toHaveProperty("alertsEmptyHint");
  });

  it("he.json has all four new homePage keys", () => {
    const hp = heLocale.homePage;
    expect(hp).toHaveProperty("activityFeedEmpty");
    expect(hp).toHaveProperty("activityFeedEmptyHint");
    expect(hp).toHaveProperty("alertsEmpty");
    expect(hp).toHaveProperty("alertsEmptyHint");
  });

  it("he.json keys are non-empty Hebrew strings", () => {
    const hp = heLocale.homePage;
    expect(hp.activityFeedEmpty.length).toBeGreaterThan(0);
    expect(hp.alertsEmpty.length).toBeGreaterThan(0);
  });

  it("en.json and he.json homePage have identical key sets", () => {
    const enKeys = Object.keys(enLocale.homePage).sort();
    const heKeys = Object.keys(heLocale.homePage).sort();
    expect(enKeys).toEqual(heKeys);
  });
});
