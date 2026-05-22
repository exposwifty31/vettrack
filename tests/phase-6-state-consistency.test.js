import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const repoRoot = path.resolve(__dirname, "..");
const appointments = fs.readFileSync(path.join(repoRoot, "src", "pages", "appointments.tsx"), "utf8");
const settings = fs.readFileSync(path.join(repoRoot, "src", "pages", "settings.tsx"), "utf8");
const equipmentList = fs.readFileSync(path.join(repoRoot, "src", "pages", "equipment-list.tsx"), "utf8");
const alerts = fs.readFileSync(path.join(repoRoot, "src", "pages", "alerts.tsx"), "utf8");
const home = fs.readFileSync(path.join(repoRoot, "src", "pages", "home.tsx"), "utf8");
const loadingSection = fs.readFileSync(path.join(repoRoot, "src", "components", "ui", "loading-section.tsx"), "utf8");

describe("Wave 6 state consistency checks (static)", () => {
  it("Appointments page uses explicit shared loading/error/empty states", () => {
    expect(
      appointments.includes("import { ErrorCard } from \"@/components/ui/error-card\";") &&
        appointments.includes("import { EmptyState } from \"@/components/ui/empty-state\";") &&
        appointments.includes("import { LoadingSection } from \"@/components/ui/loading-section\";") &&
        appointments.includes("recommendationsQuery.isError") &&
        appointments.includes("dashboardQuery.isError") &&
        appointments.includes("listQuery.isError") &&
        appointments.includes("<EmptyState") &&
        appointments.includes("listQuery.isLoading ? (") &&
        appointments.includes("<LoadingSection rows={3} />"),
    ).toBe(true);
  });

  it("Settings page includes auth loading and error state gates", () => {
    expect(
      settings.includes("const { name, email, signOut, effectiveRole, role, isLoaded, isSignedIn } = useAuth();") &&
        settings.includes("if (!isLoaded)") &&
        settings.includes("<Skeleton") &&
        settings.includes("if (!isSignedIn)") &&
        settings.includes("<ErrorCard") &&
        settings.includes("onRetry={() => safeReloadPage()}"),
    ).toBe(true);
  });

  it("Equipment list uses shared loading/error/empty components", () => {
    expect(
      equipmentList.includes("import { ErrorCard } from \"@/components/ui/error-card\";") &&
        equipmentList.includes("import { EmptyState } from \"@/components/ui/empty-state\";") &&
        equipmentList.includes("EquipmentListSkeleton") &&
        equipmentList.includes("onRetry={() => refetchAll()}"),
    ).toBe(true);
  });

  it("Alerts page uses shared loading/error/empty components", () => {
    expect(
      alerts.includes("import { ErrorCard } from \"@/components/ui/error-card\";") &&
        alerts.includes("import { EmptyState } from \"@/components/ui/empty-state\";") &&
        alerts.includes("SkeletonAlertCard") &&
        alerts.includes("onRetry={() => {") &&
        alerts.includes("refetchEq();") &&
        alerts.includes("refetchAcks();"),
    ).toBe(true);
  });

  it("Priority pages use skeleton-based loading states", () => {
    expect(
      appointments.includes("import { LoadingSection } from \"@/components/ui/loading-section\";") &&
        settings.includes("import { Skeleton } from \"@/components/ui/skeleton\";") &&
        equipmentList.includes("EquipmentListSkeleton") &&
        alerts.includes("SkeletonAlertCard"),
    ).toBe(true);
  });

  it("Appointments error states provide consistent retry affordances", () => {
    expect(
      appointments.includes("onRetry={() => recommendationsQuery.refetch()}") &&
        appointments.includes("onRetry={() => dashboardQuery.refetch()}") &&
        appointments.includes("void listQuery.refetch();") &&
        appointments.includes("void metaQuery.refetch();"),
    ).toBe(true);
  });

  it("Appointments empty states provide actionable CTA affordances", () => {
    expect(
      appointments.includes("onClick={() => openQuickBooking(new Date())}") &&
        appointments.includes("onClick={() => myTasksRef.current?.scrollIntoView({ behavior: \"smooth\", block: \"start\" })}") &&
        appointments.includes("onClick={() => urgentRef.current?.scrollIntoView({ behavior: \"smooth\", block: \"start\" })}"),
    ).toBe(true);
  });

  it("Equipment list empty states provide actionable CTA affordances", () => {
    expect(
      equipmentList.includes("action={") &&
        equipmentList.includes("onClick={() => navigate(\"/equipment\", { replace: true })}") &&
        equipmentList.includes("<Link href=\"/equipment/new\">"),
    ).toBe(true);
  });

  it("Alerts empty state provides actionable CTA affordance", () => {
    expect(
      alerts.includes("action={") &&
        alerts.includes("<Link href=\"/equipment\">") &&
        alerts.includes("t.alertsPage.browseEquipment"),
    ).toBe(true);
  });

  // Epic 8 Slice 1 — Loading/Error/Empty primitives
  it("LoadingSection component uses role=status and aria-busy for accessibility", () => {
    expect(
      loadingSection.includes('role="status"') &&
        loadingSection.includes('aria-busy="true"') &&
        loadingSection.includes("t.common.loading"),
    ).toBe(true);
  });

  it("Equipment list desktop view uses skeleton loading instead of hardcoded text", () => {
    expect(
      equipmentList.includes("import { LoadingSection }") &&
        equipmentList.includes("<LoadingSection rows={5} />") &&
        !equipmentList.includes("טוען..."),
    ).toBe(true);
  });

  it("Home page activity feed shows LoadingSection while loading, not blank", () => {
    expect(
      home.includes("isLoading: activityLoading") &&
        home.includes("activityLoading ? (") &&
        home.includes("<LoadingSection rows={4} />"),
    ).toBe(true);
  });

  it("Home page next-up task card shows a loading state while tasks fetch, not blank", () => {
    expect(home.includes("tasksLoading")).toBe(true);
  });

  it("Home page uses shared EmptyState component for the activity empty state", () => {
    expect(
      home.includes("import { EmptyState }") &&
        home.includes("t.homePage.activityFeedEmpty") &&
        home.includes("t.homePage.activityFeedEmptyHint"),
    ).toBe(true);
  });
});
