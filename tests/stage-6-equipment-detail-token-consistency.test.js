import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Stage 6 — Equipment Detail (mobile screen) LOCK (static source assertions).
 *
 * Increment 1 gaps from the Stage 6 prototype (detail screen):
 *  - an iOS back-button header row (was: no back affordance);
 *  - an "At a glance" 4-tile fact grid (Location / Assignee / Last scan / Due),
 *    wired to real Equipment + LocationInference fields, token-driven;
 *  - i18n-complete: the pull-to-refresh copy moves off hardcoded English onto
 *    the hand-wired equipmentDetail namespace.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(repoRoot, ...p), "utf8");

const screen = read("src", "features", "equipment", "detail", "EquipmentDetailScreen.tsx");
const grid = read("src", "features", "equipment", "detail", "EquipmentGlanceGrid.tsx");
const service = read("src", "features", "equipment", "detail", "EquipmentServiceCard.tsx");
const locCard = read("src", "features", "equipment", "detail", "EquipmentLocationCard.tsx");
const actions = read("src", "features", "equipment", "detail", "EquipmentActions.tsx");
const i18n = read("src", "lib", "i18n.ts");
const en = read("locales", "en.json");
const he = read("locales", "he.json");

const BANNED = /\b(emerald|amber|zinc|indigo|slate)-[0-9]|#[0-9a-fA-F]{6}/;

describe("Stage 6 detail — back-button header", () => {
  it("renders a back control using the equipmentDetail.back copy", () => {
    expect(screen.includes("t.equipmentDetail.back")).toBe(true);
    expect(screen.includes('data-testid="btn-detail-back"')).toBe(true);
  });
});

describe("Stage 6 detail — at-a-glance grid", () => {
  it("renders the EquipmentGlanceGrid with the At a glance heading", () => {
    expect(screen.includes("EquipmentGlanceGrid")).toBe(true);
    expect(grid.includes("t.equipmentDetail.atGlance")).toBe(true);
  });
  it("uses a responsive fact grid (2-up) via CSS grid tokens", () => {
    expect(grid.includes("gridTemplateColumns")).toBe(true);
    expect(grid.includes("repeat(2, minmax(0, 1fr))")).toBe(true);
  });
  it("wires the four real-data tiles", () => {
    expect(grid.includes("t.equipmentDetail.location")).toBe(true);
    expect(grid.includes("t.equipmentDetail.assignee")).toBe(true);
    expect(grid.includes("t.equipmentDetail.lastScan")).toBe(true);
    expect(grid.includes("t.equipmentDetail.due")).toBe(true);
  });
  it("consumes theme tokens, not hardcoded palette", () => {
    expect(grid.includes("hsl(var(--")).toBe(true);
    expect(BANNED.test(grid)).toBe(false);
  });
});

describe("Stage 6 detail — service-schedule card", () => {
  it("is rendered from the detail screen", () => {
    expect(screen.includes("EquipmentServiceCard")).toBe(true);
  });
  it("gates on real maintenance data (no fabrication)", () => {
    expect(service.includes("lastMaintenanceDate")).toBe(true);
    expect(service.includes("maintenanceIntervalDays")).toBe(true);
    expect(/if\s*\(!.*lastMaintenanceDate\s*\|\|\s*!.*maintenanceIntervalDays\)\s*return null/.test(service)).toBe(true);
  });
  it("uses status HSL tokens for the progress bar, not palette", () => {
    expect(service.includes("hsl(var(--status-")).toBe(true);
    expect(service.includes("t.equipmentDetail.serviceSchedule")).toBe(true);
    expect(BANNED.test(service)).toBe(false);
  });
});

describe("Stage 6 detail — location card confidence ladder", () => {
  it("maps confidence dots to sys tokens (medium = blue), no hardcoded hex", () => {
    expect(locCard.includes("rgb(var(--sys-green))")).toBe(true);
    expect(locCard.includes("medium: \"rgb(var(--sys-blue))\"")).toBe(true);
    expect(locCard.includes("rgb(var(--sys-gray))")).toBe(true);
    expect(locCard.includes("rgb(var(--sys-red))")).toBe(true);
    expect(/#[0-9a-fA-F]{6}/.test(locCard)).toBe(false);
  });
});

describe("Stage 6 detail — actions (Check in)", () => {
  it("is rendered from the detail screen", () => {
    expect(screen.includes("EquipmentActions")).toBe(true);
  });
  it("wires a real return via api.equipment.return + the shared UnifiedReturnDialog", () => {
    // Docking P2 (T2.3-mobile): the standalone ReturnPlugDialog was collapsed
    // into UnifiedReturnDialog on the mobile detail (home-station toggle). The
    // unchecked/plain-return path still routes through this file's own returnMut
    // → api.equipment.return, so the behavioral guarantee is unchanged.
    expect(actions.includes("api.equipment.return")).toBe(true);
    expect(actions.includes("UnifiedReturnDialog")).toBe(true);
    expect(actions.includes("t.equipmentDetail.checkIn")).toBe(true);
  });
  it("only offers return to the holder or an admin", () => {
    expect(actions.includes("checkedOutByMe")).toBe(true);
    expect(actions.includes("const canReturn = isCheckedOut && (checkedOutByMe || isAdmin);")).toBe(true);
  });
  it("does NOT shift-gate return (you can always hand equipment back)", () => {
    const returnMutBlock = actions.slice(actions.indexOf("const returnMut ="), actions.indexOf("const checkoutMut ="));
    expect(returnMutBlock.includes("hasActiveShift")).toBe(false);
    expect(returnMutBlock.includes("offShift")).toBe(false);
  });
});

describe("Stage 6 detail — actions (Checkout / take)", () => {
  it("wires a real checkout via api.equipment.checkout", () => {
    expect(actions.includes("api.equipment.checkout")).toBe(true);
    expect(actions.includes("t.equipmentList.quickAction.checkout")).toBe(true);
  });
  it("gates checkout on availability (not held, status ok, not returned)", () => {
    expect(
      actions.includes(
        'const canCheckout =\n    !isCheckedOut && equipment.status === "ok" && equipment.custodyState !== "returned";',
      ),
    ).toBe(true);
  });
  it("shift-gates checkout only (roster gate), deferring to the server on a shift-query error", () => {
    expect(actions.includes("hasActiveShift")).toBe(true);
    expect(actions.includes("t.scan.offShiftBody")).toBe(true);
  });
});

describe("Stage 6 detail — i18n complete", () => {
  it("moves pull-to-refresh copy off hardcoded English", () => {
    expect(screen.includes("Pull to refresh")).toBe(false);
    expect(screen.includes("Release to refresh")).toBe(false);
    expect(screen.includes("t.equipmentDetail.pullToRefresh")).toBe(true);
    expect(screen.includes("t.equipmentDetail.releaseToRefresh")).toBe(true);
  });
  it("wires the new keys in the hand-listed equipmentDetail accessor", () => {
    for (const k of ["back", "atGlance", "assignee", "lastScan", "due", "unassigned", "pullToRefresh", "releaseToRefresh"]) {
      expect(i18n.includes(`${k}: d.equipmentDetail.${k}`)).toBe(true);
    }
  });
  it("has en/he entries for the new keys", () => {
    for (const k of ["atGlance", "assignee", "lastScan", "pullToRefresh"]) {
      expect(en.includes(`"${k}"`)).toBe(true);
      expect(he.includes(`"${k}"`)).toBe(true);
    }
  });
});
