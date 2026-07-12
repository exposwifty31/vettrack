/**
 * @vitest-environment happy-dom
 *
 * T-27b — mechanical fan-out. `StartOfShiftCard` (T-27a) must mount on every
 * role home surface. `FloorHomeSurface` has no body of its own — it only
 * dispatches to Vet/Tech/Student (see FloorHomeSurface.tsx) — so it is covered
 * TRANSITIVELY by those three mounts rather than a redundant fourth mount;
 * this suite asserts that transitive coverage directly instead of re-mounting.
 * Each surface's existing home-engine query mocks (same pattern as
 * tests/floor-home-surfaces.test.tsx / tests/home-tablet-dashboard.test.tsx)
 * are reused so no new fetch is introduced.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import type { Capability } from "@/lib/roles/experience-model";

const { equipmentList, equipmentMy, acksList, acksAck, acksRemove, homeDashboard, tasksDashboard, roomsList, activityFeed } =
  vi.hoisted(() => ({
    equipmentList: vi.fn(async () => [] as unknown[]),
    equipmentMy: vi.fn(async () => [] as unknown[]),
    acksList: vi.fn(async () => [] as unknown[]),
    acksAck: vi.fn(async () => ({})),
    acksRemove: vi.fn(async () => ({})),
    // A real, in-progress shift so every surface's StartOfShiftCard renders its
    // on-shift (non-idle) branch — the variant threading is only observable there.
    homeDashboard: vi.fn(async () => ({
      shift: {
        startedAt: new Date(Date.now() - 3_600_000).toISOString(),
        endsAt: new Date(Date.now() + 3_600_000).toISOString(),
        role: "technician",
      },
      nextShift: null,
      scansToday: 3,
    })),
    tasksDashboard: vi.fn(async () => ({ counts: { today: 0, overdue: 0 } })),
    roomsList: vi.fn(async () => [] as unknown[]),
    activityFeed: vi.fn(async () => ({ items: [] as unknown[] })),
  }));

vi.mock("@/lib/api", () => ({
  api: {
    equipment: { list: equipmentList, listMy: equipmentMy },
    alertAcks: { list: acksList, acknowledge: acksAck, remove: acksRemove },
    home: { dashboard: homeDashboard },
    tasks: { dashboard: tasksDashboard },
    rooms: { list: roomsList },
    activity: { feed: activityFeed },
  },
}));
vi.mock("@/lib/auth-store", () => ({ getCurrentUserId: () => "u-1" }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ name: "Dana Cohen", userId: "u-1", effectiveRole: "admin", role: "admin" }),
}));
vi.mock("@/lib/scan-affordance", () => ({ useScanAffordance: () => "none" }));
vi.mock("@/hooks/use-is-desktop", () => ({ useIsDesktop: () => false }));

let caps = new Set<Capability>();
let archetype: "admin" | "lead" | "vet" | "tech" | "student" = "tech";
vi.mock("@/hooks/use-experience", () => ({
  useExperience: () => ({ can: (c: Capability) => caps.has(c), archetype }),
}));

// Passthrough shell — isolates each surface body from realtime/scanner plumbing
// (same isolation floor-home-surfaces.test.tsx uses).
vi.mock("@/features/today/surfaces/HomeShell", () => ({
  HomeShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  HomeChrome: () => null,
}));

import { OpsHomeSurface } from "@/features/today/surfaces/OpsHomeSurface";
import { VetHomeSurface } from "@/features/today/surfaces/VetHomeSurface";
import { TechHomeSurface } from "@/features/today/surfaces/TechHomeSurface";
import { StudentHomeSurface } from "@/features/today/surfaces/StudentHomeSurface";
import { FloorHomeSurface } from "@/features/today/surfaces/FloorHomeSurface";

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
  archetype = "tech";
});
afterEach(() => cleanup());

describe("StartOfShiftCard mounted on every role home surface (T-27b)", () => {
  it("OpsHomeSurface (admin/lead) mounts the card", async () => {
    archetype = "admin";
    caps = new Set<Capability>(["management.web"]);
    renderSurface(<OpsHomeSurface />);
    expect(await screen.findByTestId("start-of-shift-card")).toBeTruthy();
  });

  it("VetHomeSurface mounts the card", async () => {
    archetype = "vet";
    caps = new Set<Capability>(["codeBlue.manage", "equipment.vetActions"]);
    renderSurface(<VetHomeSurface isTablet={false} />);
    expect(await screen.findByTestId("start-of-shift-card")).toBeTruthy();
  });

  it("TechHomeSurface mounts the card", async () => {
    archetype = "tech";
    caps = new Set<Capability>(["codeBlue.manage"]);
    renderSurface(<TechHomeSurface isTablet={false} />);
    expect(await screen.findByTestId("start-of-shift-card")).toBeTruthy();
  });

  it("StudentHomeSurface mounts the card", async () => {
    archetype = "student";
    caps = new Set<Capability>();
    renderSurface(<StudentHomeSurface isTablet={false} />);
    expect(await screen.findByTestId("start-of-shift-card")).toBeTruthy();
  });

  it("FloorHomeSurface has no mount of its own — it dispatches to Vet/Tech/Student, each of which already mounts the card, so the card is present via that transitive coverage", async () => {
    archetype = "student";
    caps = new Set<Capability>();
    renderSurface(<FloorHomeSurface isTablet={false} />);
    expect(await screen.findByTestId("start-of-shift-card")).toBeTruthy();
  });

  it("threads isTablet into the hero-band variant on native-tablet floor surfaces", async () => {
    archetype = "tech";
    caps = new Set<Capability>(["codeBlue.manage"]);
    renderSurface(<TechHomeSurface isTablet={true} />);
    // Wait for the on-shift fixture to resolve (idle→active) before reading the variant.
    await screen.findByText(t.homePage.onShift);
    const card = screen.getByTestId("start-of-shift-card");
    expect(card.getAttribute("data-variant")).toBe("hero");
  });

  it("stays compact on phone/desktop-web floor surfaces", async () => {
    archetype = "vet";
    caps = new Set<Capability>(["codeBlue.manage", "equipment.vetActions"]);
    renderSurface(<VetHomeSurface isTablet={false} />);
    await screen.findByText(t.homePage.onShift);
    const card = screen.getByTestId("start-of-shift-card");
    expect(card.getAttribute("data-variant")).toBe("compact");
  });
});
