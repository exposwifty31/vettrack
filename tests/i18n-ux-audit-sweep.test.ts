/**
 * UX-audit remediation Phase 5 — M1 localization sweep contracts.
 *
 * - New locale keys added by the sweep exist in BOTH locales (parity is
 *   separately enforced by i18n-parity.test.ts; this pins the exact paths
 *   the code now depends on).
 * - `equipmentStatusLabel` resolves through `t.status.*` (Hebrew default)
 *   instead of the legacy English STATUS_LABELS dict, including the two
 *   statuses that were missing from the locale files (critical /
 *   needs_attention), and falls back to the raw status for unknowns.
 * - `shiftChat.panel.onlineCount` is an ICU plural ("1 מחוברים" bug):
 *   singular and plural forms diverge and no ICU syntax leaks through.
 * - `locationCard.reasoning.dock/scan` interpolate their params (the
 *   location card now composes reasoning client-side from signalSource).
 */

import { describe, it, expect } from "vitest";
import enDict from "../locales/en.json";
import heDict from "../locales/he.json";
import { t } from "../src/lib/i18n";
import { interpolate } from "../lib/i18n/index";
import { equipmentStatusLabel } from "../src/lib/equipment-status-label";

function getPath(dict: unknown, dotted: string): unknown {
  return dotted
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined,
      dict,
    );
}

const NEW_KEYS = [
  "appointmentsPage.todayHeading",
  "appointmentsPage.whyThisTask",
  "appointmentsPage.noEligibleTechnicians",
  "status.critical",
  "status.needs_attention",
  "roomRadarPage.unknownHolder",
  "roomRadarPage.roomFallback",
  "roomRadarPage.nfcVerifyAllBody",
  "roomsListPage.healthRingTitle",
  "roomsListPage.healthRingHelp",
  "equipmentDetail.locationCard.reasoning.dock",
  "equipmentDetail.locationCard.reasoning.scan",
];

describe("Phase 5 sweep — new locale keys exist in both locales", () => {
  for (const key of NEW_KEYS) {
    it(`${key} is a string in en.json and he.json`, () => {
      expect(typeof getPath(enDict, key)).toBe("string");
      expect(typeof getPath(heDict, key)).toBe("string");
    });
  }
});

describe("equipmentStatusLabel — t.status.* is the source of truth", () => {
  const heStatus = heDict.status as Record<string, unknown>;

  it("resolves every locale-backed status to the Hebrew value (default locale)", () => {
    for (const [status, label] of Object.entries(heStatus)) {
      if (typeof label !== "string") continue;
      expect(equipmentStatusLabel(status)).toBe(label);
    }
  });

  it("covers the statuses that used to leak English (critical / needs_attention)", () => {
    expect(equipmentStatusLabel("critical")).toBe(heStatus.critical);
    expect(equipmentStatusLabel("needs_attention")).toBe(heStatus.needs_attention);
    expect(equipmentStatusLabel("needs_attention")).not.toBe("Needs Attention");
  });

  it("falls back to the raw status string for unknown statuses", () => {
    expect(equipmentStatusLabel("__no_such_status__")).toBe("__no_such_status__");
  });
});

describe("shiftChat.panel.onlineCount — ICU plural", () => {
  const enTemplate = enDict.shiftChat.panel.onlineCount;
  const heTemplate = heDict.shiftChat.panel.onlineCount;

  it("both locale templates are ICU plural expressions", () => {
    expect(enTemplate).toContain("plural");
    expect(heTemplate).toContain("plural");
  });

  it("English renders '1 online' / '3 online'", () => {
    expect(interpolate(enTemplate, { count: 1 })).toBe("1 online");
    expect(interpolate(enTemplate, { count: 3 })).toBe("3 online");
  });

  it("Hebrew singular and plural diverge with no ICU syntax leaking", () => {
    const one = interpolate(heTemplate, { count: 1 });
    const three = interpolate(heTemplate, { count: 3 });
    expect(one).not.toBe(three);
    expect(three).toContain("3");
    for (const rendered of [one, three]) {
      expect(rendered).not.toContain("#");
      expect(rendered).not.toContain("{");
      expect(rendered).not.toContain("plural");
    }
  });

  it("the typed accessor resolves the plural form", () => {
    const rendered = t.shiftChat.panel.onlineCount(2);
    expect(rendered).toContain("2");
    expect(rendered).not.toContain("#");
  });
});

describe("locationCard.reasoning — client-side composition params", () => {
  it("dock interpolates the room", () => {
    const rendered = t.equipmentDetail.locationCard.reasoning.dock("ICU-1");
    expect(rendered).toContain("ICU-1");
    expect(rendered).not.toContain("{room}");
  });

  it("scan interpolates the person", () => {
    const rendered = t.equipmentDetail.locationCard.reasoning.scan("dan@example.com");
    expect(rendered).toContain("dan@example.com");
    expect(rendered).not.toContain("{email}");
  });
});
