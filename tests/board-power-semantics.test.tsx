/**
 * @vitest-environment happy-dom
 *
 * TV board Phase 1 (Task 5) — PowerPanel status semantics. Red is an ALARM
 * color on a 10-foot display: a zero in the alerts column must render neutral
 * (no danger token), and the danger treatment (red + icon glyph) appears only
 * when alerts are actually active. Severity is exposed via data-severity so
 * the treatment is asserted structurally, not by pixel.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { PowerPanel } from "@/features/command-board/components/board-panels";

afterEach(() => cleanup());

describe("PowerPanel alert-figure semantics", () => {
  it("zero alerts renders neutral: data-severity none, no danger class, no icon", () => {
    const { getByTestId, queryByTestId } = render(
      <PowerPanel power={{ plugged: 2, unplugged: 0, alert: 0 }} />,
    );
    const figure = getByTestId("board-power-alerts");
    expect(figure.getAttribute("data-severity")).toBe("none");
    expect(figure.className).not.toContain("status-issue");
    expect(figure.textContent).toContain("0");
    expect(queryByTestId("board-power-alert-icon")).toBeNull();
  });

  it("active alerts render data-severity active with the danger class and icon glyph", () => {
    const { getByTestId } = render(
      <PowerPanel power={{ plugged: 2, unplugged: 1, alert: 2 }} />,
    );
    const figure = getByTestId("board-power-alerts");
    expect(figure.getAttribute("data-severity")).toBe("active");
    expect(figure.className).toContain("status-issue");
    expect(figure.textContent).toContain("2");
    expect(getByTestId("board-power-alert-icon")).toBeTruthy();
  });
});
