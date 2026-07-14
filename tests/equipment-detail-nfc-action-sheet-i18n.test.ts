/**
 * T12 (LOW audit sweep, T7 residual) — the NFC post-scan action sheet in
 * src/pages/equipment-detail.tsx ("btn-scan-action-*" block) still hardcoded
 * English literals ("Check Out", "Return", "Report Issue / Update Status",
 * "View Full Details", the return-permission line, "In use by {email}",
 * "Scan Another Item", "Stay Here") — T7 only localized the separate
 * "quick-action-bar" main action bar (see
 * tests/equipment-detail-action-bar-i18n.test.ts), explicitly leaving this
 * sheet out of scope.
 *
 * The page pulls in auth/react-query/API dependencies too heavy for a
 * focused render test (same constraint T7 documented), so — mirroring T7's
 * "confirm-path visibility contract" pattern — this is a two-part contract:
 *   1. Source contract: every label in the sheet resolves from a `t.*`
 *      accessor, and no bare English literal remains.
 *   2. Value contract: those same accessors resolve to the real Hebrew
 *      copy from locales/he.json when the locale is switched to `he`,
 *      proving the wiring actually renders Hebrew (not just "some t.*").
 */
import { describe, expect, it, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { t, refreshTranslations } from "@/lib/i18n";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, "../src/pages/equipment-detail.tsx"), "utf8");

const sheetStart = source.indexOf("{/* Checkout info if currently out */}");
const sheetEnd = source.indexOf("<EquipmentDetailToolsSheet", sheetStart);
expect(sheetStart, "expected to find the NFC post-scan action sheet's checkout-info comment").toBeGreaterThan(-1);
expect(sheetEnd, "expected to find EquipmentDetailToolsSheet after the sheet block").toBeGreaterThan(sheetStart);
const sheetBlock = source.slice(sheetStart, sheetEnd);

function blockAfter(testId: string, length: number): string {
  const marker = `data-testid="${testId}"`;
  const idx = source.indexOf(marker);
  expect(idx, `expected to find ${marker} in equipment-detail.tsx`).toBeGreaterThan(-1);
  return source.slice(idx, idx + length);
}

describe("equipment-detail NFC post-scan action sheet — i18n source contract (T12)", () => {
  it("'In use by {email}' line reuses t.equipmentDetail.checkedOutBy / toast.checkedOutByYou", () => {
    expect(sheetBlock).toContain("t.equipmentDetail.toast.checkedOutByYou");
    expect(sheetBlock).toContain("t.equipmentDetail.checkedOutBy(equipment.checkedOutByEmail || t.common.unknown)");
  });

  it("btn-scan-action-checkout ('Check Out') reuses t.qrScanner.checkOut", () => {
    expect(blockAfter("btn-scan-action-checkout", 350)).toContain("t.qrScanner.checkOut");
  });

  it("btn-scan-action-return ('Return') reuses t.equipmentDetail.actionReturn", () => {
    expect(blockAfter("btn-scan-action-return", 350)).toContain("t.equipmentDetail.actionReturn");
  });

  it("the return-permission line reuses t.qrScanner.onlyOwnerCanReturn", () => {
    expect(sheetBlock).toContain("t.qrScanner.onlyOwnerCanReturn");
  });

  it("btn-scan-action-report-issue ('Report Issue / Update Status') resolves from t.equipmentDetail.scanSheetReportOrUpdateStatus", () => {
    expect(blockAfter("btn-scan-action-report-issue", 250)).toContain("t.equipmentDetail.scanSheetReportOrUpdateStatus");
  });

  it("btn-scan-action-dismiss ('View Full Details') reuses t.qrScanner.viewFullDetails", () => {
    expect(blockAfter("btn-scan-action-dismiss", 250)).toContain("t.qrScanner.viewFullDetails");
  });

  it("btn-scan-another-item ('Scan Another Item') resolves from t.equipmentDetail.scanSheetScanAnother", () => {
    expect(blockAfter("btn-scan-another-item", 250)).toContain("t.equipmentDetail.scanSheetScanAnother");
  });

  it("'Stay Here' resolves from t.equipmentDetail.scanSheetStayHere", () => {
    expect(sheetBlock).toContain("t.equipmentDetail.scanSheetStayHere");
  });

  it("no bare English literals remain anywhere in the sheet block", () => {
    expect(sheetBlock).not.toMatch(/>\s*Check Out\s*</);
    expect(sheetBlock).not.toMatch(/\n\s*Return\s*\n/);
    expect(sheetBlock).not.toMatch(/Only the person who checked this out/);
    expect(sheetBlock).not.toMatch(/Report Issue \/ Update Status/);
    expect(sheetBlock).not.toMatch(/View Full Details/);
    expect(sheetBlock).not.toMatch(/Scan Another Item/);
    expect(sheetBlock).not.toMatch(/\n\s*Stay Here\s*\n/);
    expect(sheetBlock).not.toMatch(/In use by \$\{/);
  });
});

describe("equipment-detail NFC post-scan action sheet — resolved Hebrew values (T12)", () => {
  beforeEach(() => refreshTranslations("he"));

  it("resolves every sheet label to its real Hebrew copy under the he locale", () => {
    expect(t.qrScanner.checkOut).toBe("שלח לשימוש");
    expect(t.equipmentDetail.actionReturn).toBe("החזר");
    expect(t.qrScanner.onlyOwnerCanReturn).toBe(
      "רק מי שהוציא את הציוד לשימוש — או מנהל — יכול להחזיר אותו.",
    );
    expect(t.equipmentDetail.scanSheetReportOrUpdateStatus).toBe("דיווח על תקלה / עדכון סטטוס");
    expect(t.qrScanner.viewFullDetails).toBe("פרטים מלאים");
    expect(t.equipmentDetail.scanSheetScanAnother).toBe("סרוק פריט נוסף");
    expect(t.equipmentDetail.scanSheetStayHere).toBe("הישאר כאן");
    expect(t.equipmentDetail.toast.checkedOutByYou).toBe("הוצא לשימוש על ידך");
    expect(t.equipmentDetail.checkedOutBy("tech@clinic.test")).toBe("בשימוש על ידי tech@clinic.test");
  });

  it("falls back through t.common.unknown when checkedOutByEmail is absent", () => {
    expect(t.equipmentDetail.checkedOutBy(t.common.unknown)).toContain(t.common.unknown);
  });
});
