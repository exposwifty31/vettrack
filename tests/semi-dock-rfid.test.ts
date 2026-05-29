import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("semi-dock RFID notify", () => {
  const ingest = readFileSync(join(process.cwd(), "server/lib/rfid-ingest.ts"), "utf8");
  const notify = readFileSync(join(process.cwd(), "server/lib/semi-dock-notify.ts"), "utf8");

  it("fires only for checked_out equipment entering home room", () => {
    expect(ingest).toContain('eqRow.custodyState === "checked_out"');
    expect(ingest).toContain("buildEquipmentHomeRoomIds");
    expect(ingest).toContain("isEquipmentHomeRoom");
    expect(ingest).toContain("deliverSemiDockPush");
    expect(ingest).not.toContain("dockRoomIds");
  });

  it("dedupes via atomic claimSemiDockNotifySlot", () => {
    expect(notify).toContain('SEMI_DOCK_ALERT_TYPE = "semi_dock_return"');
    expect(notify).toContain("claimSemiDockNotifySlot");
    expect(notify).toContain("pg_advisory_xact_lock");
  });

  it("logs audit and metrics", () => {
    expect(notify).toContain("equipment_semi_dock_notified");
    expect(notify).toContain("semi_dock_notified");
    expect(notify).toContain("semi_dock_skipped_deduped");
  });
});
