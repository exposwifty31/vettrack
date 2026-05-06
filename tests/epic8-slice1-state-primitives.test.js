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

  it("loading state: desktop view uses LoadingSection skeleton (no raw text)", () => {
    expect(equipmentList).toContain("<LoadingSection rows={5} />");
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
    const emptyIdx   = equipmentList.indexOf("filtered.length === 0");
    expect(loadingIdx).toBeGreaterThan(-1);
    expect(emptyIdx).toBeGreaterThan(-1);
    expect(loadingIdx).toBeLessThan(emptyIdx);
  });
});

// ── Home dashboard integration ────────────────────────────────────────────────

describe("Home dashboard state integration", () => {
  it("loading state: activity feed shows LoadingSection while fetching", () => {
    expect(home).toContain("isLoading: activityLoading");
    expect(home).toContain("activityLoading ? (");
    expect(home).toContain("<LoadingSection rows={4} />");
  });

  it("loading state: alerts section shows LoadingSection while equipment loads", () => {
    expect(home).toContain("<LoadingSection rows={3} />");
  });

  it("empty state: activity feed uses EmptyState with i18n keys", () => {
    expect(home).toContain("t.homePage.activityFeedEmpty");
    expect(home).toContain("t.homePage.activityFeedEmptyHint");
  });

  it("empty state: alerts section uses EmptyState with i18n keys", () => {
    expect(home).toContain("t.homePage.alertsEmpty");
    expect(home).toContain("t.homePage.alertsEmptyHint");
  });

  it("error state: equipment fetch error shows ErrorCard with retry", () => {
    expect(home).toContain("equipmentError");
    expect(home).toContain("<ErrorCard");
    expect(home).toContain("onRetry");
  });

  it("no hardcoded empty-state prose strings remain in home.tsx", () => {
    expect(home).not.toContain("No recent activity");
    expect(home).not.toContain("No inventory alerts");
    expect(home).not.toContain("Scans, status changes, and moves show up here");
    expect(home).not.toContain("Sterilization, maintenance, and issues appear here");
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
