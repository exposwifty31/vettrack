/**
 * @vitest-environment happy-dom
 *
 * VetTrack 2.0, Task 1.1 §6 (deliverable H) — board ambient proposal count.
 * Count ONLY, glance-only, no proposal content, no new interactive targets
 * (same glance-only guardrail as the anomaly cards this section already
 * renders — `board-attention-render.test.tsx`'s "glance-only guardrail"
 * describe block covers the anomaly-card side; this file covers the count
 * addition specifically so that existing suite stays untouched).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { t } from "@/lib/i18n";
import { BoardAttentionSection } from "@/features/command-board/components/BoardAttentionSection";

afterEach(() => cleanup());

describe("BoardAttentionSection — proposal count (Task 1.1 §6)", () => {
  it("still renders nothing when there are no anomalies AND no staged proposals", () => {
    const { container } = render(
      <BoardAttentionSection anomalies={[]} mode="calm" reducedMotion={false} />,
    );
    expect(container.querySelector("[data-testid='board-attention']")).toBeNull();
  });

  it("renders the section for a proposal count alone, even with zero anomalies", () => {
    render(<BoardAttentionSection anomalies={[]} mode="calm" reducedMotion={false} proposalCount={3} />);
    expect(screen.getByTestId("board-attention")).toBeTruthy();
    expect(screen.getByText(t.autopilotQueue.board.awaitingApproval(3))).toBeTruthy();
  });

  it("does not render the count line when proposalCount is 0", () => {
    render(<BoardAttentionSection anomalies={[]} mode="calm" reducedMotion={false} proposalCount={0} />);
    expect(screen.queryByTestId("board-attention")).toBeNull();
  });

  it("shows count-only text — never a proposal id, kind, or summary", () => {
    render(<BoardAttentionSection anomalies={[]} mode="calm" reducedMotion={false} proposalCount={2} />);
    const section = screen.getByTestId("board-attention");
    expect(within(section).getByTestId("board-proposal-queue-count").textContent).toBe(
      t.autopilotQueue.board.awaitingApproval(2),
    );
  });

  it("adds no interactive targets for the proposal count (glance-only)", () => {
    render(<BoardAttentionSection anomalies={[]} mode="calm" reducedMotion={false} proposalCount={5} />);
    const section = screen.getByTestId("board-attention");
    expect(
      section.querySelectorAll(
        "button, a[href], input, select, textarea, summary, [contenteditable], [role='button'], [role='link'], [tabindex]",
      ),
    ).toHaveLength(0);
  });
});
