/**
 * @vitest-environment happy-dom
 *
 * Phase 8 — floor-home dispatch. FloorHomeSurface differentiates the three FLOOR
 * archetypes (vet / tech / student) onto their own surfaces. These tests stub the
 * three surface components so the assertion is purely the DISPATCH: the right
 * surface for the archetype, the isTablet prop forwarded verbatim, and an unknown
 * archetype degrading to the tech (least-authority) default.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const mockArchetype = vi.fn<() => string>();

vi.mock("@/hooks/use-experience", () => ({
  useExperience: () => ({ archetype: mockArchetype() }),
}));
vi.mock("@/features/today/surfaces/VetHomeSurface", () => ({
  VetHomeSurface: ({ isTablet }: { isTablet: boolean }) => <div>VET:{String(isTablet)}</div>,
}));
vi.mock("@/features/today/surfaces/TechHomeSurface", () => ({
  TechHomeSurface: ({ isTablet }: { isTablet: boolean }) => <div>TECH:{String(isTablet)}</div>,
}));
vi.mock("@/features/today/surfaces/StudentHomeSurface", () => ({
  StudentHomeSurface: ({ isTablet }: { isTablet: boolean }) => <div>STUDENT:{String(isTablet)}</div>,
}));

import { FloorHomeSurface } from "@/features/today/surfaces/FloorHomeSurface";

afterEach(() => cleanup());

describe("FloorHomeSurface — archetype dispatch", () => {
  const cases: Array<{ archetype: string; tablet: boolean; expected: string }> = [
    { archetype: "vet", tablet: false, expected: "VET:false" },
    { archetype: "tech", tablet: true, expected: "TECH:true" },
    { archetype: "student", tablet: false, expected: "STUDENT:false" },
    // ops archetypes never reach here (home.tsx routes them away); an unexpected
    // value degrades to the tech default rather than blanking the page.
    { archetype: "admin", tablet: false, expected: "TECH:false" },
  ];

  for (const c of cases) {
    it(`${c.archetype} × tablet=${c.tablet} → ${c.expected}`, () => {
      mockArchetype.mockReturnValue(c.archetype);
      render(<FloorHomeSurface isTablet={c.tablet} />);
      expect(screen.getByText(c.expected)).toBeTruthy();
    });
  }

  it("renders exactly one surface (no double-mount)", () => {
    mockArchetype.mockReturnValue("vet");
    const { container } = render(<FloorHomeSurface isTablet={false} />);
    expect(container.textContent).toBe("VET:false");
  });
});
