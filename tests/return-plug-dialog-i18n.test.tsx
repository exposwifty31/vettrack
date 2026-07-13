/**
 * @vitest-environment happy-dom
 *
 * F-1 (device audit 2026-07-13): ReturnPlugDialog rendered its plug-status
 * copy as hardcoded English on the Hebrew-default app. Under the He locale the
 * dialog must render localized strings and leak no English literal.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ReturnPlugDialog } from "@/components/return-plug-dialog";
import { refreshTranslations, t } from "@/lib/i18n";

afterEach(() => {
  cleanup();
  refreshTranslations(); // restore the stored/default locale
});

describe("ReturnPlugDialog i18n (F-1)", () => {
  it("renders localized copy under the Hebrew locale — no hardcoded English", async () => {
    refreshTranslations("he");
    render(
      <ReturnPlugDialog
        open
        equipmentName="מכשיר בדיקה"
        allowDamagedReport
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    // Localized copy present.
    expect(await screen.findByText(t.returnPlugDialog.title)).toBeTruthy();
    expect(screen.getByText(t.returnPlugDialog.pluggedIn)).toBeTruthy();
    expect(screen.getByText(t.returnPlugDialog.notPluggedIn)).toBeTruthy();
    expect(screen.getByText(t.returnPlugDialog.cancel)).toBeTruthy();
    expect(screen.getByText(t.returnPlugDialog.confirmPluggedIn)).toBeTruthy();

    // No English literal leaks under the Hebrew locale.
    for (const english of ["Return Equipment", "Plugged In", "Not Plugged In", "Cancel", "Confirm — Plugged In ✓"]) {
      expect(screen.queryByText(english)).toBeNull();
    }
  });
});
