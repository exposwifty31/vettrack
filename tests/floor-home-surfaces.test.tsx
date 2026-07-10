/**
 * @vitest-environment happy-dom
 *
 * Phase 8 — floor surface smoke tests. Each archetype surface must render without
 * crashing off the shared cache-deduped floor engine, showing its distinctive
 * composition: the vet surface leads with the gated clinical actions, the student
 * surface leads with the guided banner (shown because authority is withheld), the
 * tech surface is the baseline read. The page shell (HomeShell) is stubbed to a
 * passthrough so these stay light — the shell's realtime/scan plumbing is exercised
 * elsewhere. `can()` is driven directly so the capability gates are asserted.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import type { Capability } from "@/lib/roles/experience-model";

const { equipmentList, equipmentMy, acksList, homeDashboard, tasksDashboard } = vi.hoisted(() => ({
  equipmentList: vi.fn(async () => [] as unknown[]),
  equipmentMy: vi.fn(async () => [] as unknown[]),
  acksList: vi.fn(async () => [] as unknown[]),
  homeDashboard: vi.fn(async () => ({ shift: null, nextShift: null, scansToday: 0 })),
  tasksDashboard: vi.fn(async () => ({ counts: { today: 0, overdue: 0 } })),
}));

vi.mock("@/lib/api", () => ({
  api: {
    equipment: { list: equipmentList, listMy: equipmentMy },
    alertAcks: { list: acksList },
    home: { dashboard: homeDashboard },
    tasks: { dashboard: tasksDashboard },
  },
}));
vi.mock("@/lib/auth-store", () => ({ getCurrentUserId: () => "u-1" }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ name: "Dana Cohen" }) }));
vi.mock("@/lib/scan-affordance", () => ({ useScanAffordance: () => "none" }));

// Controllable capability set — each test sets it before rendering.
let caps = new Set<Capability>();
vi.mock("@/hooks/use-experience", () => ({
  useExperience: () => ({ can: (c: Capability) => caps.has(c) }),
}));

// Passthrough shell — isolates the surface body from realtime/scanner plumbing.
vi.mock("@/features/today/surfaces/HomeShell", () => ({
  HomeShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  HomeChrome: () => null,
}));

import { VetHomeSurface } from "@/features/today/surfaces/VetHomeSurface";
import { TechHomeSurface } from "@/features/today/surfaces/TechHomeSurface";
import { StudentHomeSurface } from "@/features/today/surfaces/StudentHomeSurface";

function renderSurface(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    </HelmetProvider>,
  );
}

beforeEach(() => {
  caps = new Set<Capability>();
});
afterEach(() => cleanup());

describe("floor surfaces — per-archetype smoke", () => {
  it("TechHomeSurface renders the baseline floor read (tasks + my-equipment)", async () => {
    renderSurface(<TechHomeSurface isTablet={false} />);
    expect(await screen.findByText(t.homeSurface.tasks)).toBeTruthy();
    expect(screen.getByText(t.homeSurface.myEquipment)).toBeTruthy();
  });

  it("VetHomeSurface shows gated clinical actions when the vet caps are present", async () => {
    caps = new Set<Capability>(["codeBlue.manage", "equipment.vetActions", "shiftChat.pin"]);
    renderSurface(<VetHomeSurface isTablet={false} />);
    expect(await screen.findByText(t.homeSurface.clinicalActions)).toBeTruthy();
    expect(screen.getByText(t.homeSurface.clinicalReadiness)).toBeTruthy();
    // The vetActions-gated room-readiness row is present.
    expect(screen.getByText(t.homeSurface.roomReadinessHint)).toBeTruthy();
  });

  it("VetHomeSurface hides the clinical actions card when no clinical caps are held", async () => {
    caps = new Set<Capability>();
    renderSurface(<VetHomeSurface isTablet={false} />);
    // Readiness glance still renders; the gated action card does not.
    expect(await screen.findByText(t.homeSurface.clinicalReadiness)).toBeTruthy();
    expect(screen.queryByText(t.homeSurface.clinicalActions)).toBeNull();
  });

  it("StudentHomeSurface is custody-only: guided banner + inventory action, NO tasks", async () => {
    caps = new Set<Capability>(); // student base — no codeBlue.manage
    renderSurface(<StudentHomeSurface isTablet={false} />);
    expect(await screen.findByText(t.homeSurface.guidedTitle)).toBeTruthy();
    // Custody scope: the inventory (dispense/restock) action is present…
    expect(screen.getByText(t.homeSurface.inventoryActionHint)).toBeTruthy();
    // …and tasks are NOT (removed from the custody-only student surface).
    expect(screen.queryByText(t.homeSurface.tasks)).toBeNull();
  });

  it("StudentHomeSurface drops the guided banner once the withheld cap is earned (still custody-only)", async () => {
    caps = new Set<Capability>(["codeBlue.manage"]); // e.g. shift-elevated / secondary-admin
    renderSurface(<StudentHomeSurface isTablet={false} />);
    expect(await screen.findByText(t.homeSurface.inventoryActionHint)).toBeTruthy();
    expect(screen.queryByText(t.homeSurface.guidedTitle)).toBeNull();
    expect(screen.queryByText(t.homeSurface.tasks)).toBeNull();
  });
});
