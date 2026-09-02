/**
 * @vitest-environment happy-dom
 *
 * Track A / Phase 2 — `/dashboard` critical alerts. That section is a flat stack of
 * clickable card rows at every width; on a management browser it should be a dense,
 * sortable table. (The other two sections — "who has what" and "location overview" —
 * are group-by accordions, not flat card lists, and are deliberately untouched.)
 *
 * Rows mix two shapes: legacy `CriticalItem` (free-text `reason`, issue/missing
 * status) and `ManagementRecoveryCriticalRow` (`kind: "recovery"`, i18n `reasonKey`).
 * The table must label both correctly — that discrimination is the interesting part.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { t } from "@/lib/i18n";
import type { CriticalItem } from "@/lib/dashboard-utils";
import type { ManagementRecoveryCriticalRow } from "@/lib/management-dashboard-recovery";

import { CriticalAlertsTable } from "@/pages/dashboard/desktop/CriticalAlertsTable";

const LEGACY: CriticalItem = {
  id: "e1",
  name: "Ultrasound A",
  reason: "Not seen in 24h",
  location: "ICU 1",
  status: "issue",
};
const RECOVERY: ManagementRecoveryCriticalRow = {
  id: "e2",
  name: "Infusion Pump",
  location: null,
  kind: "recovery",
  reasonKey: "recoveryReasonStale",
};
const ROWS = [LEGACY, RECOVERY];

function renderTable(rows: Array<CriticalItem | ManagementRecoveryCriticalRow>) {
  const { hook, history } = memoryLocation({ path: "/dashboard", record: true });
  return { history, ...render(<Router hook={hook}><CriticalAlertsTable items={rows} /></Router>) };
}

afterEach(() => cleanup());

describe("CriticalAlertsTable — dense desktop body for the /dashboard critical section", () => {
  it("renders a table with name, reason, location and status headers", () => {
    renderTable(ROWS);

    expect(document.querySelector("table")).toBeTruthy();
    for (const header of [
      t.console.colName,
      t.console.colReason,
      t.console.colRoom,
      t.console.colStatus,
    ]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeTruthy();
    }
    expect(screen.getAllByRole("row")).toHaveLength(ROWS.length + 1);
  });

  it("labels a legacy issue row with its free-text reason and issue status", () => {
    renderTable(ROWS);

    expect(screen.getByText("Not seen in 24h")).toBeTruthy();
    expect(screen.getByText(t.managementDashboardPage.issue)).toBeTruthy();
  });

  it("labels a recovery row from its i18n reasonKey, not free text", () => {
    renderTable(ROWS);

    // The recovery reason appears in both the reason cell and the status badge.
    expect(
      screen.getAllByText(t.managementDashboardPage.recoveryReasonStale).length,
    ).toBeGreaterThan(0);
  });

  it("navigates to the equipment detail route when a row is clicked", () => {
    const { history } = renderTable(ROWS);

    fireEvent.click(screen.getByText("Ultrasound A"));

    expect(history[history.length - 1]).toBe("/equipment/e1");
  });

  it("bidi-isolates the item name in the RTL console", () => {
    renderTable(ROWS);
    expect(screen.getByText("Ultrasound A").closest("bdi")?.getAttribute("dir")).toBe("auto");
  });

  it("renders the all-clear copy instead of a table when nothing is critical", () => {
    renderTable([]);

    expect(document.querySelector("table")).toBeNull();
    expect(screen.getByText(t.managementDashboardPage.allGood)).toBeTruthy();
  });
});
