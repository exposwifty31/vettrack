/**
 * Phase 4 (C1) — /board kiosk smoke (browser-driven Playwright).
 *
 * Verifies the standalone Command Center kiosk renders through BoardShell as a
 * chrome-free wall display, and that the relocated Phase-9 data path still polls
 * live. The auth-mode gate mirrors the phase-9 drills: CI runs the server in
 * dev-bypass so /board renders directly; against a Clerk-authed server the route
 * redirects to /signin and the test skips rather than asserting on the wrong page.
 *
 * Doctrine: assertions read only server-driven UI state; no client-authored
 * emergency state, no manual refresh.
 */
import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3001";

/** Navigate to /board; return false when the server bounced us to auth (not dev-bypass). */
async function gotoBoardOrSkip(page: Page): Promise<boolean> {
  await page.goto(`${BASE_URL}/board`);
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  const pathname = new URL(page.url()).pathname;
  return !(pathname.startsWith("/signin") || pathname.startsWith("/signup"));
}

test.describe("Phase 4 — /board kiosk smoke", () => {
  test("renders the BoardShell kiosk host, chrome-free", async ({ page }) => {
    const onBoard = await gotoBoardOrSkip(page);
    test.skip(!onBoard, "/board requires auth; server is not in dev-bypass mode");

    // BoardShell mounted (dark full-bleed kiosk host).
    await expect(page.locator("[data-board-shell]")).toBeVisible();

    // No global chat FAB — GlobalShiftChat is suppressed on the board target.
    await expect(page.locator('button:has-text("💬")')).toHaveCount(0);

    // No WebOnlyGuard "open on desktop" interstitial — /board is AuthGuard-only;
    // the platform target does the gating WebOnlyGuard would.
    await expect(page.locator('[data-testid="web-only-guard-screen"]')).toHaveCount(0);

    // The board content renders (live board, legacy fallback, or the loading
    // skeleton) — never a blank kiosk.
    await expect(
      page
        .locator(
          '[data-testid="board-skeleton"], [data-board-shell] main, [data-testid="ward-display-equipment-pane"]',
        )
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("polls the display snapshot live (no manual refresh)", async ({ page }) => {
    const onBoard = await gotoBoardOrSkip(page);
    test.skip(!onBoard, "/board requires auth; server is not in dev-bypass mode");

    // useDisplaySnapshot polls GET /api/display/snapshot on an interval — observe
    // at least one poll after load to confirm the relocated data path runs.
    const polled = await page
      .waitForResponse(
        (res) =>
          res.url().includes("/api/display/snapshot") && res.request().method() === "GET",
        { timeout: 12_000 },
      )
      .then(() => true)
      .catch(() => false);
    expect(polled).toBe(true);
  });
});
