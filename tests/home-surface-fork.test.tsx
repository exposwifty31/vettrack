/**
 * @vitest-environment happy-dom
 *
 * Phase 3 (A2) — home fork resolution. Validates the 2×2 (homeSurface × tablet)
 * selection in HomePage without dragging in each surface's data plumbing: the
 * surface components are stubbed, so this asserts the FORK logic — the right
 * surface for the right (role-derived surface, form-factor) pair — and that both
 * gate hooks are read unconditionally (no throw across a predicate flip).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const mockIsNativeTablet = vi.fn<() => boolean>();
const mockHomeSurface = vi.fn<() => "ops" | "floor">();

vi.mock("@/native/tablet/useIsNativeTablet", () => ({
  useIsNativeTablet: () => mockIsNativeTablet(),
}));
vi.mock("@/hooks/use-experience", () => ({
  useExperience: () => ({ homeSurface: mockHomeSurface() }),
}));
vi.mock("@/features/today/HomeTabletDashboard", () => ({
  HomeTabletDashboard: () => <div>TABLET_DASHBOARD</div>,
}));
vi.mock("@/features/today/surfaces/OpsHomeSurface", () => ({
  OpsHomeSurface: () => <div>OPS_SURFACE</div>,
}));
vi.mock("@/features/today/surfaces/FloorHomeSurface", () => ({
  FloorHomeSurface: ({ isTablet }: { isTablet: boolean }) => <div>FLOOR_SURFACE:{String(isTablet)}</div>,
}));

import HomePage from "@/pages/home";

afterEach(() => cleanup());

describe("HomePage fork — homeSurface × tablet resolution", () => {
  const cases: Array<{ surface: "ops" | "floor"; tablet: boolean; expected: string }> = [
    // ops keeps the existing tablet dashboard on iPad-native, gets OpsHomeSurface on web
    { surface: "ops", tablet: true, expected: "TABLET_DASHBOARD" },
    { surface: "ops", tablet: false, expected: "OPS_SURFACE" },
    // floor is one responsive surface; isTablet only picks bare-vs-AppShell wrapping
    { surface: "floor", tablet: true, expected: "FLOOR_SURFACE:true" },
    { surface: "floor", tablet: false, expected: "FLOOR_SURFACE:false" },
  ];

  for (const c of cases) {
    it(`${c.surface} × tablet=${c.tablet} → ${c.expected}`, () => {
      mockHomeSurface.mockReturnValue(c.surface);
      mockIsNativeTablet.mockReturnValue(c.tablet);
      render(<HomePage />);
      expect(screen.getByText(c.expected)).toBeTruthy();
    });
  }

  it("renders exactly one surface (no double-mount, no blank)", () => {
    mockHomeSurface.mockReturnValue("ops");
    mockIsNativeTablet.mockReturnValue(false);
    const { container } = render(<HomePage />);
    expect(screen.getByText("OPS_SURFACE")).toBeTruthy();
    expect(screen.queryByText("FLOOR_SURFACE:false")).toBeNull();
    expect(screen.queryByText("TABLET_DASHBOARD")).toBeNull();
    expect(container.textContent).toBe("OPS_SURFACE");
  });
});
