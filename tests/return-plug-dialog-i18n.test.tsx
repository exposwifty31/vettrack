/**
 * @vitest-environment happy-dom
 *
 * F-1 (device audit 2026-07-13): ReturnPlugDialog rendered its plug-status
 * copy as hardcoded English on the Hebrew-default app. Under the He locale the
 * dialog must render localized strings for EVERY branch (header, both plug
 * choices, the not-plugged alert warning + deadline label + confirm, and the
 * damaged branch) and leak no English literal.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReturnPlugDialog } from "@/components/return-plug-dialog";
import { refreshTranslations, t } from "@/lib/i18n";

afterEach(() => {
  cleanup();
  refreshTranslations(); // restore the stored/default locale
});

const ENGLISH_LITERALS = [
  "Return Equipment",
  "Plugged In",
  "Not Plugged In",
  "Cancel",
  "Confirm — Plugged In ✓",
  "Set Alert & Return",
  "Alert deadline (minutes)",
];

describe("ReturnPlugDialog i18n (F-1)", () => {
  it("renders localized copy for every branch under the Hebrew locale — no hardcoded English", async () => {
    refreshTranslations("he");
    render(
      <ReturnPlugDialog
        open
        equipmentName="EQ-42"
        allowDamagedReport
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    // Header + interpolated description(equipmentName).
    expect(await screen.findByText(t.returnPlugDialog.title)).toBeTruthy();
    expect(screen.getByText(t.returnPlugDialog.description("EQ-42"))).toBeTruthy();

    // Plug choices + cancel + default (plugged) confirm.
    expect(screen.getByText(t.returnPlugDialog.pluggedIn)).toBeTruthy();
    expect(screen.getByText(t.returnPlugDialog.notPluggedIn)).toBeTruthy();
    expect(screen.getByText(t.returnPlugDialog.cancel)).toBeTruthy();
    expect(screen.getByText(t.returnPlugDialog.confirmPluggedIn)).toBeTruthy();

    // Not-plugged branch: alert warning (interpolated minutes), deadline label, its confirm.
    fireEvent.click(screen.getByTestId("btn-plugged-no"));
    expect(screen.getByText(t.returnPlugDialog.plugAlertWarning(30))).toBeTruthy();
    expect(screen.getByText(t.returnPlugDialog.deadlineLabel)).toBeTruthy();
    expect(screen.getByText(t.returnPlugDialog.confirmSetAlert)).toBeTruthy();

    // Damaged branch: warning + its confirm.
    fireEvent.click(screen.getByTestId("btn-returned-damaged"));
    expect(screen.getByText(t.returnPlugDialog.damageWarning)).toBeTruthy();
    expect(screen.getByText(t.returnPlugDialog.confirmReturnedDamaged)).toBeTruthy();

    // No English literal leaks under the Hebrew locale.
    for (const english of ENGLISH_LITERALS) {
      expect(screen.queryByText(english)).toBeNull();
    }
  });
});
