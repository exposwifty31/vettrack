/**
 * @vitest-environment happy-dom
 *
 * S11.8–9 — locale copy and date formatting: a bare toLocaleDateString gives
 * an ambiguous all-numeric date ("8/26/2026" vs "26.8.2026"), and the Hebrew
 * pending-users heading must read in Hebrew word order, not English.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { z } from "zod";

import { formatDateByLocale, getCurrentLocale } from "@/lib/i18n";

// Noon UTC — same calendar day in any reasonable local timezone.
const SAMPLE_ISO = "2026-08-26T12:00:00.000Z";

describe("S11.8 — the default date format names its month", () => {
  it("no longer renders the bare numeric form that 26/08 vs 08/26 makes ambiguous", () => {
    const localeTag = getCurrentLocale() === "he" ? "he-IL" : "en-US";
    const bareNumeric = new Date(SAMPLE_ISO).toLocaleDateString(localeTag);

    const rendered = formatDateByLocale(SAMPLE_ISO);
    expect(rendered).not.toBe(bareNumeric);
    // A named month means at least one non-digit, non-separator character.
    expect(/[^\d\s./\-–,]/u.test(rendered)).toBe(true);
    expect(rendered).toBe(
      new Date(SAMPLE_ISO).toLocaleDateString(localeTag, { dateStyle: "medium" }),
    );
  });

  it("still lets an explicit options object win", () => {
    expect(formatDateByLocale(SAMPLE_ISO, { year: "numeric" })).toBe("2026");
  });
});

// ---------------------------------------------------------------------------
// S11.9 — locales: Hebrew word order in the admin pending-users heading
// ---------------------------------------------------------------------------

// JSON.parse returns `any`; validate the fields under test so a renamed or
// missing key fails here, loudly, instead of passing property access through.
const adminPageCopySchema = z.object({
  adminPage: z.object({
    pendingUsersTitle: z.string(),
    pendingEmpty: z.string(),
  }),
});

const readLocale = (name: string) =>
  adminPageCopySchema.parse(
    JSON.parse(readFileSync(resolve(process.cwd(), `locales/${name}.json`), "utf8")) as unknown,
  );

describe("S11.9 — the pending-users heading reads as Hebrew, not as English word order", () => {
  const he = readLocale("he");
  const en = readLocale("en");
  const NOUN = "משתמשים";
  const MODIFIER = "ממתינים";

  it("puts the noun before its modifier", () => {
    const title = he.adminPage.pendingUsersTitle;
    expect(title).toContain(NOUN);
    expect(title).toContain(MODIFIER);
    expect(title.indexOf(NOUN)).toBeLessThan(title.indexOf(MODIFIER));
  });

  it("matches the order its own sibling copy already uses", () => {
    // `pendingEmpty` ("אין משתמשים ממתינים") was always correct — it is the
    // in-file proof that the heading's order was the typo, not a house style.
    const empty = he.adminPage.pendingEmpty;
    expect(empty.indexOf(NOUN)).toBeLessThan(empty.indexOf(MODIFIER));
  });

  it("fails loudly when required admin copy is missing from a locale", () => {
    // The failure path of the schema itself: a locale that lost the heading
    // must fail validation at the parse, not surface as undefined downstream.
    expect(() => adminPageCopySchema.parse({ adminPage: { pendingEmpty: "x" } })).toThrow();
  });

  it("leaves the English side alone", () => {
    expect(en.adminPage.pendingUsersTitle).toBe("Pending users");
  });
});
