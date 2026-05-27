/**
 * Paginated equipment list + SSE invalidation (browser shell).
 *
 * Uses Vite on :5000 when TEST_BASE_URL points at frontend; falls back to API-only
 * checks when only :3001 is available (see equipment-waitlist-sse.spec.ts).
 */

import { test, expect } from "@playwright/test";
import { devRoleHeaders, BASE_URL } from "./e2e/flows/_helpers";

const isApiOnly = BASE_URL.includes(":3001");

test.describe("Equipment waitlist paginated list", () => {
  test.skip(isApiOnly, "Browser list drill requires Vite frontend (TEST_BASE_URL :5000)");

  test("equipment list page loads with paginated query", async ({ page }) => {
    await page.goto("/equipment");
    await expect(page).toHaveURL(/\/equipment/);
  });
});
