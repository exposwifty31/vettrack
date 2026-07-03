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
