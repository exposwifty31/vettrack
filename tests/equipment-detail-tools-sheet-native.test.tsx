/**
 * @vitest-environment happy-dom
 *
 * IPHONE-2 (dead affordance) — the equipment detail tools sheet's Print QR
 * button targets `/equipment/:id/qr`, which is WebOnlyGuard-walled. On the
 * Capacitor shell the tap can never succeed, so it should not render there.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { t } from "@/lib/i18n";
import type { Equipment } from "@/types";

let native = false;

vi.mock("@/lib/capacitor-runtime", () => ({
  isCapacitorNative: () => native,
}));

import { EquipmentDetailToolsSheet } from "@/components/equipment/EquipmentDetailToolsSheet";

const EQUIPMENT_FIXTURE: Equipment = {
  id: "eq-1",
  name: "X",
  status: "ok",
  createdAt: "2026-07-21T00:00:00.000Z",
};

describe("EquipmentDetailToolsSheet — Print QR hidden on native (IPHONE-2)", () => {
  afterEach(() => {
    cleanup();
    native = false;
  });

  it("shows Print QR on the web shell", () => {
    native = false;
    render(
      <EquipmentDetailToolsSheet
        equipment={EQUIPMENT_FIXTURE}
        equipmentId="eq-1"
        open
        onOpenChange={() => {}}
        onPrintQr={() => {}}
        showWhatsApp={false}
        showWriteNfc={false}
      />,
    );

    expect(screen.getByText(t.equipmentDetail.printQrButton)).toBeTruthy();
  });

  it("hides Print QR on the Capacitor native shell", () => {
    native = true;
    render(
      <EquipmentDetailToolsSheet
        equipment={EQUIPMENT_FIXTURE}
        equipmentId="eq-1"
        open
        onOpenChange={() => {}}
        onPrintQr={() => {}}
        showWhatsApp={false}
        showWriteNfc={false}
      />,
    );

    expect(screen.queryByText(t.equipmentDetail.printQrButton)).toBeNull();
  });
});
