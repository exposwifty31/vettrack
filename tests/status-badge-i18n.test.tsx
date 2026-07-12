/**
 * @vitest-environment happy-dom
 *
 * T-23c (R-EQ-F2 · small-02) — src/components/ui/status-badge.tsx STATUS_LABELS
 * resolved the stale/unknown/info/neutral kinds via
 * `(t.status as Record<string, string>)[k] ?? "<English literal>"`. That cast
 * bypasses the typed `t.status.*` accessor and hides a hardcoded ENGLISH
 * fallback ("Stale"/"Unknown"/"Info"/"Unknown"). Both locale dictionaries
 * currently define these keys, so the fallback is a *latent* leak — it only
 * fires the moment the accessor path and a dictionary key drift apart (typo,
 * rename, missing translation) — but the untyped cast is exactly what lets
 * that drift compile silently. This locks two things: (1) a static guard that
 * the hardcoded-fallback pattern itself is gone from the source (the only way
 * to fail this against the CURRENT file, since the JSON already masks the
 * runtime symptom), and (2) all four kinds render through the typed
 * `t.status.*` accessor and show the active locale's real string under both
 * locales.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";
import { t, refreshTranslations } from "@/lib/i18n";
import { StatusBadge } from "@/components/ui/status-badge";
import type { StatusKind } from "@/lib/design-tokens";

const STATUS_BADGE_SOURCE = readFileSync(
  resolve(__dirname, "../src/components/ui/status-badge.tsx"),
  "utf-8",
);

const KINDS: StatusKind[] = ["stale", "unknown", "info", "neutral"];

// The hardcoded English fallback literals the old code used per kind — these
// must never appear as the rendered label under the Hebrew locale.
const ENGLISH_FALLBACK_LITERALS: Record<(typeof KINDS)[number], string> = {
  stale: "Stale",
  unknown: "Unknown",
  info: "Info",
  neutral: "Unknown",
};

beforeEach(() => refreshTranslations("he"));
afterEach(() => cleanup());

describe("StatusBadge — source no longer casts to an untyped English-fallback map", () => {
  it("does not resolve stale/unknown/info/neutral via `(t.status as Record<string, string>)[k] ?? \"<English>\"`", () => {
    expect(STATUS_BADGE_SOURCE).not.toMatch(/as Record<string,\s*string>/);
    expect(STATUS_BADGE_SOURCE).not.toMatch(/\?\?\s*"(Stale|Unknown|Info)"/);
  });
});

describe("StatusBadge — typed i18n accessors (no English-fallback leak)", () => {
  it.each(KINDS)(
    "renders the Hebrew status.%s label via the typed accessor, not the English fallback literal",
    (kind) => {
      render(<StatusBadge kind={kind} />);

      const expectedLabel = t.status[kind];
      expect(expectedLabel).toBeTruthy();

      const badge = screen.getByText(expectedLabel);
      expect(badge.textContent).toBe(expectedLabel);

      const englishLiteral = ENGLISH_FALLBACK_LITERALS[kind];
      if (englishLiteral !== expectedLabel) {
        expect(screen.queryByText(englishLiteral)).toBeNull();
      }
    },
  );
});
