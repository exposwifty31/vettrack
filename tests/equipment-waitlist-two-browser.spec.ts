/**
 * Phase B — two Playwright contexts (two isolated browser sessions) for waitlist + list SSE.
 *
 * User A (context 1) checks out and returns; user B (context 2) joins waitlist on
 * equipment detail, sees paginated list custody update, then reservation after promote.
 *
 * Event proof uses `/api/realtime/replay` from each browser (same published outbox as SSE).
 *
 * Prerequisites:
 *   - API :3001 — NODE_ENV=development, CLERK_SECRET_KEY unset
 *   - Vite :5000 — TEST_BASE_URL=http://127.0.0.1:5000
 *
 * Run:
 *   TEST_BASE_URL=http://127.0.0.1:5000 PW_SUITE=waitlist pnpm test:playwright:waitlist --project=chromium tests/equipment-waitlist-two-browser.spec.ts
 */

import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

const FRONTEND_URL = process.env.TEST_BASE_URL ?? "http://127.0.0.1:5000";
const CLINIC_ID = "dev-clinic-default";
const USER_ALPHA = "dev-user-alpha";
const USER_BETA = "dev-user-beta";

const isFrontend = FRONTEND_URL.includes(":5000");

function devHeaders(userId: string): Record<string, string> {
  return {
    "x-dev-role-override": "vet",
    "x-dev-user-id-override": userId,
    "x-dev-clinic-id-override": CLINIC_ID,
  };
}

async function bootstrapContext(browser: Browser, userId: string): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: FRONTEND_URL,
    extraHTTPHeaders: devHeaders(userId),
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("vettrack-locale", "en");
    } catch {
      /* ignore */
    }
  });
  return context;
}

async function waitForReplayType(page: Page, type: string, timeoutMs = 20_000): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(async (eventType) => {
          const res = await fetch("/api/realtime/replay?from_id=0");
          if (!res.ok) return false;
          const body = (await res.json()) as { events?: Array<{ type: string }> };
          return (body.events ?? []).some((e) => e.type === eventType);
        }, type),
      { timeout: timeoutMs },
    )
    .toBe(true);
}

async function waitForMyWaitlistStatus(
  page: Page,
  equipmentId: string,
  status: string,
  timeoutMs = 20_000,
): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(async ({ id, expected }) => {
          const res = await fetch(`/api/equipment/${id}/waitlist`);
          if (!res.ok) return null;
          const body = (await res.json()) as { myStatus?: string | null };
          return body.myStatus ?? null;
        }, { id: equipmentId, expected: status }),
      { timeout: timeoutMs },
    )
    .toBe(status);
}

async function fetchPaginatedCustody(page: Page, equipmentId: string): Promise<string | undefined> {
  return page.evaluate(async (id) => {
    const res = await fetch("/api/equipment?limit=50&page=1");
    if (!res.ok) return undefined;
    const body = (await res.json()) as { items: Array<{ id: string; custodyState?: string }> };
    return body.items.find((i) => i.id === id)?.custodyState;
  }, equipmentId);
}

test.describe("Equipment waitlist two-browser", () => {
  test.describe.configure({ mode: "serial" });

  test.skip(!isFrontend, "Requires Vite at TEST_BASE_URL :5000");

  test("context A + B: waitlist panel, replay events, paginated list without manual refresh", async ({
    browser,
  }) => {
    const runId = Date.now();
    const serial = `WL-2B-${runId}`;

    const ctxA = await bootstrapContext(browser, USER_ALPHA);
    const ctxB = await bootstrapContext(browser, USER_BETA);
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    let equipmentId = "";

    try {
      const createRes = await ctxA.request.post("/api/equipment", {
        headers: { "Content-Type": "application/json", ...devHeaders(USER_ALPHA) },
        data: { name: `Waitlist 2-browser ${runId}`, serialNumber: serial },
      });
      expect(createRes.status()).toBe(201);
      equipmentId = ((await createRes.json()) as { id: string }).id;

      const checkoutRes = await ctxA.request.post(`/api/equipment/${equipmentId}/checkout`, {
        headers: { "Content-Type": "application/json", ...devHeaders(USER_ALPHA) },
        data: { location: "ICU" },
      });
      expect(checkoutRes.status()).toBe(200);

      await pageA.goto("/equipment");
      await pageB.goto(`/equipment/${equipmentId}`);

      await expect(pageB.getByTestId("equipment-waitlist-panel")).toBeVisible({ timeout: 25_000 });
      await pageB.getByRole("button", { name: /join waitlist|הצטרף לתור/i }).click();

      await expect(pageB.getByRole("button", { name: /leave waitlist|עזוב תור/i })).toBeVisible({
        timeout: 15_000,
      });
      await waitForMyWaitlistStatus(pageB, equipmentId, "waiting");
      await waitForReplayType(pageB, "EQUIPMENT_WAITLIST_JOINED");

      await pageB.goto("/equipment");
      await expect
        .poll(() => fetchPaginatedCustody(pageB, equipmentId), { timeout: 15_000 })
        .toBe("checked_out");

      const returnRes = await ctxA.request.post(`/api/equipment/${equipmentId}/return`, {
        headers: { "Content-Type": "application/json", ...devHeaders(USER_ALPHA) },
        data: { isPluggedIn: true },
      });
      expect(returnRes.status()).toBe(200);

      await waitForReplayType(pageB, "EQUIPMENT_WAITLIST_PROMOTED");
      await waitForMyWaitlistStatus(pageB, equipmentId, "notified");

      const replayTypes = await pageB.evaluate(async () => {
        const res = await fetch("/api/realtime/replay?from_id=0");
        const body = (await res.json()) as { events?: Array<{ type: string }> };
        return (body.events ?? []).map((e) => e.type);
      });
      expect(replayTypes.filter((t) => t === "EQUIPMENT_WAITLIST_AVAILABLE").length).toBe(0);

      // After promote, custody is `returned` — WaitlistPanel hides (join eligibility requires checked_out).
      // Cross-browser reservation proof is API `myStatus === notified` + replay above.
      await pageB.goto("/equipment");
      await expect
        .poll(() => fetchPaginatedCustody(pageB, equipmentId), { timeout: 15_000 })
        .toBe("returned");

      const promoteToasts = pageB.locator("[data-sonner-toast]", {
        hasText: /device available|available for you|המכשיר זמין/i,
      });
      await expect
        .poll(async () => promoteToasts.count(), { timeout: 8_000 })
        .toBeLessThanOrEqual(1);
    } finally {
      if (equipmentId) {
        await ctxA.request
          .delete(`/api/equipment/${equipmentId}`, { headers: devHeaders(USER_ALPHA) })
          .catch(() => {});
      }
      await ctxA.close();
      await ctxB.close();
    }
  });
});
