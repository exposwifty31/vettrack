/**
 * @vitest-environment happy-dom
 *
 * CustodyGuard — a custody-only user (student) is redirected off out-of-scope
 * routes (S1); every other role renders through; no premature redirect before auth
 * loads.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { buildRoleExperience, type ExperienceArchetype } from "@/lib/roles/experience-model";
import type { UserRole } from "@/types/platform";

let mockAuth: { isLoaded: boolean; role: UserRole };
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => mockAuth }));
vi.mock("@/hooks/use-experience", () => ({
  useExperience: () => {
    const exp = buildRoleExperience({
      role: mockAuth.role,
      effectiveRole: mockAuth.role,
      roleSource: "permanent",
      isAdmin: mockAuth.role === "admin",
    });
    return { ...exp, can: (c: never) => exp.capabilities.has(c) };
  },
}));

import { CustodyGuard } from "@/app/platform/guards/CustodyGuard";

// Renders the current wouter location so a redirect's DESTINATION is assertable,
// not merely the disappearance of the protected content.
function LocationProbe() {
  const [loc] = useLocation();
  return <div data-testid="location">{loc}</div>;
}

function renderAt(path: string) {
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      <CustodyGuard fallback="/equipment">
        <div data-testid="protected">protected content</div>
      </CustodyGuard>
      <LocationProbe />
    </Router>,
  );
}

beforeEach(() => {
  mockAuth = { isLoaded: true, role: "admin" };
});
afterEach(() => cleanup());

describe("CustodyGuard", () => {
  it("renders children for non-custody roles (incl. the lead/tech aliases)", () => {
    for (const role of ["admin", "vet", "senior_technician", "technician", "lead_technician", "vet_tech"] as UserRole[]) {
      cleanup();
      mockAuth = { isLoaded: true, role };
      renderAt("/alerts");
      expect(screen.queryByTestId("protected"), `role ${role} should see the route`).toBeTruthy();
      expect(screen.getByTestId("location").textContent, `role ${role} should stay put`).toBe("/alerts");
    }
  });

  it("redirects a custody-only user (student) to the fallback route", () => {
    mockAuth = { isLoaded: true, role: "student" };
    renderAt("/alerts");
    expect(screen.queryByTestId("protected")).toBeNull();
    // The redirect lands on the exact fallback, not just "somewhere else".
    expect(screen.getByTestId("location").textContent).toBe("/equipment");
  });

  it("does not redirect before auth is loaded (no premature bounce)", () => {
    mockAuth = { isLoaded: false, role: "student" };
    renderAt("/alerts");
    expect(screen.queryByTestId("protected")).toBeTruthy();
  });

  // Sanity: the archetype the guard keys on is exactly "student".
  it("only the student archetype is custody-only", () => {
    const arche = (r: UserRole): ExperienceArchetype =>
      buildRoleExperience({ role: r, effectiveRole: r, roleSource: "permanent", isAdmin: r === "admin" }).archetype;
    expect(arche("student")).toBe("student");
    expect(arche("technician")).toBe("tech");
  });
});
