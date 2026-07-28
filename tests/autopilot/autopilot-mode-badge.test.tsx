/**
 * @vitest-environment happy-dom
 *
 * VetTrack 2.0, Task 1.1 §6 — the shared shadow-vs-enforce badge. Shadow is
 * the state every proposal kind ships in for this task; `enforce` exists so
 * a later Task 0.4/2.5 console consumer imports the SAME component instead
 * of duplicating the copy/visual pair.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { t } from "@/lib/i18n";
import { AutopilotModeBadge } from "@/components/autopilot-mode-badge";

afterEach(() => cleanup());

describe("AutopilotModeBadge", () => {
  it("renders the shadow copy for mode='shadow'", () => {
    render(<AutopilotModeBadge mode="shadow" />);
    expect(screen.getByText(t.autopilotQueue.modeBadge.shadow)).toBeTruthy();
  });

  it("renders the enforce copy for mode='enforce'", () => {
    render(<AutopilotModeBadge mode="enforce" />);
    expect(screen.getByText(t.autopilotQueue.modeBadge.enforce)).toBeTruthy();
  });
});
