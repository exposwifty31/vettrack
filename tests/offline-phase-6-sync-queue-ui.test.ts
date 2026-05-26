import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const detailPath = path.join(__dirname, "..", "src", "pages", "equipment-detail.tsx");

describe("offline phase 6 — equipment detail sync banner", () => {
  const source = fs.readFileSync(detailPath, "utf8");

  it("shows honest i18n banner when local state is not synced", () => {
    expect(source).toContain("usePendingSyncForEquipment");
    expect(source).toContain('equipmentLocalSyncState !== "synced"');
    expect(source).toContain("t.equipmentDetail.localStatePendingSync");
    expect(source).toContain("t.equipmentDetail.localStateConflict");
    expect(source).toContain("t.equipmentDetail.localStateSyncFailed");
    expect(source).toContain("vettrack:open-sync-queue");
  });
});
