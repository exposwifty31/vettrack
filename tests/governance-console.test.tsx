/**
 * @vitest-environment happy-dom
 *
 * 7c Equipment Governance console — surfaces the clinic readiness policy from the
 * existing vt_equipment_readiness_config and allows a guarded write of
 * staleEvidenceMs (entered in whole hours). Covers gating, the ms→hours read
 * display + per-type minimums, the fetch-failure branch, and the full edit→save
 * path (plain number Input, so happy-dom drives it end-to-end unlike Radix Select).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { t } from "@/lib/i18n";

const mockCan = vi.fn<(cap: string) => boolean>();
vi.mock("@/hooks/use-experience", () => ({
  useExperience: () => ({ archetype: "admin", capabilities: new Set(), can: mockCan }),
}));
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const getMock = vi.fn();
const updateMock = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    equipmentGovernance: {
      getReadinessRules: (...a: unknown[]) => getMock(...a),
      updateReadinessRules: (...a: unknown[]) => updateMock(...a),
    },
  },
}));

import GovernanceConsolePage from "@/pages/console/GovernanceConsolePage";

const RULES = { version: 1 as const, staleEvidenceMs: 86_400_000, minimumReadyByType: { infusion_pump: 2 } };
const GET_RESPONSE = { clinicId: "c1", rules: RULES, updatedAt: "2026-07-01T00:00:00.000Z" };

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const { hook } = memoryLocation({ path: "/admin/governance" });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={hook}>
        <GovernanceConsolePage />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockCan.mockReset();
  getMock.mockReset();
  updateMock.mockReset();
});
afterEach(() => cleanup());

describe("GovernanceConsolePage — capability gating", () => {
  it("shows the pending-server state and does not fetch without management.webWrite", () => {
    mockCan.mockReturnValue(false);
    renderPage();
    expect(screen.getByText(t.console.accessPendingServer)).toBeTruthy();
    expect(getMock).not.toHaveBeenCalled();
  });

  it("renders the readiness policy and per-type minimums", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    getMock.mockResolvedValue(GET_RESPONSE);
    renderPage();
    // per-type minimum row from minimumReadyByType
    expect(await screen.findByText("infusion_pump")).toBeTruthy();
    expect(screen.getByText(t.console.governance.minimumReadyTitle)).toBeTruthy();
  });

  it("keeps the chrome and shows the error branch when the fetch fails", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    getMock.mockRejectedValue(new Error("gov boom"));
    renderPage();
    expect(screen.getByText(t.console.governance.title)).toBeTruthy();
    expect(await screen.findByText(t.console.state.error)).toBeTruthy();
  });
});

describe("GovernanceConsolePage — guarded edit", () => {
  beforeEach(() => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    getMock.mockResolvedValue(GET_RESPONSE);
  });

  it("opens the edit drawer with hours prefilled and Save disabled (unchanged)", async () => {
    renderPage();
    fireEvent.click(await screen.findByText(t.console.governance.edit));
    expect(await screen.findByText(t.console.governance.editTitle)).toBeTruthy();
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("24"); // 86_400_000ms → 24h
    const save = screen.getByRole("button", { name: t.console.governance.save }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("saves the changed window as milliseconds", async () => {
    renderPage();
    fireEvent.click(await screen.findByText(t.console.governance.edit));
    const input = (await screen.findByRole("spinbutton")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "48" } });
    const save = screen.getByRole("button", { name: t.console.governance.save }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    updateMock.mockResolvedValue({ clinicId: "c1", rules: { ...RULES, staleEvidenceMs: 172_800_000 } });
    fireEvent.click(save);
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ staleEvidenceMs: 172_800_000 }));
  });
});
