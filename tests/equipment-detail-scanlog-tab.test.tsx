/**
 * @vitest-environment happy-dom
 *
 * Phase 7S — behavioral coverage for the EquipmentDetailScanLogTab extracted from the
 * equipment-detail.tsx god-file. Presentational: renders the range toggle + admin
 * scan-log list, surfaces the empty state, and reports range changes to the parent.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { t } from "@/lib/i18n";
import { EquipmentDetailScanLogTab } from "@/components/equipment/EquipmentDetailScanLogTab";
import type { ScanLog } from "@/types";

const LOG = {
  id: "s1",
  status: "issue",
  staffName: "Dr. Amir",
  userEmail: "amir@clinic.test",
  staffRole: "lead_technician",
  note: "cracked casing",
  timestamp: new Date("2026-07-01T10:00:00.000Z"),
} as unknown as ScanLog;

afterEach(() => cleanup());

describe("EquipmentDetailScanLogTab", () => {
  it("renders the range toggle and the scan-log list", () => {
    render(
      <EquipmentDetailScanLogTab range="today" onRangeChange={() => {}} isLoading={false} logs={[LOG]} />,
    );
    expect(screen.getByRole("button", { name: t.equipmentDetail.scanLogToday })).toBeTruthy();
    expect(screen.getByRole("button", { name: t.equipmentDetail.scanLogWeek })).toBeTruthy();
    expect(screen.getByText("Dr. Amir")).toBeTruthy();
    expect(screen.getByText("cracked casing")).toBeTruthy();
  });

  it("shows the empty state when there are no logs", () => {
    render(
      <EquipmentDetailScanLogTab range="all" onRangeChange={() => {}} isLoading={false} logs={[]} />,
    );
    expect(screen.getByText(t.equipmentDetail.scanLogEmpty)).toBeTruthy();
  });

  it("reports the selected range to the parent", () => {
    const onRangeChange = vi.fn();
    render(
      <EquipmentDetailScanLogTab range="today" onRangeChange={onRangeChange} isLoading={false} logs={[]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: t.equipmentDetail.scanLogWeek }));
    expect(onRangeChange).toHaveBeenCalledWith("7d");
  });
});
