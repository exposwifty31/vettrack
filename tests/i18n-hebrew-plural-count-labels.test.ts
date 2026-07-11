/**
 * T9 audit-fix — Hebrew singular/plural for count labels.
 *
 * Bug: several `{n} <noun>` count labels rendered the plural Hebrew noun
 * even at count = 1 (e.g. "1 פריטים" — "1 items"), because the noun was a
 * static locale string concatenated with the count instead of an
 * ICU-plural-aware template. Mirrors the shape of the earlier
 * `shiftChat.panel.onlineCount` fix in tests/i18n-ux-audit-sweep.test.ts.
 *
 * Fixed surfaces (all routed through the existing `{count, plural, one{…}
 * other{…}}` ICU mechanism already used by `alerts.itemCount` etc. — see
 * lib/i18n/index.ts `interpolate()`):
 * - roomsListPage.cardItemCount (rooms card item/equipment count)
 * - dispense.sheet.itemsSelected (dispense flow selected-item count)
 * - managementDashboardPage.itemsUnit (equipment-count labels)
 * - managementDashboardPage.usersUnit (user-count label)
 */

import { describe, it, expect } from "vitest";
import enDict from "../locales/en.json";
import heDict from "../locales/he.json";
import { t } from "../src/lib/i18n";
import { interpolate } from "../lib/i18n/index";

function getPath(dict: unknown, dotted: string): unknown {
  return dotted
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined,
      dict,
    );
}

const NEW_OR_CHANGED_KEYS = [
  "roomsListPage.cardItemCount",
  "dispense.sheet.itemsSelected",
  "managementDashboardPage.itemsUnit",
  "managementDashboardPage.usersUnit",
];

describe("T9 sweep — plural-aware count keys exist in both locales", () => {
  for (const key of NEW_OR_CHANGED_KEYS) {
    it(`${key} is a string in en.json and he.json`, () => {
      expect(typeof getPath(enDict, key)).toBe("string");
      expect(typeof getPath(heDict, key)).toBe("string");
    });

    it(`${key} is an ICU plural expression in both locales`, () => {
      expect(getPath(enDict, key)).toContain("plural");
      expect(getPath(heDict, key)).toContain("plural");
    });
  }
});

describe("roomsListPage.cardItemCount — rooms card item/equipment count", () => {
  const enTemplate = enDict.roomsListPage.cardItemCount;
  const heTemplate = heDict.roomsListPage.cardItemCount;

  it("English renders '1 item' at count=1 and '2 items' at count=2", () => {
    expect(interpolate(enTemplate, { count: 1 })).toBe("1 item");
    expect(interpolate(enTemplate, { count: 2 })).toBe("2 items");
  });

  it("Hebrew renders the singular noun at count=1, not the plural (regression: '1 פריטים')", () => {
    const one = interpolate(heTemplate, { count: 1 });
    const two = interpolate(heTemplate, { count: 2 });
    expect(one).toBe("1 פריט");
    expect(two).toBe("2 פריטים");
    expect(one).not.toBe("1 פריטים");
    expect(one).not.toBe(two);
  });

  it("no ICU syntax leaks through in either locale", () => {
    for (const rendered of [
      interpolate(enTemplate, { count: 1 }),
      interpolate(heTemplate, { count: 1 }),
    ]) {
      expect(rendered).not.toContain("{");
      expect(rendered).not.toContain("plural");
    }
  });

  it("the typed accessor t.roomsListPage.cardItemCount resolves the plural form", () => {
    expect(t.roomsListPage.cardItemCount(1)).not.toContain("{");
    expect(t.roomsListPage.cardItemCount(2)).toContain("2");
  });
});

describe("dispense.sheet.itemsSelected — dispense flow selected-item count", () => {
  const enTemplate = enDict.dispense.sheet.itemsSelected;
  const heTemplate = heDict.dispense.sheet.itemsSelected;

  it("English renders '1 item selected' at count=1 and '2 items selected' at count=2", () => {
    expect(interpolate(enTemplate, { count: 1 })).toBe("1 item selected");
    expect(interpolate(enTemplate, { count: 2 })).toBe("2 items selected");
  });

  it("Hebrew renders the singular noun+verb agreement at count=1, not the plural (regression: '1 פריטים נבחרו')", () => {
    const one = interpolate(heTemplate, { count: 1 });
    const two = interpolate(heTemplate, { count: 2 });
    expect(one).toBe("1 פריט נבחר");
    expect(two).toBe("2 פריטים נבחרו");
    expect(one).not.toBe("1 פריטים נבחרו");
    expect(one).not.toBe(two);
  });

  it("the typed accessor t.dispense.sheet.itemsSelected resolves the plural form", () => {
    expect(t.dispense.sheet.itemsSelected(1)).not.toContain("{");
    expect(t.dispense.sheet.itemsSelected(2)).toContain("2");
  });
});

describe("managementDashboardPage.itemsUnit — equipment-count labels", () => {
  const enTemplate = enDict.managementDashboardPage.itemsUnit;
  const heTemplate = heDict.managementDashboardPage.itemsUnit;

  it("English renders '1 item' at count=1 and '2 items' at count=2", () => {
    expect(interpolate(enTemplate, { count: 1 })).toBe("1 item");
    expect(interpolate(enTemplate, { count: 2 })).toBe("2 items");
  });

  it("Hebrew renders the singular noun at count=1, not the plural (regression: '1 פריטים')", () => {
    const one = interpolate(heTemplate, { count: 1 });
    const two = interpolate(heTemplate, { count: 2 });
    expect(one).toBe("1 פריט");
    expect(two).toBe("2 פריטים");
    expect(one).not.toBe("1 פריטים");
    expect(one).not.toBe(two);
  });

  it("the typed accessor t.managementDashboardPage.itemsUnit resolves the plural form", () => {
    expect(t.managementDashboardPage.itemsUnit(1)).not.toContain("{");
    expect(t.managementDashboardPage.itemsUnit(2)).toContain("2");
  });
});

describe("managementDashboardPage.usersUnit — user-count label", () => {
  const enTemplate = enDict.managementDashboardPage.usersUnit;
  const heTemplate = heDict.managementDashboardPage.usersUnit;

  it("English renders '1 user' at count=1 and '2 users' at count=2", () => {
    expect(interpolate(enTemplate, { count: 1 })).toBe("1 user");
    expect(interpolate(enTemplate, { count: 2 })).toBe("2 users");
  });

  it("Hebrew renders the singular noun at count=1, not the plural (regression: '1 משתמשים')", () => {
    const one = interpolate(heTemplate, { count: 1 });
    const two = interpolate(heTemplate, { count: 2 });
    expect(one).toBe("1 משתמש");
    expect(two).toBe("2 משתמשים");
    expect(one).not.toBe("1 משתמשים");
    expect(one).not.toBe(two);
  });

  it("the typed accessor t.managementDashboardPage.usersUnit resolves the plural form", () => {
    expect(t.managementDashboardPage.usersUnit(1)).not.toContain("{");
    expect(t.managementDashboardPage.usersUnit(2)).toContain("2");
  });
});
