/**
 * @vitest-environment happy-dom
 *
 * Track D / Phase 5 — the exemption must be scoped to the management CONSOLE.
 *
 * The scoping gate is `usePlatformTarget()`, NOT `useIsDesktop()`. On a native iPad
 * the viewport is wide, so `useIsDesktop()` is true while the platform target is
 * `mobile` — gating on width would silently relax the roster gate inside the native
 * app, which is exactly what Track D says not to do.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mockCan = vi.fn<(cap: string) => boolean>();
const mockTarget = vi.fn<() => string>();
vi.mock("@/hooks/use-experience", () => ({
  useExperience: () => ({ archetype: "lead", capabilities: new Set(), can: mockCan }),
}));
vi.mock("@/app/platform", () => ({ usePlatformTarget: () => mockTarget() }));

import { useCanActOffShift } from "@/hooks/use-can-act-off-shift";

beforeEach(() => {
  mockCan.mockReset();
  mockTarget.mockReset();
});

const grant = (...caps: string[]) => mockCan.mockImplementation((c) => caps.includes(c));

describe("useCanActOffShift", () => {
  it("exempts a manager holding management.actOffShift on the desktop console", () => {
    grant("management.actOffShift");
    mockTarget.mockReturnValue("desktop");
    expect(renderHook(() => useCanActOffShift()).result.current).toBe(true);
  });

  it("does NOT exempt that same manager on a native/mobile target", () => {
    grant("management.actOffShift");
    mockTarget.mockReturnValue("mobile");
    expect(renderHook(() => useCanActOffShift()).result.current).toBe(false);
  });

  it("keeps the existing field exemption everywhere it already applied", () => {
    grant("equipment.actOffShift");
    for (const target of ["mobile", "desktop", "board", "marketing"]) {
      mockTarget.mockReturnValue(target);
      expect(renderHook(() => useCanActOffShift()).result.current).toBe(true);
    }
  });

  it("blocks a role holding neither capability", () => {
    grant();
    mockTarget.mockReturnValue("desktop");
    expect(renderHook(() => useCanActOffShift()).result.current).toBe(false);
  });
});
