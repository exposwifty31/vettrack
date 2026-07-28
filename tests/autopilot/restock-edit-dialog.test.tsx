/**
 * @vitest-environment happy-dom
 *
 * VetTrack 2.0, Task 1.1 §6 (deliverable E) — the ONE structured edit
 * affordance built for v1 (restock kind only), matching
 * `restockPoOnBurnEditedContentSchema` (`server/lib/autopilot/
 * action-proposal-types.ts`): `{ supplierName: string; lines: [{ itemId,
 * quantitySuggested: positive int }] }`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { t } from "@/lib/i18n";
import { RestockEditDialog } from "@/features/autopilot/RestockEditDialog";

afterEach(() => cleanup());

const draftContent = {
  supplierName: "Autopilot",
  scanDate: "2026-07-20",
  lines: [
    { itemId: "item-1", quantitySuggested: 4 },
    { itemId: "item-2", quantitySuggested: 2 },
  ],
  title: "Restock needed",
  suggestedQuantityLabel: "Suggested order quantity",
};

describe("RestockEditDialog", () => {
  it("pre-fills supplier + quantities from the staged draft", () => {
    render(
      <RestockEditDialog open onOpenChange={() => {}} draftContent={draftContent} onSubmit={vi.fn()} pending={false} />,
    );
    expect(screen.getByDisplayValue("Autopilot")).toBeTruthy();
    expect(screen.getByDisplayValue("4")).toBeTruthy();
    expect(screen.getByDisplayValue("2")).toBeTruthy();
  });

  it("submits the edited supplier + quantities matching the server's per-kind schema shape", () => {
    const onSubmit = vi.fn();
    render(
      <RestockEditDialog open onOpenChange={() => {}} draftContent={draftContent} onSubmit={onSubmit} pending={false} />,
    );

    fireEvent.change(screen.getByDisplayValue("Autopilot"), { target: { value: "VetSupply Co" } });
    fireEvent.change(screen.getByDisplayValue("4"), { target: { value: "6" } });

    fireEvent.click(screen.getByRole("button", { name: t.autopilotQueue.editRestock.submit }));

    expect(onSubmit).toHaveBeenCalledWith({
      supplierName: "VetSupply Co",
      lines: [
        { itemId: "item-1", quantitySuggested: 6 },
        { itemId: "item-2", quantitySuggested: 2 },
      ],
    });
  });

  it("blocks submit when a quantity is not a positive integer", () => {
    const onSubmit = vi.fn();
    render(
      <RestockEditDialog open onOpenChange={() => {}} draftContent={draftContent} onSubmit={onSubmit} pending={false} />,
    );

    fireEvent.change(screen.getByDisplayValue("4"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: t.autopilotQueue.editRestock.submit }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(t.autopilotQueue.editRestock.invalid)).toBeTruthy();
  });

  it("blocks submit when the supplier name is blank", () => {
    const onSubmit = vi.fn();
    render(
      <RestockEditDialog open onOpenChange={() => {}} draftContent={draftContent} onSubmit={onSubmit} pending={false} />,
    );

    fireEvent.change(screen.getByDisplayValue("Autopilot"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: t.autopilotQueue.editRestock.submit }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
