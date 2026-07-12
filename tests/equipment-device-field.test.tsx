/**
 * @vitest-environment happy-dom
 *
 * CodeRabbit PR #83 — EquipmentDeviceField:
 *  - A failed equipment query (`hasError`) must disable the picker so an empty
 *    `equipment` array never reads as "no equipment registered" (the caller
 *    surfaces a retry alert alongside it).
 *  - Keyboard navigation must keep the active option scrolled into view as
 *    ArrowUp/ArrowDown move it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { EquipmentDeviceField } from "@/pages/tasks/EquipmentDeviceField";
import type { Equipment } from "@/types";

function eq(id: string, name: string): Equipment {
  return { id, name } as unknown as Equipment;
}

afterEach(() => cleanup());

describe("EquipmentDeviceField — errored query (CodeRabbit)", () => {
  it("disables the input when hasError so it can't render the empty-clinic state", () => {
    render(<EquipmentDeviceField id="f" equipment={[]} hasError value="" onChange={() => {}} />);
    expect((screen.getByRole("combobox") as HTMLInputElement).disabled).toBe(true);
  });

  it("stays interactive for a genuinely empty clinic (no error)", () => {
    render(<EquipmentDeviceField id="f" equipment={[]} value="" onChange={() => {}} />);
    expect((screen.getByRole("combobox") as HTMLInputElement).disabled).toBe(false);
  });
});

describe("EquipmentDeviceField — keyboard nav keeps the active option visible", () => {
  it("scrolls the active option into view on ArrowDown", () => {
    const scrollSpy = vi.fn();
    // happy-dom does not implement scrollIntoView — provide it for the assertion.
    (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollSpy;

    render(
      <EquipmentDeviceField
        id="f"
        equipment={[eq("1", "Alpha monitor"), eq("2", "Bravo pump")]}
        value=""
        onChange={() => {}}
      />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.focus(input); // open the listbox
    fireEvent.keyDown(input, { key: "ArrowDown" }); // active → first option

    expect(scrollSpy).toHaveBeenCalled();
  });
});
