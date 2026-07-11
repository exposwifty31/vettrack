/**
 * T7 (HIGH audit fix) — the equipment-detail quick action bar rendered
 * hardcoded English literals ("In Use", "Move", "Status", "Issue", plus
 * "Return" and "Since {time}" in the same block) inside the Hebrew UI.
 *
 * The page (src/pages/equipment-detail.tsx) pulls in auth/react-query/API
 * dependencies too heavy for a focused render test, so — mirroring the
 * existing "confirm-path visibility contract" pattern in
 * tests/shift-csv-role-labels.test.ts — this is a source contract: each
 * action button must resolve its label from a `t.equipmentDetail.*` (or
 * shared `t.shiftSummaryPage.since`) accessor, and the bare English JSX
 * text nodes must be gone.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, "../src/pages/equipment-detail.tsx"), "utf8");

function blockAfter(testId: string, length: number): string {
  const marker = `data-testid="${testId}"`;
  const idx = source.indexOf(marker);
  expect(idx, `expected to find ${marker} in equipment-detail.tsx`).toBeGreaterThan(-1);
  return source.slice(idx, idx + length);
}

// The "quick-action-bar" div (In Use / Return / Issue / Status / Move + the
// in-use "Since {time}" indicator) is the exact surface the T7 audit flagged.
// Scoped deliberately: a separate, un-flagged NFC post-scan action sheet
// further down this same file (btn-scan-action-*) still has its own raw
// English copy ("Return", "Check Out", "Report Issue / Update Status") —
// out of scope for this task and asserted on elsewhere, so the "no bare
// literal" check below must not span that block too.
const quickActionBarStart = source.indexOf('data-testid="quick-action-bar"');
const quickActionBarEnd = source.indexOf("<EquipmentDetailStatusStrip", quickActionBarStart);
expect(quickActionBarStart, "expected to find the quick-action-bar div").toBeGreaterThan(-1);
expect(quickActionBarEnd, "expected to find EquipmentDetailStatusStrip after the quick-action-bar div").toBeGreaterThan(
  quickActionBarStart,
);
const quickActionBarBlock = source.slice(quickActionBarStart, quickActionBarEnd);

describe("equipment-detail quick action bar — i18n source contract (T7)", () => {
  it("btn-checkout ('In Use') resolves from t.equipmentDetail.actionInUse", () => {
    expect(blockAfter("btn-checkout", 350)).toContain("t.equipmentDetail.actionInUse");
  });

  it("btn-return ('Return') resolves from t.equipmentDetail.actionReturn", () => {
    expect(blockAfter("btn-return", 350)).toContain("t.equipmentDetail.actionReturn");
  });

  it("btn-report-issue ('Issue') resolves from t.equipmentDetail.actionIssue", () => {
    expect(blockAfter("btn-report-issue", 150)).toContain("t.equipmentDetail.actionIssue");
  });

  it("btn-scan ('Status') resolves from t.equipmentDetail.statusLabel", () => {
    expect(blockAfter("btn-scan", 150)).toContain("t.equipmentDetail.statusLabel");
  });

  it("btn-move-room ('Move') resolves from t.equipmentDetail.actionMove", () => {
    expect(blockAfter("btn-move-room", 150)).toContain("t.equipmentDetail.actionMove");
  });

  it("the in-use context indicator's 'Since {time}' reuses t.shiftSummaryPage.since", () => {
    expect(source).toContain("{t.shiftSummaryPage.since} {formatRelativeTime(equipment.checkedOutAt)}");
  });

  it("no longer renders the raw English action-bar literals as bare JSX text (scoped to quick-action-bar)", () => {
    expect(quickActionBarBlock).not.toMatch(/>\s*In Use\s*</);
    expect(quickActionBarBlock).not.toMatch(/\n\s*Move\s*\n/);
    expect(quickActionBarBlock).not.toMatch(/\n\s*Issue\s*\n/);
    expect(quickActionBarBlock).not.toMatch(/\n\s*Status\s*\n/);
    expect(quickActionBarBlock).not.toMatch(/\n\s*Return\s*\n/);
    expect(quickActionBarBlock).not.toMatch(/>Since \{formatRelativeTime/);
  });
});
