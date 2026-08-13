/**
 * @vitest-environment happy-dom
 *
 * TV board phase 1, Task 12 — the Shift Autopilot approvals banner is CUT from
 * the kiosk board entirely (owner decision), including its polling query.
 * This file previously asserted the Task 1.1 §6 count rendering; it is
 * repurposed to guard the REMOVAL:
 *   - BoardAttentionSection renders anomalies only — no proposal-count line,
 *     and a smuggled legacy `proposalCount` prop has no effect;
 *   - no board module references the approvals queue (poller cut).
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, cleanup } from "@testing-library/react";
import { BoardAttentionSection } from "@/features/command-board/components/BoardAttentionSection";
import type { BoardAnomaly } from "../shared/equipment-board";

afterEach(() => cleanup());

const anomaly: BoardAnomaly = {
  type: "battery_critical",
  unitId: "eq-1",
  severity: "pressure",
  since: "2026-08-13T00:00:00.000Z",
  sourceRef: { table: "vt_equipment", id: "eq-1" },
};

// The legacy prop, smuggled past the (now proposal-free) prop type on purpose:
// passing it must change nothing.
const smuggledLegacyProps = { proposalCount: 3 } as unknown as Record<string, never>;

describe("BoardAttentionSection — approvals banner cut (Task 12)", () => {
  it("renders nothing with zero anomalies, even when a legacy proposalCount prop is smuggled in", () => {
    render(
      <BoardAttentionSection
        anomalies={[]}
        mode="calm"
        reducedMotion={false}
        {...smuggledLegacyProps}
      />,
    );
    expect(screen.queryByTestId("board-attention")).toBeNull();
  });

  it("never renders the legacy proposal-count line alongside anomalies", () => {
    render(
      <BoardAttentionSection
        anomalies={[anomaly]}
        mode="calm"
        reducedMotion={false}
        {...smuggledLegacyProps}
      />,
    );
    expect(screen.getByTestId("board-attention")).toBeTruthy();
    expect(screen.queryByTestId("board-proposal-queue-count")).toBeNull();
  });

  it("board modules no longer reference the approvals queue (poller cut by owner decision)", () => {
    const files = [
      "src/features/command-board/CommandBoardScreen.tsx",
      "src/features/command-board/components/CommandBoard.tsx",
      "src/features/command-board/components/BoardAttentionSection.tsx",
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} must not poll the proposals queue`).not.toContain("actionProposals");
      expect(src, `${file} must not use the proposals query key`).not.toContain(
        "proposalQueueQueryKey",
      );
      expect(src, `${file} must not carry a proposalCount prop`).not.toContain("proposalCount");
    }
  });
});
