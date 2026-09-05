/**
 * @vitest-environment happy-dom
 *
 * Track A / Phase 2 — `/dashboard` critical-alerts section serves the dense
 * `CriticalAlertsTable` at lg+ and keeps the card row stack below it.
 *
 * NOTE: happy-dom's viewport is exactly 1024px, so `useIsDesktop()` is TRUE unless
 * mocked — this file sets it explicitly in every case.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import React from "react";

const mockIsDesktop = vi.fn<() => boolean>();
vi.mock("@/hooks/use-is-desktop", () => ({ useIsDesktop: () => mockIsDesktop() }));

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ isAdmin: true, userId: "u1" }) }));
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
vi.mock("react-helmet-async", () => ({ Helmet: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/equipment-recovery-ui-flag", () => ({ isEquipmentRecoveryUiEnabled: false }));

// One faulty item → exactly one critical row, via the real computeDashboardData.
const { EQUIPMENT } = vi.hoisted(() => ({
  EQUIPMENT: [
    {
      id: "e1",
      name: "Ultrasound A",
      status: "issue",
      location: "ICU 1",
      lastSeen: new Date().toISOString(),
      createdAt: "2026-08-01T00:00:00.000Z",
    },
  ],
}));
vi.mock("@/lib/api", () => ({ api: { equipment: { list: vi.fn(async () => EQUIPMENT) } } }));

import ManagementDashboardPage from "@/pages/management-dashboard";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={memoryLocation({ path: "/dashboard" }).hook}>
        <ManagementDashboardPage />
      </Router>
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

describe("/dashboard critical alerts — desktop table vs narrow card rows", () => {
  it("renders the dense table on desktop", async () => {
    mockIsDesktop.mockReturnValue(true);
    renderPage();

    await waitFor(() => expect(screen.getByTestId("critical-row-e1")).toBeTruthy());
    expect(document.querySelector("table")).toBeTruthy();
  });

  it("renders the card rows and no table below the desktop breakpoint", async () => {
    mockIsDesktop.mockReturnValue(false);
    renderPage();

    await waitFor(() => expect(screen.getByText("Ultrasound A")).toBeTruthy());
    expect(document.querySelector("table")).toBeNull();
    expect(screen.queryByTestId("critical-row-e1")).toBeNull();
  });

  it("leaves the grouped sections alone in both bodies", async () => {
    mockIsDesktop.mockReturnValue(true);
    renderPage();

    await waitFor(() => expect(screen.getByTestId("section-who-has-what")).toBeTruthy());
    expect(screen.getByTestId("section-location-overview")).toBeTruthy();
  });
});
