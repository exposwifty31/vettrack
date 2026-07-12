/**
 * @vitest-environment happy-dom
 *
 * T-27a — StartOfShiftCard (R-SH-F2 · small-05). One card, one focal "what
 * needs me now" line, one primary action — composed from data the caller
 * already has (no new fetch), gated by the capability union (`can()`).
 * `caps` is driven directly (same pattern as tests/floor-home-surfaces.test.tsx)
 * so the per-archetype branch is asserted without depending on useAuth/role
 * plumbing.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { t } from "@/lib/i18n";
import type { Capability } from "@/lib/roles/experience-model";

let caps = new Set<Capability>();
vi.mock("@/hooks/use-experience", () => ({
  useExperience: () => ({ can: (c: Capability) => caps.has(c) }),
}));

import { StartOfShiftCard, type StartOfShiftCardProps } from "@/features/today/surfaces/StartOfShiftCard";

function renderCard(props: Partial<StartOfShiftCardProps> = {}) {
  const { hook } = memoryLocation({ path: "/home" });
  const defaults: StartOfShiftCardProps = {
    heroState: "active",
    criticalCount: 0,
    overdueCount: 0,
    itemsOutCount: 0,
  };
  return render(
    <Router hook={hook}>
      <StartOfShiftCard {...defaults} {...props} />
    </Router>,
  );
}

beforeEach(() => {
  caps = new Set<Capability>();
});
afterEach(() => cleanup());

describe("StartOfShiftCard — off-shift idle variant", () => {
  it("renders a quiet idle message and NO primary action when there is no active shift", () => {
    renderCard({ heroState: "noshift", criticalCount: 3, overdueCount: 2, itemsOutCount: 1 });
    expect(screen.getByText(t.homeSurface.startOfShift.idleTitle)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders the idle variant while the shift pulse is still loading", () => {
    renderCard({ heroState: "loading" });
    expect(screen.getByText(t.homeSurface.startOfShift.idleTitle)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("StartOfShiftCard — capability-gated composition", () => {
  it("ops (management.web): leads with exceptions when there are active alerts", () => {
    caps = new Set<Capability>(["management.web"]);
    renderCard({ activeAlertCount: 2, criticalCount: 2 });
    const message = screen.getByText(t.homeSurface.startOfShift.opsExceptions);
    expect(message.closest("a")?.getAttribute("href")).toBe("/alerts");
  });

  it("ops (management.web): all-clear read when nothing is outstanding", () => {
    caps = new Set<Capability>(["management.web"]);
    renderCard({ activeAlertCount: 0, criticalCount: 0 });
    const message = screen.getByText(t.homeSurface.startOfShift.opsAllClear);
    expect(message.closest("a")?.getAttribute("href")).toBe("/equipment");
  });

  it("vet (equipment.vetActions): clinical review read when equipment is critical", () => {
    caps = new Set<Capability>(["codeBlue.manage", "equipment.vetActions"]);
    renderCard({ criticalCount: 1 });
    const message = screen.getByText(t.homeSurface.startOfShift.vetReview);
    expect(message.closest("a")?.getAttribute("href")).toBe("/equipment");
  });

  it("vet (equipment.vetActions): crash-cart read when nothing clinical is outstanding", () => {
    caps = new Set<Capability>(["codeBlue.manage", "equipment.vetActions"]);
    renderCard({ criticalCount: 0 });
    const message = screen.getByText(t.homeSurface.startOfShift.vetReady);
    expect(message.closest("a")?.getAttribute("href")).toBe("/crash-cart");
  });

  it("tech (codeBlue.manage only): overdue-tasks read takes priority", () => {
    caps = new Set<Capability>(["codeBlue.manage"]);
    renderCard({ overdueCount: 1, itemsOutCount: 1 });
    const message = screen.getByText(t.homeSurface.startOfShift.techOverdue);
    expect(message.closest("a")?.getAttribute("href")).toBe("/equipment/tasks?filter=overdue");
  });

  it("tech (codeBlue.manage only): checked-out-equipment read when nothing is overdue", () => {
    caps = new Set<Capability>(["codeBlue.manage"]);
    renderCard({ overdueCount: 0, itemsOutCount: 1 });
    const message = screen.getByText(t.homeSurface.startOfShift.itemsCheckedOut);
    expect(message.closest("a")?.getAttribute("href")).toBe("/my-equipment");
  });

  it("tech (codeBlue.manage only): caught-up read when nothing is outstanding", () => {
    caps = new Set<Capability>(["codeBlue.manage"]);
    renderCard({ overdueCount: 0, itemsOutCount: 0 });
    const message = screen.getByText(t.homeSurface.startOfShift.techCaughtUp);
    expect(message.closest("a")?.getAttribute("href")).toBe("/scan");
  });

  it("student (no standing capabilities): checked-out-equipment read", () => {
    caps = new Set<Capability>();
    renderCard({ itemsOutCount: 1 });
    const message = screen.getByText(t.homeSurface.startOfShift.itemsCheckedOut);
    expect(message.closest("a")?.getAttribute("href")).toBe("/my-equipment");
  });

  it("student (no standing capabilities): ready-to-start read when nothing is checked out", () => {
    caps = new Set<Capability>();
    renderCard({ itemsOutCount: 0 });
    const message = screen.getByText(t.homeSurface.startOfShift.studentReady);
    expect(message.closest("a")?.getAttribute("href")).toBe("/scan");
  });

  it("the same underlying counts compose a DIFFERENT focal line per archetype", () => {
    const counts = { criticalCount: 1, overdueCount: 1, itemsOutCount: 1, activeAlertCount: 1 };

    caps = new Set<Capability>(["management.web"]);
    const ops = renderCard(counts);
    expect(screen.getByText(t.homeSurface.startOfShift.opsExceptions)).toBeTruthy();
    ops.unmount();

    caps = new Set<Capability>(["equipment.vetActions"]);
    const vet = renderCard(counts);
    expect(screen.getByText(t.homeSurface.startOfShift.vetReview)).toBeTruthy();
    vet.unmount();

    caps = new Set<Capability>(["codeBlue.manage"]);
    const tech = renderCard(counts);
    expect(screen.getByText(t.homeSurface.startOfShift.techOverdue)).toBeTruthy();
    tech.unmount();

    caps = new Set<Capability>();
    const student = renderCard(counts);
    expect(screen.getByText(t.homeSurface.startOfShift.itemsCheckedOut)).toBeTruthy();
    student.unmount();
  });
});

describe("StartOfShiftCard — responsive variant", () => {
  it("defaults to the compact phone variant", () => {
    caps = new Set<Capability>(["codeBlue.manage"]);
    renderCard({ itemsOutCount: 0 });
    expect(screen.getByTestId("start-of-shift-card").getAttribute("data-variant")).toBe("compact");
  });

  it("renders the iPad hero-band variant when isTablet is true", () => {
    caps = new Set<Capability>(["codeBlue.manage"]);
    renderCard({ itemsOutCount: 0, isTablet: true });
    expect(screen.getByTestId("start-of-shift-card").getAttribute("data-variant")).toBe("hero");
  });
});

describe("StartOfShiftCard — RTL correctness", () => {
  it("uses logical start-alignment (never a hardcoded LTR-only direction) for the focal line", () => {
    caps = new Set<Capability>(["codeBlue.manage"]);
    renderCard({ itemsOutCount: 0 });
    const card = screen.getByTestId("start-of-shift-card");
    // Never force the whole card LTR — Hebrew (the app default) must keep its
    // inherited RTL flow.
    expect(card.getAttribute("dir")).not.toBe("ltr");
    const message = screen.getByTestId("start-of-shift-card-message");
    expect(message.className).toContain("text-start");
    expect(message.className).not.toMatch(/text-(left|right)\b/);
  });

  it("keeps the idle variant start-aligned too", () => {
    renderCard({ heroState: "noshift" });
    const card = screen.getByTestId("start-of-shift-card");
    expect(card.getAttribute("dir")).not.toBe("ltr");
    const message = screen.getByTestId("start-of-shift-card-message");
    expect(message.className).toContain("text-start");
  });
});
