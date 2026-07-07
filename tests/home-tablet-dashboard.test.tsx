/**
 * @vitest-environment happy-dom
 *
 * M3 (UX audit) — on iPad the phone Home rendered capped at 720px: greeting,
 * one card, empty space. These tests lock the tablet dashboard composition:
 * the four bento tiles render from the existing data paths, the availability
 * figure derives from the triage tier, alert rows navigate to the device, and
 * room bars sort worst-first. The phone/desktop page keeps its own component
 * (fork contract asserted statically).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync } from "fs";
import { resolve } from "path";
import { t } from "@/lib/i18n";
import type { Equipment, Room } from "@/types";
import { HomeTabletDashboard } from "@/features/today/HomeTabletDashboard";

const { equipmentList, acksList, homeDashboard, roomsList } = vi.hoisted(() => {
  const equipment = [
    // status "issue" → attention tier + urgent alert
    { id: "eq-issue", name: "Ventilator ICU-2", status: "issue" },
    // never scanned → isInactive → not-verified readout
    { id: "eq-a", name: "Syringe pump 7", status: "ok" },
    { id: "eq-b", name: "Infusion pump 3", status: "ok" },
  ];
  const rooms = [
    { id: "room-full", name: "Surgery 1", totalEquipment: 4, recentlyVerifiedCount: 4 },
    { id: "room-half", name: "ICU", totalEquipment: 2, recentlyVerifiedCount: 1 },
  ];
  return {
    equipmentList: vi.fn(async () => equipment as unknown as Equipment[]),
    acksList: vi.fn(async () => []),
    homeDashboard: vi.fn(async () => ({ shift: null, nextShift: null, scansToday: 0 })),
    roomsList: vi.fn(async () => rooms as unknown as Room[]),
  };
});

vi.mock("@/lib/api", () => ({
  api: {
    equipment: { list: equipmentList },
    alertAcks: { list: acksList, acknowledge: vi.fn(), remove: vi.fn() },
    home: { dashboard: homeDashboard },
    rooms: { list: roomsList },
  },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ name: "Dana Cohen", userId: "u-1", effectiveRole: "admin", role: "admin" }),
}));

vi.mock("@/lib/auth-store", () => ({ getCurrentUserId: () => "u-1" }));

vi.mock("@/lib/realtime", () => ({ subscribeKeepalive: () => () => {} }));

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={client}>
        <HomeTabletDashboard />
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

describe("HomeTabletDashboard — M3 iPad bento", () => {
  afterEach(() => {
    cleanup();
    window.history.pushState({}, "", "/home");
  });

  it("renders all four tiles", async () => {
    renderDashboard();
    expect(await screen.findByTestId("tablet-tile-equipment")).toBeTruthy();
    expect(screen.getByTestId("tablet-tile-alerts")).toBeTruthy();
    expect(screen.getByTestId("tablet-tile-rooms")).toBeTruthy();
    // Shift hero (no roster shift in fixture) shows the no-shift state.
    expect(await screen.findByText(t.home.shift.noShift)).toBeTruthy();
  });

  it("derives availability from the triage tier (1 attention of 3 → 67%)", async () => {
    renderDashboard();
    // findByText waits out the loading placeholder ("—").
    expect(await screen.findByText("67%")).toBeTruthy();
    expect(screen.getByTestId("tablet-equipment-availability").textContent).toBe("67%");
  });

  it("shows the Phase-2 not-verified readout from the same isInactive predicate", async () => {
    renderDashboard();
    // All three fixtures have no scan timestamps → all not-verified.
    expect(await screen.findByText(t.equipmentList.verifiedSplit(0, 3, 14))).toBeTruthy();
  });

  it("alert rows navigate to the equipment detail", async () => {
    renderDashboard();
    fireEvent.click(await screen.findByText("Ventilator ICU-2"));
    expect(window.location.pathname).toBe("/equipment/eq-issue");
  });

  it("room bars sort worst-first with pct labels", async () => {
    renderDashboard();
    expect(await screen.findByText("50%")).toBeTruthy();
    const text = screen.getByTestId("tablet-tile-rooms").textContent ?? "";
    // ICU (50%) must precede Surgery 1 (100%).
    expect(text.indexOf("ICU")).toBeGreaterThan(-1);
    expect(text.indexOf("ICU")).toBeLessThan(text.indexOf("Surgery 1"));
  });
});

describe("HomePage fork", () => {
  it("home.tsx forks on homeSurface + useIsNativeTablet at the component level", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/home.tsx"), "utf-8");
    // Phase 3 (A2): the fork now selects by homeSurface (ops/floor) THEN tablet.
    // Both hooks are called unconditionally before the nested-ternary component
    // selection (no early return / post-branch hook) — the M3 invariant.
    expect(source).toContain("useIsNativeTablet()");
    expect(source).toContain("useExperience()");
    expect(source).toContain("homeSurface");
    expect(source).toContain("<HomeTabletDashboard />");
    expect(source).toContain("<OpsHomeSurface />");
    expect(source).toContain("<FloorHomeSurface isTablet={isNativeTablet} />");
  });
});
