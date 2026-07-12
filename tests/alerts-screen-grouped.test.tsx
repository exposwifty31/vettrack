/**
 * @vitest-environment happy-dom
 *
 * H2 (UX audit, alert fatigue) — the native /alerts screen used to render a
 * flat, non-interactive wall of raw alerts (no grouping, no ack, no
 * navigation) while the grouped AlertsProView existed one import away. These
 * tests lock the rewired native screen: grouped worst-first rendering, row →
 * equipment navigation, and take-ownership posting through the shared
 * useAlertsController.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";
import type { Equipment } from "@/types";
import { AlertsScreen } from "@/features/alerts";

const { equipmentList, acksList, ackSpy, removeSpy } = vi.hoisted(() => {
  const fixture = [
    // status "issue" → urgent section + worst-first hero
    { id: "eq-issue", name: "Ventilator ICU-2", status: "issue" },
    // no lastSeen → isInactive → maintenance section
    { id: "eq-stale", name: "Syringe pump 7", status: "available" },
  ];
  return {
    equipmentList: vi.fn(async () => fixture as unknown as Equipment[]),
    acksList: vi.fn(async () => []),
    ackSpy: vi.fn(async () => ({})),
    removeSpy: vi.fn(async () => ({})),
  };
});

vi.mock("@/lib/api", () => ({
  api: {
    equipment: { list: equipmentList },
    alertAcks: { list: acksList, acknowledge: ackSpy, remove: removeSpy },
  },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ userId: "u-admin", effectiveRole: "admin", role: "admin" }),
}));

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AlertsScreen />
    </QueryClientProvider>,
  );
}

describe("AlertsScreen — H2 grouped, navigable, acknowledgeable", () => {
  afterEach(() => {
    cleanup();
    ackSpy.mockClear();
    window.history.pushState({}, "", "/alerts");
  });

  it("renders the grouped pro view with a worst-first hero", async () => {
    renderScreen();
    expect(await screen.findByTestId("alerts-worst-first")).toBeTruthy();
    expect(screen.getByText(t.alertsPage.sectionUrgent)).toBeTruthy();
    expect(screen.getByText(t.alertsPage.sectionMaintenance)).toBeTruthy();
  });

  it("rows navigate to the equipment detail", async () => {
    renderScreen();
    fireEvent.click(await screen.findByTestId("alert-navigate-eq-stale"));
    expect(window.location.pathname).toBe("/equipment/eq-stale");
  });

  it("take-ownership posts an acknowledgement", async () => {
    renderScreen();
    fireEvent.click(await screen.findByTestId("btn-ack-eq-issue"));
    await waitFor(() => expect(ackSpy).toHaveBeenCalledWith("eq-issue", "issue"));
  });
});

describe("AlertsScreen — claim chip renders displayName, never the email (T13 privacy fix)", () => {
  afterEach(() => {
    cleanup();
    window.history.pushState({}, "", "/alerts");
  });

  it("shows the acknowledger's display name, not their email or its local-part", async () => {
    acksList.mockResolvedValueOnce([
      {
        id: "ack-1",
        equipmentId: "eq-issue",
        alertType: "issue",
        acknowledgedById: "u-dana",
        acknowledgedByEmail: "danerez5@gmail.com",
        acknowledgedByDisplayName: "Dana Cohen",
        acknowledgedAt: new Date().toISOString(),
      },
    ]);
    renderScreen();
    expect(await screen.findByText(/Dana Cohen/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("danerez5");
    expect(document.body.textContent).not.toContain("@gmail.com");
  });

  it("falls back to a neutral label — never the email — when no display name is available", async () => {
    acksList.mockResolvedValueOnce([
      {
        id: "ack-2",
        equipmentId: "eq-stale",
        alertType: "inactive",
        acknowledgedById: "u-ghost",
        acknowledgedByEmail: "ghost@clinic.test",
        acknowledgedByDisplayName: null,
        acknowledgedAt: new Date().toISOString(),
      },
    ]);
    renderScreen();
    expect(await screen.findByText(new RegExp(t.appointmentsPage.unknownUser))).toBeTruthy();
    expect(document.body.textContent).not.toContain("ghost");
    expect(document.body.textContent).not.toContain("@clinic.test");
  });
});
