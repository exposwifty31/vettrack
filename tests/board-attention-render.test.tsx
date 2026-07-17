/**
 * @vitest-environment happy-dom
 *
 * R-BDF-1.2 — Board "attention" section. Anomalies render as RANKED glance cards.
 * Ordering (pinned): severity (pressure > calm) → rule priority
 * (battery_critical > rfid_reader_offline > cart_unverified) → since age (oldest
 * first) → unitId (stable tie-break). calm mode stays quiet; pressure escalates
 * (color + size). prefers-reduced-motion swaps motion for a static variant in BOTH
 * calm AND pressure (pressure still escalates color/size, but with NO animation).
 * Glance-only: the section adds ZERO interactive targets to the board.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import { BoardAttentionSection } from "@/features/command-board/components/BoardAttentionSection";
import type { BoardAnomaly, BoardAnomalyType } from "../shared/equipment-board";

function anomaly(
  type: BoardAnomalyType,
  unitId: string,
  since = "2026-07-17T00:00:00.000Z",
): BoardAnomaly {
  const severity = type === "cart_unverified" ? "calm" : "pressure";
  return { type, unitId, severity, since, sourceRef: { table: "vt_equipment", id: unitId } };
}

afterEach(() => cleanup());

function ranks(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-anomaly-unit]"))
    .sort(
      (a, b) =>
        Number(a.getAttribute("data-anomaly-rank")) - Number(b.getAttribute("data-anomaly-rank")),
    )
    .map((el) => `${el.getAttribute("data-anomaly-type")}:${el.getAttribute("data-anomaly-unit")}`);
}

describe("BoardAttentionSection — ranked rendering", () => {
  it("orders by severity → rule priority → since age → unitId (pinned)", () => {
    // Deliberately shuffled input.
    const anomalies: BoardAnomaly[] = [
      anomaly("cart_unverified", "cart-1"), // calm — last tier
      anomaly("rfid_reader_offline", "rd-2"), // pressure, priority 1
      anomaly("battery_critical", "eq-9"), // pressure, priority 0
      anomaly("battery_critical", "eq-1"), // pressure, priority 0 (same since → unitId tie-break)
    ];
    const { container } = render(
      <BoardAttentionSection anomalies={anomalies} mode="pressure" reducedMotion={false} />,
    );
    expect(ranks(container)).toEqual([
      "battery_critical:eq-1",
      "battery_critical:eq-9",
      "rfid_reader_offline:rd-2",
      "cart_unverified:cart-1",
    ]);
  });

  it("locks the order of equal-priority anomalies by since (oldest first) then unitId", () => {
    const anomalies: BoardAnomaly[] = [
      anomaly("battery_critical", "eq-b", "2026-07-17T09:00:00.000Z"), // newer
      anomaly("battery_critical", "eq-a", "2026-07-17T08:00:00.000Z"), // oldest → first
      anomaly("battery_critical", "eq-c", "2026-07-17T09:00:00.000Z"), // newer, tie w/ eq-b → unitId
    ];
    const { container } = render(
      <BoardAttentionSection anomalies={anomalies} mode="pressure" reducedMotion={false} />,
    );
    expect(ranks(container)).toEqual([
      "battery_critical:eq-a",
      "battery_critical:eq-b",
      "battery_critical:eq-c",
    ]);
  });

  it("renders nothing when there are no anomalies", () => {
    const { container } = render(
      <BoardAttentionSection anomalies={[]} mode="calm" reducedMotion={false} />,
    );
    expect(container.querySelector("[data-testid='board-attention']")).toBeNull();
  });
});

describe("BoardAttentionSection — calm vs pressure", () => {
  it("keeps a pressure-severity card quiet in calm mode and escalated in pressure mode", () => {
    const a = [anomaly("battery_critical", "eq-1")];

    const calm = render(<BoardAttentionSection anomalies={a} mode="calm" reducedMotion={false} />);
    const calmCard = calm.getByTestId("board-anomaly-battery_critical-eq-1");
    expect(calm.getByTestId("board-attention").getAttribute("data-board-mode")).toBe("calm");
    expect(calmCard.getAttribute("data-anomaly-emphasis")).toBe("quiet");
    cleanup();

    const pressure = render(
      <BoardAttentionSection anomalies={a} mode="pressure" reducedMotion={false} />,
    );
    const pressureCard = pressure.getByTestId("board-anomaly-battery_critical-eq-1");
    expect(pressure.getByTestId("board-attention").getAttribute("data-board-mode")).toBe("pressure");
    expect(pressureCard.getAttribute("data-anomaly-emphasis")).toBe("escalated");
  });
});

describe("BoardAttentionSection — reduced-motion", () => {
  it("uses an animated motion variant when motion is allowed (calm cross-fade)", () => {
    const { getByTestId } = render(
      <BoardAttentionSection
        anomalies={[anomaly("cart_unverified", "cart-1")]}
        mode="calm"
        reducedMotion={false}
      />,
    );
    expect(getByTestId("board-anomaly-cart_unverified-cart-1").getAttribute("data-anomaly-motion")).toBe(
      "cross-fade",
    );
  });

  it("uses an animated escalation variant in pressure when motion is allowed", () => {
    const { getByTestId } = render(
      <BoardAttentionSection
        anomalies={[anomaly("battery_critical", "eq-1")]}
        mode="pressure"
        reducedMotion={false}
      />,
    );
    expect(getByTestId("board-anomaly-battery_critical-eq-1").getAttribute("data-anomaly-motion")).toBe(
      "escalate",
    );
  });

  it("swaps motion for STATIC in calm when reduced-motion is set", () => {
    const { getByTestId } = render(
      <BoardAttentionSection
        anomalies={[anomaly("cart_unverified", "cart-1")]}
        mode="calm"
        reducedMotion
      />,
    );
    const card = getByTestId("board-anomaly-cart_unverified-cart-1");
    expect(card.getAttribute("data-anomaly-motion")).toBe("static");
    expect(getByTestId("board-attention").getAttribute("data-reduced-motion")).toBe("true");
  });

  it("in pressure + reduced-motion still ESCALATES color/size but with NO animation", () => {
    const { getByTestId } = render(
      <BoardAttentionSection
        anomalies={[anomaly("battery_critical", "eq-1")]}
        mode="pressure"
        reducedMotion
      />,
    );
    const card = getByTestId("board-anomaly-battery_critical-eq-1");
    expect(card.getAttribute("data-anomaly-emphasis")).toBe("escalated"); // color/size still escalate
    expect(card.getAttribute("data-anomaly-motion")).toBe("static"); // but no animation
  });
});

describe("BoardAttentionSection — glance-only guardrail", () => {
  it("adds NO interactive targets (no buttons, links, or focusable controls)", () => {
    const { getByTestId } = render(
      <BoardAttentionSection
        anomalies={[
          anomaly("battery_critical", "eq-1"),
          anomaly("cart_unverified", "cart-1"),
        ]}
        mode="pressure"
        reducedMotion={false}
      />,
    );
    const section = getByTestId("board-attention");
    const interactive = within(section).queryAllByRole("button");
    expect(interactive).toHaveLength(0);
    expect(section.querySelectorAll("button, a, input, [role='button'], [tabindex]")).toHaveLength(0);
  });
});
