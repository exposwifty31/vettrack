/**
 * T12 (LOW audit sweep) — two small findings that don't warrant their own
 * dedicated render harness (the owning pages are too heavy for a focused
 * render test, matching the documented constraint in
 * tests/equipment-detail-action-bar-i18n.test.ts):
 *
 * 1. Document titles — the browser tab <title> hardcoded English
 *    ("Dashboard — VetTrack", "Equipment — VetTrack") even under the
 *    Hebrew locale, while sibling pages (Audit Log, What's New,
 *    Procurement) already routed their title through `t.*`. Fixed by
 *    reusing the existing `t.layoutHebrew.dashboard` / `t.equipment.title`
 *    accessors instead of adding new ones.
 *
 * 2. Casing — `t.nav.criticalKitCheck` ("Critical Kit Check") rendered
 *    Title Case next to its sentence-case siblings on the VetHomeSurface
 *    "Clinical actions" quick-action list (t.homeSurface.roomReadiness =
 *    "Room readiness"). `t.layout.nav.criticalKitCheck` (the main
 *    sidebar/menu — src/components/layout.tsx) is a SEPARATE key whose own
 *    siblings ("Equipment Command Board", "Emergency Equipment Log") are
 *    consistently Title Case, so it is deliberately left untouched.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { t, refreshTranslations } from "@/lib/i18n";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readSrc(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, "..", relPath), "utf8");
}

describe("document titles resolve from t.* (T12)", () => {
  it("HomeTabletDashboard's <title> reuses t.layoutHebrew.dashboard, not a bare 'Dashboard' literal", () => {
    const source = readSrc("src/features/today/HomeTabletDashboard.tsx");
    expect(source).toContain("<title>{t.layoutHebrew.dashboard} — VetTrack</title>");
    expect(source).not.toMatch(/<title>Dashboard — VetTrack<\/title>/);
  });

  it("HomeShell's <title> reuses t.layoutHebrew.dashboard, not a bare 'Dashboard' literal", () => {
    const source = readSrc("src/features/today/surfaces/HomeShell.tsx");
    expect(source).toContain("<title>{t.layoutHebrew.dashboard} — VetTrack</title>");
    expect(source).not.toMatch(/<title>Dashboard — VetTrack<\/title>/);
  });

  it("equipment-list's <title> reuses t.equipment.title, not a bare 'Equipment' literal", () => {
    const source = readSrc("src/pages/equipment-list.tsx");
    expect(source).toContain("<title>{t.equipment.title} — VetTrack</title>");
    expect(source).not.toMatch(/<title>Equipment — VetTrack<\/title>/);
  });

  it("resolves to the real Hebrew document-title copy under the he locale", () => {
    refreshTranslations("he");
    expect(t.layoutHebrew.dashboard).toBe("לוח בקרה");
    expect(t.equipment.title).toBe("ציוד");
  });
});

describe("'Critical kit check' sentence-case fix — VetHomeSurface quick-actions (T12)", () => {
  beforeEach(() => refreshTranslations("en"));

  it("t.nav.criticalKitCheck is sentence case, matching its VetHomeSurface sibling t.homeSurface.roomReadiness", () => {
    expect(t.nav.criticalKitCheck).toBe("Critical kit check");
    expect(t.nav.criticalKitCheck).not.toBe("Critical Kit Check");
    // Same casing shape as its direct rendered sibling on the Clinical
    // actions quick-action list (VetActionRow list in VetHomeSurface.tsx).
    expect(t.homeSurface.roomReadiness).toBe("Room readiness");
    const sentenceCase = /^[A-Z][a-z]+(?: [a-z]+)+$/;
    expect(t.nav.criticalKitCheck).toMatch(sentenceCase);
    expect(t.homeSurface.roomReadiness).toMatch(sentenceCase);
  });

  it("t.layout.nav.criticalKitCheck (main sidebar/menu) is deliberately left Title Case, matching ITS siblings", () => {
    expect(t.layout.nav.criticalKitCheck).toBe("Critical Kit Check");
    expect(t.layout.nav.equipmentCommandBoard).toBe("Equipment Command Board");
    expect(t.layout.nav.emergencyEquipmentLog).toBe("Emergency Equipment Log");
  });

  it("VetHomeSurface renders the criticalKitCheck action row from t.nav.criticalKitCheck (source contract)", () => {
    const source = readSrc("src/features/today/surfaces/VetHomeSurface.tsx");
    expect(source).toContain("label={t.nav.criticalKitCheck}");
  });
});
