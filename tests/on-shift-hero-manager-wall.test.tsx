/**
 * @vitest-environment happy-dom
 *
 * Track D / Phase 5 — the SECOND shift-wall site, which `shouldBlockForShift()` never
 * touched.
 *
 * `OnShiftHero`'s `noshift` branch renders "סריקה וניפוק ציוד אינם זמינים" purely from
 * `heroState`, with no capability input. On `/home` it sits beside `StartOfShiftCard`,
 * which IS capability-gated and shows managers an ops line — so the two components
 * contradicted each other on one screen. Fixing Track D only at the
 * `shouldBlockForShift()` call sites would have left this copy standing on the very
 * screen Track D exists for.
 *
 * The claim is also simply false for anyone exempt: admins and vets have held
 * `equipment.actOffShift` all along, so this line was already lying to them on mobile.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { t } from "@/lib/i18n";

const mockCanActOffShift = vi.fn<() => boolean>();
vi.mock("@/hooks/use-can-act-off-shift", () => ({
  useCanActOffShift: () => mockCanActOffShift(),
}));

import { OnShiftHero } from "@/features/today/surfaces/OnShiftHero";

function renderNoShift() {
  return render(
    <OnShiftHero pulse={undefined} itemsOut={0} scansDone={0} heroState="noshift" />,
  );
}

beforeEach(() => {
  cleanup();
  mockCanActOffShift.mockReset();
});

describe("OnShiftHero — the off-shift claim", () => {
  it("still tells a roster-gated user that equipment actions are unavailable", () => {
    mockCanActOffShift.mockReturnValue(false);
    renderNoShift();

    expect(screen.getByText(t.home.shift.noShift)).toBeTruthy();
    expect(screen.getByText(t.homePage.noShiftSub)).toBeTruthy();
  });

  it("does not tell an exempt manager that actions are unavailable — they are not", () => {
    mockCanActOffShift.mockReturnValue(true);
    renderNoShift();

    // The factual half stays: there really is no active shift.
    expect(screen.getByText(t.home.shift.noShift)).toBeTruthy();
    // The false half goes.
    expect(screen.queryByText(t.homePage.noShiftSub)).toBeNull();
  });
});
