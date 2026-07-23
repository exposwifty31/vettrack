/**
 * @vitest-environment happy-dom
 *
 * VetTrack 2.0, Task 1.1 §6 (deliverable E, disclosed v1 scope) — a
 * structured edit dialog is OUT of scope for the 3 non-restock kinds; the
 * edit button opens this confirm-style dialog explaining that a full
 * edit-in-console flow is coming instead of silently doing nothing.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { t } from "@/lib/i18n";
import { EditUnavailableDialog } from "@/features/autopilot/EditUnavailableDialog";

afterEach(() => cleanup());

describe("EditUnavailableDialog", () => {
  it("explains editing is not yet available for this proposal kind", () => {
    render(<EditUnavailableDialog open onOpenChange={() => {}} />);
    expect(screen.getByText(t.autopilotQueue.editUnavailableTitle)).toBeTruthy();
    expect(screen.getByText(t.autopilotQueue.editUnavailableBody)).toBeTruthy();
  });

  it("dismisses via onOpenChange(false)", () => {
    const onOpenChange = vi.fn();
    render(<EditUnavailableDialog open onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: t.autopilotQueue.editUnavailableDismiss }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
