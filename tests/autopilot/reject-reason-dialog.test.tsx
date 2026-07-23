/**
 * @vitest-environment happy-dom
 *
 * VetTrack 2.0, Task 1.1 §6 (deliverable E) — reject requires a reason.
 * Client-side gate: min 1 non-whitespace character before submit is even
 * enabled (server enforces the same `min(1)` — this is UX, not the only
 * gate).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { t } from "@/lib/i18n";
import { RejectReasonDialog } from "@/features/autopilot/RejectReasonDialog";

afterEach(() => cleanup());

describe("RejectReasonDialog", () => {
  it("keeps submit disabled until a non-whitespace reason is entered", () => {
    const onSubmit = vi.fn();
    render(<RejectReasonDialog open onOpenChange={() => {}} onSubmit={onSubmit} pending={false} />);

    const submit = screen.getByRole("button", { name: t.autopilotQueue.rejectSubmit }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    const textarea = screen.getByLabelText(t.autopilotQueue.rejectReasonLabel);
    fireEvent.change(textarea, { target: { value: "   " } });
    expect(submit.disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: "Wrong candidate" } });
    expect(submit.disabled).toBe(false);
  });

  it("submits the trimmed reason", () => {
    const onSubmit = vi.fn();
    render(<RejectReasonDialog open onOpenChange={() => {}} onSubmit={onSubmit} pending={false} />);

    const textarea = screen.getByLabelText(t.autopilotQueue.rejectReasonLabel);
    fireEvent.change(textarea, { target: { value: "  Not needed  " } });
    fireEvent.click(screen.getByRole("button", { name: t.autopilotQueue.rejectSubmit }));

    expect(onSubmit).toHaveBeenCalledWith("Not needed");
  });

  it("disables the submit button while pending", () => {
    render(<RejectReasonDialog open onOpenChange={() => {}} onSubmit={() => {}} pending />);
    const textarea = screen.getByLabelText(t.autopilotQueue.rejectReasonLabel);
    fireEvent.change(textarea, { target: { value: "Reason" } });
    const submit = screen.getByRole("button", { name: t.autopilotQueue.rejectSubmit }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
});
