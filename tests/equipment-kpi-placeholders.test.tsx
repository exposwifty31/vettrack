/**
 * @vitest-environment happy-dom
 *
 * C2 + H1 (UX audit, trust) — the equipment header must never present a
 * computed "0%" while loading or when nothing matches (it painted alarm-orange
 * on cold load), and when equipment hasn't been verified for 14+ days the
 * header carries a "not verified" readout from the SAME isInactive predicate
 * the alert bell uses, so the two surfaces cannot disagree.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { t } from "@/lib/i18n";
import { EquipmentLargeTitle } from "@/features/equipment/EquipmentLargeTitle";
import { EquipmentStatStrip } from "@/components/equipment/EquipmentTriageList";
import { INACTIVE_THRESHOLD_DAYS } from "../shared/constants";

describe("EquipmentLargeTitle — C2 placeholder + H1 readout", () => {
  afterEach(() => cleanup());

  const base = {
    title: "ציוד",
    count: 0,
    availabilityPct: null,
    isLoading: false,
    verifiedCount: null,
    notVerifiedCount: null,
  };

  it("shows a placeholder — never 0% — while loading", () => {
    render(<EquipmentLargeTitle {...base} isLoading availabilityPct={null} />);
    const pct = screen.getByTestId("equipment-availability");
    expect(pct.textContent).toBe("—");
    expect(pct.textContent).not.toContain("0%");
  });

  it("shows a placeholder when loaded with no matching items", () => {
    render(<EquipmentLargeTitle {...base} availabilityPct={null} />);
    expect(screen.getByTestId("equipment-availability").textContent).toBe("—");
  });

  it("shows the real percentage when data exists", () => {
    render(<EquipmentLargeTitle {...base} count={122} availabilityPct={100} />);
    expect(screen.getByTestId("equipment-availability").textContent).toBe("100%");
  });

  it("renders the not-verified readout when stale equipment exists (H1)", () => {
    render(
      <EquipmentLargeTitle
        {...base}
        count={122}
        availabilityPct={100}
        verifiedCount={62}
        notVerifiedCount={60}
      />,
    );
    expect(screen.getByTestId("equipment-verified-split").textContent).toBe(
      t.equipmentList.verifiedSplit(62, 60, INACTIVE_THRESHOLD_DAYS),
    );
  });

  it("omits the readout when everything is verified", () => {
    render(
      <EquipmentLargeTitle
        {...base}
        count={122}
        availabilityPct={100}
        verifiedCount={122}
        notVerifiedCount={0}
      />,
    );
    expect(screen.queryByTestId("equipment-verified-split")).toBeNull();
  });
});

describe("EquipmentLargeTitle — T14 no false all-clear", () => {
  afterEach(() => cleanup());

  const base = {
    title: "ציוד",
    count: 62,
    availabilityPct: 100,
    isLoading: false,
    verifiedCount: 0,
    notVerifiedCount: 62,
  };

  // The audit scenario: 100% availability sits next to "0 תקין · 62 לא אומתו".
  // The two figures are different metrics (operational health vs freshness), so
  // 100% must NOT paint the celebratory all-clear tone when nothing is verified.
  it("does not celebrate 100% availability when nothing has been verified", () => {
    render(<EquipmentLargeTitle {...base} />);
    const pct = screen.getByTestId("equipment-availability");
    // Both dimensions are shown, but the availability figure is the caution
    // tone (amber), never the celebratory green (var(--action)).
    expect(pct.getAttribute("data-availability-tone")).toBe("caution");
    expect(pct.getAttribute("style")).not.toContain("var(--action)");
    // The verification split is still rendered next to it.
    expect(screen.getByTestId("equipment-verified-split")).toBeTruthy();
  });

  it("celebrates 100% availability once verification confirms items", () => {
    render(<EquipmentLargeTitle {...base} verifiedCount={62} notVerifiedCount={0} />);
    const pct = screen.getByTestId("equipment-availability");
    expect(pct.getAttribute("data-availability-tone")).toBe("ok");
    expect(pct.getAttribute("style")).toContain("var(--action)");
  });

  it("treats unknown (null) verification as not-yet-loaded, keeping the tone", () => {
    // While the full-list verification query is still resolving we don't know
    // that nothing is verified — the gate must only trip on a KNOWN zero.
    render(
      <EquipmentLargeTitle {...base} verifiedCount={null} notVerifiedCount={null} />,
    );
    expect(
      screen.getByTestId("equipment-availability").getAttribute("data-availability-tone"),
    ).toBe("ok");
  });
});

describe("EquipmentStatStrip — calm zero + no duplicate availability", () => {
  afterEach(() => cleanup());

  it("does not paint a zero attention count red", () => {
    render(<EquipmentStatStrip total={10} attention={0} inUse={2} />);
    const cell = screen.getByText("0");
    expect(cell.className).not.toContain("text-destructive");
  });

  it("paints a non-zero attention count red", () => {
    render(<EquipmentStatStrip total={10} attention={3} inUse={2} />);
    const cell = screen.getByText("3");
    expect(cell.className).toContain("text-destructive");
  });

  it("hides the uptime cell when showUptime is false (hero already shows it)", () => {
    render(<EquipmentStatStrip total={10} attention={0} inUse={2} showUptime={false} />);
    expect(screen.queryByText(t.equipmentList.statUptime)).toBeNull();
  });

  it("keeps the uptime cell by default (desktop has no hero)", () => {
    render(<EquipmentStatStrip total={10} attention={0} inUse={2} />);
    expect(screen.getByText(t.equipmentList.statUptime)).toBeTruthy();
  });
});
