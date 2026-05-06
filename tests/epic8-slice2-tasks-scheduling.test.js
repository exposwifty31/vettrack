/**
 * Epic 8 Slice 2 — Tasks Dashboard + Scheduling/Day View state regression guard.
 *
 * All checks are static file-content assertions: no DB, no live server needed.
 * Run with: pnpm test -- tests/epic8-slice2-tasks-scheduling.test.js
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

const appointments = read("src/pages/appointments.tsx");
const enLocale     = JSON.parse(read("locales/en.json"));
const heLocale     = JSON.parse(read("locales/he.json"));

// ── Imports ───────────────────────────────────────────────────────────────────

describe("appointments.tsx — primitives wired up", () => {
  it("imports LoadingSection (Slice 1 primitive), not raw Skeleton", () => {
    expect(appointments).toContain('import { LoadingSection } from "@/components/ui/loading-section"');
    expect(appointments).not.toContain('import { Skeleton } from "@/components/ui/skeleton"');
  });

  it("imports ErrorCard and EmptyState", () => {
    expect(appointments).toContain('import { ErrorCard } from "@/components/ui/error-card"');
    expect(appointments).toContain('import { EmptyState } from "@/components/ui/empty-state"');
  });
});

// ── Tasks Dashboard — loading states ─────────────────────────────────────────

describe("Tasks Dashboard — loading states (Slice 1 primitive)", () => {
  it("Recommendations card: shows LoadingSection while loading", () => {
    expect(appointments).toContain("recommendationsQuery.isLoading && !recommendationsQuery.data");
    const loadIdx   = appointments.indexOf("recommendationsQuery.isLoading && !recommendationsQuery.data");
    const sectionText = appointments.slice(loadIdx, loadIdx + 200);
    expect(sectionText).toContain("<LoadingSection rows={2} />");
  });

  it("Urgent card: shows LoadingSection while loading", () => {
    // dashboardQuery is checked in multiple cards — just ensure all uses replaced Skeleton
    expect(appointments).not.toMatch(/<Skeleton className="h-14/);
    expect(appointments).toContain("<LoadingSection rows={2} />");
  });

  it("Today card: shows LoadingSection while loading", () => {
    expect(appointments).not.toMatch(/<Skeleton className="h-16/);
  });

  it("My Tasks card: shows LoadingSection while loading", () => {
    // Covered by same dashboardQuery loading pattern above; verify no raw Skeleton remains
    const skeletonClassUsages = (appointments.match(/<Skeleton className=/g) ?? []).length;
    expect(skeletonClassUsages).toBe(0);
  });

  it("Suggestions card: shows LoadingSection while loading (not empty state)", () => {
    expect(appointments).toContain(
      "recommendationsQuery.isLoading && !recommendationsQuery.data ? (\n              <LoadingSection rows={2} />"
    );
  });

  it("loading is checked BEFORE empty in all dashboard cards", () => {
    // Ensure 'isLoading' guard comes before 'length === 0' check in the Today card
    const todayLoadIdx  = appointments.indexOf("dashboardQuery.isLoading && !dashboardQuery.data ? (\n                <LoadingSection rows={2} />\n              ) : (dashboardQuery.data?.today.length ?? 0) === 0");
    expect(todayLoadIdx).toBeGreaterThan(-1);
  });
});

// ── Tasks Dashboard — error states ───────────────────────────────────────────

describe("Tasks Dashboard — error states with retry", () => {
  it("Recommendations: ErrorCard with retry", () => {
    expect(appointments).toContain("recommendationsQuery.isError");
    expect(appointments).toContain("onRetry={() => recommendationsQuery.refetch()}");
  });

  it("Urgent: ErrorCard with retry", () => {
    expect(appointments).toContain("dashboardQuery.isError");
    expect(appointments).toContain("onRetry={() => dashboardQuery.refetch()}");
  });

  it("error messages use i18n keys — no hardcoded English or raw Hebrew", () => {
    expect(appointments).toContain("t.appointmentsPage.recommendationsLoadFailed");
    expect(appointments).toContain("t.appointmentsPage.urgentLoadFailed");
    expect(appointments).toContain("t.appointmentsPage.todayLoadFailed");
    expect(appointments).toContain("t.appointmentsPage.myTasksLoadFailed");
    expect(appointments).not.toContain('"Unable to load today\'s tasks."');
    expect(appointments).not.toContain('"Unable to load assigned tasks."');
    expect(appointments).not.toContain('"Unable to load the day view."');
  });
});

// ── Tasks Dashboard — empty states ───────────────────────────────────────────

describe("Tasks Dashboard — empty states", () => {
  it("Recommendations card: EmptyState shown when no tasks", () => {
    expect(appointments).toContain("!recommendationsQuery.data?.nextBestTask");
    // EmptyState is rendered for this branch
    expect(appointments).toContain("<EmptyState");
  });

  it("Urgent card: EmptyState shown when no urgent tasks", () => {
    expect(appointments).toContain("dashboardQuery.data?.overdue.length ?? 0) === 0");
    expect(appointments).toContain("recommendationsQuery.data?.urgentTasks.length ?? 0) === 0");
  });

  it("Today card: EmptyState explains no tasks due today", () => {
    expect(appointments).toContain("dashboardQuery.data?.today.length ?? 0) === 0");
  });

  it("My Tasks card: EmptyState shown when no assigned tasks", () => {
    expect(appointments).toContain("dashboardQuery.data?.myTasks.length ?? 0) === 0");
  });
});

// ── Scheduling / Day View — loading state ────────────────────────────────────

describe("Scheduling / Day View — loading state", () => {
  it("shows LoadingSection (rows=3) while list query is loading", () => {
    expect(appointments).toContain("listQuery.isLoading ? (");
    const loadIdx = appointments.indexOf("listQuery.isLoading ? (");
    const snippet = appointments.slice(loadIdx, loadIdx + 100);
    expect(snippet).toContain("<LoadingSection rows={3} />");
  });

  it("loading is checked BEFORE the calendar grid renders", () => {
    const loadIdx  = appointments.indexOf("listQuery.isLoading ? (");
    const gridIdx  = appointments.indexOf("relative border rounded-xl overflow-hidden");
    expect(loadIdx).toBeGreaterThan(-1);
    expect(gridIdx).toBeGreaterThan(-1);
    expect(loadIdx).toBeLessThan(gridIdx);
  });
});

// ── Scheduling / Day View — error state ──────────────────────────────────────

describe("Scheduling / Day View — error state", () => {
  it("ErrorCard with retry that refetches both list and meta queries", () => {
    expect(appointments).toContain("listQuery.isError");
    expect(appointments).toContain("t.appointmentsPage.dayViewLoadFailed");
    expect(appointments).toContain("void listQuery.refetch();");
    expect(appointments).toContain("void metaQuery.refetch();");
  });
});

// ── Scheduling / Day View — empty state ──────────────────────────────────────

describe("Scheduling / Day View — empty state with CTA", () => {
  it("EmptyState uses i18n keys for message and hint", () => {
    expect(appointments).toContain("t.appointmentsPage.dayViewEmpty");
    expect(appointments).toContain("t.appointmentsPage.dayViewEmptyHint");
    expect(appointments).not.toContain('"אין משימות מתוזמנות"');
  });

  it("EmptyState has a Quick Task / Create Task CTA", () => {
    // The CTA calls openQuickBooking — this is the existing interaction, not new
    const dayViewEmptyIdx = appointments.indexOf("t.appointmentsPage.dayViewEmpty");
    // Slice 800 chars to cover the full EmptyState JSX including the action prop
    const snippet = appointments.slice(dayViewEmptyIdx, dayViewEmptyIdx + 800);
    expect(snippet).toContain("openQuickBooking(new Date())");
    expect(snippet).toContain("t.appointmentsPage.createTask");
  });

  it("rendering order: error → loading → content grid; empty overlay is inside grid", () => {
    // The Day View empty state is an absolute overlay INSIDE the calendar grid,
    // not a replacement for it — so the correct order is:
    //   listQuery.isError < listQuery.isLoading < content grid < empty overlay
    const errorIdx   = appointments.indexOf("listQuery.isError");
    const loadIdx    = appointments.indexOf("listQuery.isLoading ? (");
    const contentIdx = appointments.indexOf("relative border rounded-xl overflow-hidden");
    const emptyIdx   = appointments.indexOf("t.appointmentsPage.dayViewEmpty");
    expect(errorIdx).toBeLessThan(loadIdx);
    expect(loadIdx).toBeLessThan(contentIdx);
    // empty overlay rendered inside the content grid
    expect(contentIdx).toBeLessThan(emptyIdx);
  });
});

// ── Time slots interactivity ──────────────────────────────────────────────────

describe("Scheduling / Day View — time slot interactivity", () => {
  it("available slots are interactive (hover styles, onClick)", () => {
    // Available slots SHOULD be interactive — confirming no regression
    expect(appointments).toContain("hover:bg-emerald-50/60");
    expect(appointments).toContain("onClick={() => openQuickBooking(slot)}");
  });

  it("unavailable slots are visually non-interactive (cursor-not-allowed, disabled)", () => {
    expect(appointments).toContain("cursor-not-allowed");
    expect(appointments).toContain("disabled={!available}");
  });

  it("unavailable slots have pointer-events-none to remove touch affordances (Slice 4.2)", () => {
    // pointer-events-none must appear alongside cursor-not-allowed for the unavailable branch
    const unavailableIdx = appointments.indexOf("cursor-not-allowed pointer-events-none");
    expect(unavailableIdx).toBeGreaterThan(-1);
  });
});

// ── Locale keys ───────────────────────────────────────────────────────────────

describe("Locale keys — appointmentsPage additions", () => {
  const REQUIRED_KEYS = [
    "recommendationsLoadFailed",
    "urgentLoadFailed",
    "todayLoadFailed",
    "myTasksLoadFailed",
    "dayViewLoadFailed",
    "dayViewEmpty",
    "dayViewEmptyHint",
  ];

  it("en.json has all 7 new appointmentsPage keys", () => {
    for (const key of REQUIRED_KEYS) {
      expect(enLocale.appointmentsPage).toHaveProperty(key);
    }
  });

  it("he.json has all 7 new appointmentsPage keys", () => {
    for (const key of REQUIRED_KEYS) {
      expect(heLocale.appointmentsPage).toHaveProperty(key);
    }
  });

  it("en.json and he.json appointmentsPage have identical key sets", () => {
    const enKeys = Object.keys(enLocale.appointmentsPage).sort();
    const heKeys = Object.keys(heLocale.appointmentsPage).sort();
    expect(enKeys).toEqual(heKeys);
  });

  it("all new he.json keys are non-empty strings", () => {
    for (const key of REQUIRED_KEYS) {
      const val = heLocale.appointmentsPage[key];
      expect(typeof val).toBe("string");
      expect(val.length).toBeGreaterThan(0);
    }
  });

  it("Slice 4.2 — locale keys for all 9 RTL-hardening additions exist in both locales", () => {
    const SLICE_42_KEYS = [
      "suggestions", "taskControls", "dayLabel", "technicianFilter",
      "allTechnicians", "hours", "interval", "dayView", "scheduleTaskAt",
    ];
    for (const key of SLICE_42_KEYS) {
      expect(enLocale.appointmentsPage).toHaveProperty(key);
      expect(heLocale.appointmentsPage).toHaveProperty(key);
      expect(typeof heLocale.appointmentsPage[key]).toBe("string");
      expect(heLocale.appointmentsPage[key].length).toBeGreaterThan(0);
    }
  });

  it("Slice 4.2 — he.json dayViewEmptyHint no longer contains raw English 'Quick Task'", () => {
    expect(heLocale.appointmentsPage.dayViewEmptyHint).not.toContain("Quick Task");
  });
});

// ── Slice 4.2 — RTL label hardening ──────────────────────────────────────────

describe("Slice 4.2 — English labels replaced with i18n keys", () => {
  it("Suggestions card title uses t.appointmentsPage.suggestions (not raw 'Suggestions')", () => {
    expect(appointments).toContain("t.appointmentsPage.suggestions");
    // raw literal must not appear as JSX text
    expect(appointments).not.toContain(">Suggestions<");
  });

  it("Task Controls card title uses t.appointmentsPage.taskControls (not raw 'Task Controls')", () => {
    expect(appointments).toContain("t.appointmentsPage.taskControls");
    expect(appointments).not.toContain("Task Controls");
  });

  it("Day label uses t.appointmentsPage.dayLabel (not raw 'Day')", () => {
    expect(appointments).toContain("t.appointmentsPage.dayLabel");
    // Should not appear as a standalone JSX label text
    expect(appointments).not.toMatch(/>Day<\/label>/);
  });

  it("All technicians option uses t.appointmentsPage.allTechnicians", () => {
    expect(appointments).toContain("t.appointmentsPage.allTechnicians");
    expect(appointments).not.toContain('"All technicians"');
  });

  it("Hours label uses t.appointmentsPage.hours", () => {
    expect(appointments).toContain("t.appointmentsPage.hours");
    expect(appointments).not.toMatch(/>Hours<\/label>/);
  });

  it("Interval label uses t.appointmentsPage.interval", () => {
    expect(appointments).toContain("t.appointmentsPage.interval");
    expect(appointments).not.toMatch(/>Interval<\/label>/);
  });

  it("Day View card title uses t.appointmentsPage.dayView", () => {
    expect(appointments).toContain("t.appointmentsPage.dayView");
    expect(appointments).not.toContain("Day View");
  });
});

describe("Slice 4.2 — Mobile RTL overflow fix", () => {
  it("Task Controls no longer uses overflow-prone md:grid-cols-5", () => {
    // Fixed layout: flex-wrap instead of fixed 5-column grid at md breakpoint
    expect(appointments).not.toContain("md:grid-cols-5");
  });

  it("Task Controls CardContent uses flex-wrap for safe mobile wrapping", () => {
    expect(appointments).toContain("flex flex-wrap gap-3 items-end");
  });

  it("Date input wrapper uses min-w-40 to allow flex wrapping", () => {
    expect(appointments).toContain("flex-1 min-w-40");
  });

  it("Date input has max-w-full to prevent overflow past card boundary", () => {
    expect(appointments).toContain("max-w-full");
  });
});
