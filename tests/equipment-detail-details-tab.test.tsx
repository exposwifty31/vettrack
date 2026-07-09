/**
 * @vitest-environment happy-dom
 *
 * Phase 7S — behavioral coverage for the EquipmentDetailDetailsTab extracted from the
 * equipment-detail.tsx god-file. Presentational: renders the equipment spec rows
 * (filtering empties) and the expiry badge.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { t } from "@/lib/i18n";
import { EquipmentDetailDetailsTab } from "@/components/equipment/EquipmentDetailDetailsTab";
import type { Equipment } from "@/types";

// Partial fixture: only the fields EquipmentDetailDetailsTab reads. Equipment has many
// more required fields, so the cast keeps the fixture minimal; per-test spreads add the
// spec fields under exercise.
const base = {
  id: "e1",
  name: "Infusion Pump",
  status: "ok",
  createdAt: "2026-01-01",
} as unknown as Equipment;

afterEach(() => cleanup());

describe("EquipmentDetailDetailsTab", () => {
  it("renders populated spec rows and omits empty ones", () => {
    render(
      <EquipmentDetailDetailsTab
        equipment={{ ...base, serialNumber: "SN-123", model: "MX-9", location: "ICU" } as Equipment}
      />,
    );
    expect(screen.getByText("SN-123")).toBeTruthy();
    expect(screen.getByText("MX-9")).toBeTruthy();
    expect(screen.getByText(t.equipmentDetail.serialNumber)).toBeTruthy();
    // Manufacturer was not provided → its row is filtered out.
    expect(screen.queryByText(t.equipmentDetail.manufacturer)).toBeNull();
  });

  it("shows an expiry badge for an expired item", () => {
    render(
      <EquipmentDetailDetailsTab equipment={{ ...base, expiryDate: "2020-01-01" } as Equipment} />,
    );
    expect(screen.getByText(t.equipmentDetail.expiryExpired)).toBeTruthy();
  });
});
