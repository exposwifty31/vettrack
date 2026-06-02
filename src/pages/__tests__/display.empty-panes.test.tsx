/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DisplaySnapshot } from "@/types";
import WardDisplayPage from "../display";

const emptySnapshot: DisplaySnapshot = {
  currentTime: "2026-05-28T12:00:00.000Z",
  currentShift: [{ employeeName: "Tech", role: "technician" }],
  hospitalizations: [],
  equipment: [
    {
      id: "eq-1",
      name: "Infusion pump",
      status: "ok",
      inUse: false,
      heldBy: null,
      lastCheckInAt: "2026-05-28T11:00:00.000Z",
      probableLocation: "ICU",
      isDeployable: true,
      custodyState: "docked",
      readinessState: "ready",
      usageState: "available",
    },
  ],
  upcomingTasks: [],
  overdueTasks: [],
  activeAlertCount: 0,
  totalOverdueCount: 0,
  crashCartStatus: null,
  codeBlueSession: null,
};

vi.mock("@/hooks/useDisplaySnapshot", () => ({
  useDisplaySnapshot: () => emptySnapshot,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({}),
}));

vi.mock("@/lib/realtime", () => ({
  connectRealtime: vi.fn(),
  disconnectRealtime: vi.fn(),
  EventIngestor: class {
    getLastAppliedEventId() {
      return null;
    }
    async replayHttpCatchUpAfter() {}
    dispose() {}
  },
  publishBuildTagGossip: vi.fn(),
  publishCodeBlueSeenGossip: vi.fn(),
}));

vi.mock("@/hooks/useKioskWakeLock", () => ({ useKioskWakeLock: vi.fn() }));
vi.mock("@/hooks/useDisplayHeartbeat", () => ({ useDisplayHeartbeat: vi.fn() }));
vi.mock("@/hooks/useRealtimeReconciliation", () => ({ useRealtimeReconciliation: vi.fn() }));
vi.mock("@/hooks/useCodeBlueKeepaliveReconciliation", () => ({
  useCodeBlueKeepaliveReconciliation: vi.fn(),
}));

describe("F1: Ward Display empty panes", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("F1: renders EquipmentPane without crash-cart pill, patient grid, or upcoming tasks", () => {
    render(<WardDisplayPage />);

    expect(screen.getByTestId("ward-display-equipment-pane")).toBeTruthy();
    expect(screen.getByText("Infusion pump")).toBeTruthy();
    expect(screen.getByTestId("ward-display-equipment-row-eq-1")).toBeTruthy();
    expect(screen.getByText("מוכן")).toBeTruthy();

    expect(screen.queryByTestId("ward-display-crash-cart-warning")).toBeNull();
    expect(screen.queryByTestId("ward-display-patient-grid")).toBeNull();
    expect(screen.queryByTestId("ward-display-upcoming-tasks")).toBeNull();
  });
});
