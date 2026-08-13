/**
 * TV board phase 1 (Task 14) — visual board states (browser-driven Playwright).
 *
 * Drives the /board?tv=1 kiosk through each BoardStateKind by fulfilling
 * `/api/display/snapshot` with fixture JSON (route interception — zero server
 * changes, the poll contract itself stays frozen), then asserts the state
 * strip + stage per state and captures a full-viewport screenshot.
 *
 * Screenshot comparison is gated by `PW_VISUAL=1` (playwright.shared.ts sets
 * `ignoreSnapshots` otherwise): baselines are platform-specific and the repo
 * has no prior visual-regression infra, so CI runs the functional assertions
 * unconditionally and compares pixels only where baselines were generated
 * (locally: `PW_VISUAL=1 pnpm exec playwright test --update-snapshots`).
 *
 * Auth gate mirrors board-kiosk.spec.ts: CI runs dev-bypass so /board renders;
 * against a Clerk-authed server the route redirects to /signin and the test
 * skips rather than asserting on the wrong page.
 */
import { test, expect, type Page } from "@playwright/test";
import type { BoardResponsibles, DisplaySnapshot } from "../src/types/safety-surfaces";
import type { EquipmentCommandBoardSnapshot } from "../shared/equipment-board";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3001";
const NOW_ISO = "2026-08-13T10:18:00.000Z";

// 1080p TV viewport; block service workers so page.route always sees the
// snapshot poll (the SW's network passthrough would otherwise originate the
// request outside the page's interception scope).
test.use({ viewport: { width: 1920, height: 1080 }, serviceWorkers: "block" });

const filledResponsibles: BoardResponsibles = {
  doctors: {
    icu: { senior: { name: "Dr A", since: NOW_ISO }, members: [] },
    admission: { senior: { name: "Dr B", since: NOW_ISO }, members: [] },
    internal_medicine: { senior: { name: "Dr C", since: NOW_ISO }, members: [] },
  },
  seniorTechnician: { name: "Tech D" },
  equipmentCoordinator: { name: "Coord E", status: "auto" },
};

function makeBoard(
  over: Partial<EquipmentCommandBoardSnapshot> = {},
): EquipmentCommandBoardSnapshot {
  return {
    generatedAt: NOW_ISO,
    clinicId: "c1",
    overview: {
      totalCritical: 12,
      ready: 12,
      inUse: 0,
      blocked: 0,
      stale: 0,
      overdue: 0,
      unknown: 0,
      belowThresholdTypes: 0,
      activeEmergencyUnits: 0,
    },
    byType: [
      {
        typeId: "ty-vent",
        typeName: "Ventilator",
        total: 4,
        ready: 4,
        inUse: 0,
        blocked: 0,
        stale: 0,
        overdue: 0,
        unknown: 0,
        belowMinimumReady: false,
      },
      {
        typeId: "ty-defib",
        typeName: "Defibrillator",
        total: 8,
        ready: 8,
        inUse: 0,
        blocked: 0,
        stale: 0,
        overdue: 0,
        unknown: 0,
        belowMinimumReady: false,
      },
    ],
    byLocation: [],
    criticalUnits: [],
    alerts: [],
    roiSignals: {
      overusedUnits: [],
      underusedUnits: [],
      repairReplaceCandidates: [],
      typeShortages: [],
      duplicatePurchaseRisks: [],
    },
    power: { plugged: 10, unplugged: 2, alert: 0 },
    docks: { total: 6, occupied: 4, ready: 4 },
    waitlist: { depth: 0 },
    staging: { depth: 0 },
    ...over,
  };
}

function makeSnapshot(over: Partial<DisplaySnapshot> = {}): DisplaySnapshot {
  return {
    currentTime: NOW_ISO,
    currentShift: [
      { employeeName: "Dana", role: "vet_tech" },
      { employeeName: "Noa", role: "senior_technician" },
    ],
    hospitalizations: [],
    equipment: [],
    upcomingTasks: [],
    overdueTasks: [],
    activeAlertCount: 0,
    totalOverdueCount: 0,
    crashCartStatus: null,
    codeBlueSession: null,
    commandBoard: makeBoard(),
    responsibles: filledResponsibles,
    ...over,
  };
}

/** Serve the fixture snapshot for every poll via route interception (no teardown). */
async function serveSnapshot(page: Page, snapshot: DisplaySnapshot): Promise<void> {
  await page.route("**/api/display/snapshot", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    }),
  );
}

/**
 * Navigate to /board?tv=1; false when the server bounced us to auth (not
 * dev-bypass) or is not serving the SPA at all (a plain `pnpm dev` API server
 * only serves the frontend under PLAYWRIGHT_E2E=true / production).
 */
async function gotoBoardOrSkip(page: Page): Promise<boolean> {
  await page.goto(`${BASE_URL}/board?tv=1`);
  // domcontentloaded may already have fired, or the SPA may redirect before it — the
  // pathname / #root checks below are what decide onBoard, so a late or aborted
  // load-state is not itself a failure worth propagating.
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  const pathname = new URL(page.url()).pathname;
  if (pathname.startsWith("/signin") || pathname.startsWith("/signup")) return false;
  return (await page.locator("#root").count()) > 0;
}

test.describe("TV board phase 1 — visual board states", () => {
  test("all_clear — evidence composition with monitored-equipment tiles", async ({ page }) => {
    await serveSnapshot(page, makeSnapshot());
    const onBoard = await gotoBoardOrSkip(page);
    test.skip(!onBoard, "/board requires auth; server is not in dev-bypass mode");

    await expect(page.getByTestId("board-state-strip")).toHaveAttribute("data-state", "all_clear");
    await expect(page.getByTestId("board-allclear")).toBeVisible();
    // Absent ≠ zero inverse: present blocks render real figures, no unknown card.
    await expect(page.getByTestId("board-block-unknown")).toHaveCount(0);
    await expect(page).toHaveScreenshot("board-all_clear.png", { maxDiffPixelRatio: 0.02 });
  });

  test("alert — locked stage with exception cards", async ({ page }) => {
    const board = makeBoard({
      overview: {
        totalCritical: 12,
        ready: 10,
        inUse: 0,
        blocked: 2,
        stale: 0,
        overdue: 0,
        unknown: 0,
        belowThresholdTypes: 0,
        activeEmergencyUnits: 0,
      },
      criticalUnits: [
        {
          equipmentId: "u-vent-1",
          displayName: "Ventilator 1",
          typeName: "Ventilator",
          status: "blocked",
          blockingReasons: ["maintenance"],
          citationsCount: 1,
          truthHref: "#",
          lastEvidenceAt: "2026-08-13T09:36:00.000Z",
        },
        {
          equipmentId: "u-defib-2",
          displayName: "Defibrillator 2",
          typeName: "Defibrillator",
          status: "unknown",
          blockingReasons: [],
          citationsCount: 0,
          truthHref: "#",
          lastEvidenceAt: "2026-08-13T09:58:00.000Z",
        },
      ],
    });
    await serveSnapshot(page, makeSnapshot({ commandBoard: board }));
    const onBoard = await gotoBoardOrSkip(page);
    test.skip(!onBoard, "/board requires auth; server is not in dev-bypass mode");

    await expect(page.getByTestId("board-state-strip")).toHaveAttribute("data-state", "alert");
    await expect(page.getByTestId("board-unit-row-u-vent-1")).toBeVisible();
    await expect(page.getByTestId("board-unit-row-u-vent-1")).toHaveAttribute(
      "data-severity",
      "blocked",
    );
    await expect(page).toHaveScreenshot("board-alert.png", { maxDiffPixelRatio: 0.02 });
  });

  test("attention — non-zero waitlist depth", async ({ page }) => {
    await serveSnapshot(
      page,
      makeSnapshot({ commandBoard: makeBoard({ waitlist: { depth: 2 } }) }),
    );
    const onBoard = await gotoBoardOrSkip(page);
    test.skip(!onBoard, "/board requires auth; server is not in dev-bypass mode");

    await expect(page.getByTestId("board-state-strip")).toHaveAttribute("data-state", "attention");
    await expect(page).toHaveScreenshot("board-attention.png", { maxDiffPixelRatio: 0.02 });
  });

  test("unconfigured — takeover, no success glyph, muted-unknown bands", async ({ page }) => {
    await serveSnapshot(page, makeSnapshot({ commandBoard: null }));
    const onBoard = await gotoBoardOrSkip(page);
    test.skip(!onBoard, "/board requires auth; server is not in dev-bypass mode");

    await expect(page.getByTestId("board-state-strip")).toHaveAttribute(
      "data-state",
      "unconfigured",
    );
    const takeover = page.getByTestId("board-takeover");
    await expect(takeover).toBeVisible();
    await expect(takeover).toHaveAttribute("data-kind", "unconfigured");
    // Absent ≠ zero: the bottom band renders muted-unknown cards, never zeros.
    // Web-first (polls until the band renders) — never a one-shot count read.
    await expect(page.getByTestId("board-block-unknown").first()).toBeVisible();
    await expect(page.getByTestId("board-allclear")).toHaveCount(0);
    await expect(page).toHaveScreenshot("board-unconfigured.png", { maxDiffPixelRatio: 0.02 });
  });

  test("stale — connection loss escalates to the last-known takeover", async ({ page }) => {
    // The tracker flips to `stale` after STALE_AFTER_MISSED_POLLS (15) consecutive
    // missed poll cycles (pinned in tests/use-display-connection.test.ts) — ≈2 min at
    // the ~8 s failed-cycle cadence. Slow by design (cadence-aware, exit-only); the
    // 180 s test budget + 150 s assertion timeout leave margin over the ~2 min floor.
    test.setTimeout(180_000);
    let served = false;
    await page.route("**/api/display/snapshot", (route) => {
      if (served) return route.abort("connectionrefused");
      served = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeSnapshot()),
      });
    });
    const onBoard = await gotoBoardOrSkip(page);
    test.skip(!onBoard, "/board requires auth; server is not in dev-bypass mode");

    // First (only) successful poll renders a quiet board…
    await expect(page.getByTestId("board-state-strip")).toHaveAttribute("data-state", "all_clear");
    // …then missed polls escalate live → delayed → stale (exit-only takeover).
    await expect(page.getByTestId("board-state-strip")).toHaveAttribute("data-state", "stale", {
      timeout: 150_000,
    });
    const takeover = page.getByTestId("board-takeover");
    await expect(takeover).toHaveAttribute("data-kind", "stale");
    // Last-known state stays on screen, labeled — never silently zeroed.
    await expect(page.getByTestId("board-lastknown")).toContainText("12/12");
  });
});
