/**
 * UX-audit remediation Phase 7 — cross-surface dead-end fixes.
 *
 * Static source contracts (house phase-6-state-consistency style): each of the
 * five audited dead-ends now has a live wiring path.
 *
 *  1. Scanner "Mark Issue" (`/equipment/:id?action=issue`) — the slim native
 *     detail reads the param and mounts an issue sheet that submits the same
 *     scan-status-`issue` endpoint the desktop uses.
 *  2. Reservation-ready push — the slim detail renders `ReservationBanner`
 *     from the shared waitlist query and claims via `api.equipment.checkout`,
 *     gated on the active roster shift like every other ownership path.
 *  3. `vettrack:open-sync-queue` — a global listener + `SyncQueueSheet` mount
 *     lives in main.tsx (the legacy layout.tsx listener is mounted nowhere).
 *  4. iPad Home "View all" no longer deep-links the WebOnlyGuard-walled
 *     /audit-log on native.
 *  5. `/equipment?scan=1` forwards to /scan inside the mobile shell.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf-8");

describe("1 — Mark Issue works on the slim detail", () => {
  const screen = read("src/features/equipment/detail/EquipmentDetailScreen.tsx");
  const sheet = read("src/features/equipment/detail/ReportEquipmentIssueSheet.tsx");

  it("slim detail reads ?action=issue and opens the sheet", () => {
    expect(screen).toContain('get("action") === "issue"');
    expect(screen).toContain("<ReportEquipmentIssueSheet");
  });

  it("the sheet submits the scan-status-issue endpoint", () => {
    expect(sheet).toContain('api.equipment.scan(equipment.id, { status: "issue", note })');
    expect(sheet).toContain("t.equipmentDetail.toast.issueReported");
  });
});

describe("2 — reservation claim on the slim detail", () => {
  const screen = read("src/features/equipment/detail/EquipmentDetailScreen.tsx");

  it("uses the SAME waitlist query key as the desktop page", () => {
    expect(screen).toContain('queryKey: ["equipment-waitlist", equipmentId]');
    expect(read("src/pages/equipment-detail.tsx")).toContain(
      'queryKey: ["equipment-waitlist", id]',
    );
  });

  it("renders ReservationBanner wired to checkout", () => {
    expect(screen).toContain("<ReservationBanner");
    expect(screen).toContain("api.equipment.checkout(equipmentId)");
    expect(screen).toContain("shouldShowReservationBanner(");
  });

  it("keeps the off-shift ownership gate", () => {
    expect(screen).toContain("if (!hasActiveShift)");
    expect(screen).toContain("t.scan.offShiftBody");
  });
});

describe("3 — sync-queue viewer reachable everywhere", () => {
  it("GlobalSyncQueue listens for the open event and renders the sheet", () => {
    const source = read("src/components/global-sync-queue.tsx");
    expect(source).toContain('window.addEventListener("vettrack:open-sync-queue"');
    expect(source).toContain("<SyncQueueSheet");
  });

  it("main.tsx mounts GlobalSyncQueue next to SyncStatusBanner", () => {
    const main = read("src/main.tsx");
    expect(main).toContain("<GlobalSyncQueue />");
    expect(main.indexOf("<GlobalSyncQueue />")).toBeGreaterThan(
      main.indexOf("<SyncStatusBanner />"),
    );
  });

  it("dispatchers still exist (the event has consumers to serve)", () => {
    expect(read("src/lib/sync-engine.ts")).toContain(
      'new CustomEvent("vettrack:open-sync-queue")',
    );
    expect(read("src/pages/equipment-detail.tsx")).toContain(
      'new CustomEvent("vettrack:open-sync-queue")',
    );
  });
});

describe("4 — iPad Home View-all no longer bounces", () => {
  it("the /audit-log link is gated on !isCapacitorNative()", () => {
    const home = read("src/pages/home.tsx");
    const gateIdx = home.indexOf("{!isCapacitorNative() && (");
    const linkIdx = home.indexOf('href="/audit-log"');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(linkIdx).toBeGreaterThan(gateIdx);
  });
});

describe("5 — /equipment?scan=1 forwards to /scan in the shell", () => {
  it("the list page redirects instead of ignoring the param", () => {
    const list = read("src/pages/equipment-list.tsx");
    expect(list).toContain('inMobileShell && new URLSearchParams(searchStr).get("scan") === "1"');
    expect(list).toContain('navigate("/scan", { replace: true })');
  });
});
