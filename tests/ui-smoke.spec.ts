/**
 * VetTrack UI Smoke Test Suite
 *
 * Signs in with real Clerk credentials, then visits every route and
 * takes a screenshot. Asserts no React crash / blank page.
 *
 * Set credentials via env vars before running:
 *   $env:PLAYWRIGHT_EMAIL="you@example.com"
 *   $env:PLAYWRIGHT_PASSWORD="yourpassword"
 *
 * Run:
 *   npx playwright test --config=playwright.ui.config.ts --reporter=list
 */

import { test, expect, Page, ConsoleMessage } from "@playwright/test";
import path from "path";
import fs from "fs";

// ─── Config ───────────────────────────────────────────────────────────────────

const SCREENSHOTS_DIR = path.join(process.cwd(), "playwright-ui-screenshots");

if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// Detect the Playwright-CI / local-E2E runtime: PLAYWRIGHT_E2E is the explicit
// server-side flag set by the workflow, and a localhost/127.0.0.1 TEST_BASE_URL
// is the load-bearing signal that the bundle is being served by Express against
// an origin Clerk's FAPI rejects. In either case, window.Clerk?.loaded will
// never become true, so waiting for it is a 20s no-op that burns the per-test
// budget. For real non-E2E runs (e.g. pointing at a deployed environment with
// a valid Clerk origin), the wait remains in effect.
const IS_E2E_RUNTIME =
  process.env.PLAYWRIGHT_E2E === "true" ||
  /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(process.env.TEST_BASE_URL ?? "");

// ─── Routes ───────────────────────────────────────────────────────────────────

const PUBLIC_ROUTES = [
  { name: "landing", path: "/landing" },
  { name: "signin",  path: "/signin"  },
  { name: "signup",  path: "/signup"  },
];

const AUTH_ROUTES = [
  { name: "home",             path: "/"                          },
  { name: "alerts",           path: "/alerts"                    },
  { name: "analytics",        path: "/analytics"                 },
  { name: "appointments",     path: "/appointments"              },
  { name: "audit-log",        path: "/audit-log"                 },
  { name: "billing",          path: "/billing"                   },
  { name: "code-blue",        path: "/code-blue"                 },
  { name: "dashboard",        path: "/dashboard"                 },
  { name: "equipment",        path: "/equipment"                 },
  { name: "equipment-new",    path: "/equipment/new"             },
  { name: "help",             path: "/help"                      },
  { name: "inventory",        path: "/inventory"                 },
  { name: "inventory-items",  path: "/inventory-items"           },
  { name: "meds",             path: "/meds"                      },
  { name: "my-equipment",     path: "/my-equipment"              },
  { name: "print",            path: "/print"                     },
  { name: "procurement",      path: "/procurement"               },
  { name: "rooms",            path: "/rooms"                     },
  { name: "settings",         path: "/settings"                  },
  { name: "shift-handover",   path: "/shift-handover"            },
  { name: "stability",        path: "/stability"                 },
  { name: "admin",            path: "/admin"                     },
  { name: "admin-shifts",     path: "/admin/shifts"              },
  { name: "whats-new",        path: "/whats-new"                 },
  // Detail routes — placeholder IDs, app should show empty/404 state, not crash
  { name: "equipment-detail", path: "/equipment/smoke-test-id"   },
  { name: "equipment-qr",     path: "/equipment/smoke-test-id/qr"},
  { name: "rooms-detail",     path: "/rooms/smoke-test-id"       },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CRASH_PATTERNS = [
  /something went wrong/i,
  /application error/i,
  /unexpected error/i,
  /cannot read propert/i,
  /is not a function/i,
  /is not defined/i,
];

const IGNORE_CONSOLE = [
  /favicon/i,
  /service.worker/i,
  /\[HMR\]/i,
  /\[vite\]/i,
  /clerk/i,
  /ResizeObserver/i,
  /Non-Error promise rejection/i,
];

async function visitPage(page: Page, route: { name: string; path: string }) {
  const errors: string[] = [];

  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (IGNORE_CONSOLE.some((rx) => rx.test(text))) return;
    errors.push(text);
  };

  page.on("console", onConsole);
  const screenshotPath = path.join(SCREENSHOTS_DIR, `${route.name}.png`);

  try {
    await page.goto(route.path, { waitUntil: "domcontentloaded", timeout: 20_000 });

    // Wait for Clerk to finish its FAPI round-trip and validate the stored session.
    // Skipped under PLAYWRIGHT_E2E / localhost runtime: Clerk's FAPI rejects
    // 127.0.0.1 origins, so Clerk.loaded never becomes true and the wait would
    // burn its full 20s budget on every test × every retry — which is what made
    // the suite appear hung in CI. Real non-E2E runs (deployed environment with
    // a valid Clerk origin) keep the original wait.
    if (!IS_E2E_RUNTIME) {
      await page
        .waitForFunction(
          () => {
            const w = window as unknown as { Clerk?: { loaded?: boolean } };
            return w.Clerk?.loaded === true;
          },
          { timeout: 20_000 }
        )
        .catch(() => {
          // Public pages (signin/signup embed Clerk differently; landing has no Clerk)
        });
    }

    // If Clerk redirected us to /signin mid-load (session check failed transiently),
    // give it a few extra seconds to recover and redirect back.
    if (page.url().includes("/signin") && !route.path.endsWith("/signin")) {
      await page
        .waitForURL((url) => !url.href.includes("/signin"), { timeout: 8_000 })
        .catch(() => {/* auth assertion below will surface the failure */});
    }

    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {
      // Non-fatal for pages with persistent polling / Clerk FAPI in E2E mode
    });
    await page.waitForTimeout(250);

    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {
      // Don't fail the route test just because the screenshot couldn't be written.
    });
  } finally {
    // Always detach the console listener — leaving it attached leaks closures
    // across retries and (more importantly) the previous structure could skip
    // this on test timeout.
    page.off("console", onConsole);
  }

  return { errors, screenshotPath };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
// Session is injected via playwright.ui.config.ts globalSetup + storageState

test.describe("VetTrack UI Smoke Tests", () => {

  test("API server health check", async ({ request }) => {
    const res = await request.get("/api/healthz").catch(() => null);
    if (!res) {
      console.warn("[WARN] /api/healthz unreachable — API server may not be running");
    } else {
      console.log(`[API] /api/healthz → ${res.status()}`);
    }
  });

  for (const route of PUBLIC_ROUTES) {
    test(`[public] ${route.name} (${route.path})`, async ({ page }) => {
      const { errors } = await visitPage(page, route);

      const bodyHtml = await page.locator("body").innerHTML();
      expect(bodyHtml.trim().length, `${route.path} — page body is empty`).toBeGreaterThan(0);

      const pageText = (await page.content()).toLowerCase();
      for (const pattern of CRASH_PATTERNS) {
        expect(pattern.test(pageText), `${route.path} — React crash: ${pattern}`).toBe(false);
      }

      if (errors.length) console.warn(`[WARN] ${route.path}:\n  ${errors.join("\n  ")}`);
    });
  }

  for (const route of AUTH_ROUTES) {
    test(`[auth] ${route.name} (${route.path})`, async ({ page }) => {
      const { errors } = await visitPage(page, route);

      // Must not redirect back to signin (session should be valid)
      const finalUrl = page.url();
      expect(finalUrl, `${route.path} — redirected to signin, auth failed`).not.toContain("/signin");

      // Must have page content
      const bodyHtml = await page.locator("body").innerHTML();
      expect(bodyHtml.trim().length, `${route.path} — page body is empty`).toBeGreaterThan(0);

      // Must not show React error boundary crash
      const pageText = (await page.content()).toLowerCase();
      for (const pattern of CRASH_PATTERNS) {
        expect(pattern.test(pageText), `${route.path} — React crash: ${pattern}`).toBe(false);
      }

      console.log(`[OK] ${route.path} → ${finalUrl}`);
      if (errors.length) console.warn(`[WARN] ${route.path}:\n  ${errors.join("\n  ")}`);
    });
  }

  test("404 — unknown route renders not-found page", async ({ page }) => {
    await visitPage(page, { name: "not-found", path: "/this-route-does-not-exist-404" });
    const bodyHtml = await page.locator("body").innerHTML() ?? "";
    expect(bodyHtml.trim().length, "404 page body is empty").toBeGreaterThan(0);
  });

  test("screenshots summary", async () => {
    const files = fs.readdirSync(SCREENSHOTS_DIR).filter((f) => f.endsWith(".png"));
    console.log(`\n📸 ${files.length} screenshots saved to: ${SCREENSHOTS_DIR}`);
    for (const f of files.sort()) console.log(`   ${f}`);
    expect(files.length).toBeGreaterThan(0);
  });
});
