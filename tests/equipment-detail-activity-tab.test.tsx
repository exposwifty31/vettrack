/**
 * @vitest-environment happy-dom
 *
 * T7 (HIGH audit fix) — the bulk room-verify endpoint stores a fixed-format
 * English scan-log note ("Room verified: {room}") that this tab used to
 * render raw, leaking English text into the Hebrew activity feed. The note
 * prefix stays English on the wire (src/pages/room-radar.tsx matches on it
 * to detect the same event), so this only covers the DISPLAY path: the tab
 * must render a localized "Room verified: {room}" string, not the raw note.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { t, refreshTranslations } from "@/lib/i18n";
import { EquipmentDetailActivityTab } from "@/components/equipment/EquipmentDetailActivityTab";
import type { ScanLog } from "@/types";

const ROOM_VERIFIED_LOG = {
  id: "s1",
  equipmentId: "e1",
  userId: "u1",
  userEmail: "tech@clinic.test",
  status: "ok",
  note: "Room verified: ICU",
  timestamp: "2026-07-01T10:00:00.000Z",
} as unknown as ScanLog;

const FREE_TEXT_LOG = {
  id: "s2",
  equipmentId: "e1",
  userId: "u1",
  userEmail: "tech@clinic.test",
  status: "issue",
  note: "cracked casing",
  timestamp: "2026-07-01T10:05:00.000Z",
} as unknown as ScanLog;

beforeEach(() => refreshTranslations("he"));
afterEach(() => cleanup());

describe("EquipmentDetailActivityTab — room-verified note localization (T7)", () => {
  it("renders the localized 'Room verified: {room}' template, not the raw English note", () => {
    render(
      <EquipmentDetailActivityTab
        scanLogs={[ROOM_VERIFIED_LOG]}
        transfers={[]}
        logsLoading={false}
        transfersLoading={false}
        hasOlderLogs={false}
        isFetchingOlderLogs={false}
        onLoadOlder={() => {}}
      />,
    );
    expect(screen.getByText(t.equipmentDetail.activityRoomVerified("ICU"))).toBeTruthy();
    expect(screen.queryByText("Room verified: ICU")).toBeNull();
  });

  it("leaves free-text scan notes untouched (not an identifier, just user copy)", () => {
    render(
      <EquipmentDetailActivityTab
        scanLogs={[FREE_TEXT_LOG]}
        transfers={[]}
        logsLoading={false}
        transfersLoading={false}
        hasOlderLogs={false}
        isFetchingOlderLogs={false}
        onLoadOlder={() => {}}
      />,
    );
    expect(screen.getByText("cracked casing")).toBeTruthy();
  });
});
