/**
 * Full authenticated staging UI walkthrough — personas, routes, permissions, artifacts.
 *
 * Prerequisites: pnpm staging:seed (see docs/staging-e2e-runbook.md)
 *
 * Run:
 *   STAGING_E2E_CONFIRM=yes STAGING_E2E_PASSWORD=... \
 *   DATABASE_URL=... CLERK_SECRET_KEY=sk_test_... \
 *   TEST_BASE_URL=https://vettrack-staging.up.railway.app \
 *   pnpm test:staging:walkthrough
 */
import { test, expect, devices } from "@playwright/test";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import {
  assertStagingPlaywrightEnv,
  loadManifest,
  personaByKey,
  STAGING_BASE_URL,
  type StagingPersonaKey,
} from "./staging/fixtures.js";
import { signInStagingPersona, signOutStaging } from "./staging/helpers.js";
import { expectedOutcome, routesForPersona } from "./staging/walkthrough-routes.js";
import {
  artifactDir,
  attachPageObservers,
  assertAccessDeniedSurface,
  assertAuthGateBlocked,
  assertAuthGatePending,
  assertNoCrashSurface,
  captureRouteScreenshot,
  evaluateRoutePass,
  openMobileMenuIfNeeded,
  waitForAppSettled,
  type RouteCheckResult,
} from "./staging/walkthrough-utils.js";

const PERSONA_ORDER: StagingPersonaKey[] = [
  "admin",
  "vet",
  "technician",
  "student",
  "pending",
  "blocked",
];

const matrixResults: RouteCheckResult[] = [];

test.beforeAll(() => {
  assertStagingPlaywrightEnv();
  const manifest = loadManifest();
  if (!manifest?.personas?.length) {
    throw new Error(
      "Missing .staging-e2e-manifest.json — run `pnpm staging:seed` before staging walkthrough",
    );
  }
});

test.describe.serial("Staging full walkthrough", () => {
  test("public health and startup", async ({ request }) => {
    const hz = await request.get(`${STAGING_BASE_URL}/api/healthz`);
    expect(hz.status()).toBe(200);
    const startup = await request.get(`${STAGING_BASE_URL}/api/health/startup`);
    expect(startup.status()).toBe(200);
    const body = (await startup.json()) as { checks: Record<string, unknown> };
    expect(body.checks.databaseReachable).toBe(true);
    expect(body.checks.hasClerkSecretKey).toBe(true);
  });

  for (const personaKey of PERSONA_ORDER) {
    test(`UI walkthrough — ${personaKey}`, async ({ page }) => {
      const persona = personaByKey(personaKey);
      const { consoleErrors, failedRequests } = attachPageObservers(page);

      await signInStagingPersona(page, persona);

      if (personaKey === "pending") {
        let gatePass = true;
        let gateNotes: string | undefined;
        try {
          await assertAuthGatePending(page);
        } catch (err) {
          gatePass = false;
          gateNotes = err instanceof Error ? err.message : String(err);
        }
        const shot = await captureRouteScreenshot(page, personaKey, "auth-pending-gate");
        matrixResults.push({
          persona: personaKey,
          route: "auth-gate",
          path: "/home",
          expectation: "auth_gate_pending",
          pass: gatePass,
          finalUrl: page.url(),
          consoleErrors: [...consoleErrors],
          failedRequests: [...failedRequests],
          screenshot: shot,
          notes: gateNotes,
        });
        expect(gatePass, gateNotes ?? "pending auth gate").toBe(true);
        await signOutStaging(page);
        return;
      }

      if (personaKey === "blocked") {
        let gatePass = true;
        let gateNotes: string | undefined;
        try {
          await assertAuthGateBlocked(page);
        } catch (err) {
          gatePass = false;
          gateNotes = err instanceof Error ? err.message : String(err);
        }
        const shot = await captureRouteScreenshot(page, personaKey, "auth-blocked-gate");
        matrixResults.push({
          persona: personaKey,
          route: "auth-gate",
          path: "/home",
          expectation: "auth_gate_blocked",
          pass: gatePass,
          finalUrl: page.url(),
          consoleErrors: [...consoleErrors],
          failedRequests: [...failedRequests],
          screenshot: shot,
          notes: gateNotes,
        });
        expect(gatePass, gateNotes ?? "blocked auth gate").toBe(true);
        await signOutStaging(page);
        return;
      }

      const routes = routesForPersona(personaKey);

      for (const route of routes) {
        const expectation = expectedOutcome(route, personaKey);
        if (route.menuOnly) {
          await openMobileMenuIfNeeded(page);
        }

        await page.goto(route.path, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await waitForAppSettled(page);

        const finalUrl = page.url();
        let pass = true;
        let notes: string | undefined;

        try {
          if (expectation === "loads") {
            await assertNoCrashSurface(page);
          } else if (expectation === "access_denied") {
            await assertAccessDeniedSurface(page);
          }
          const evalResult = evaluateRoutePass({
            expectation,
            finalUrl,
            path: route.path,
            consoleErrors,
            failedRequests,
          });
          pass = evalResult.pass;
          notes = evalResult.notes;
        } catch (err) {
          pass = false;
          notes = err instanceof Error ? err.message : String(err);
        }

        const screenshot = await captureRouteScreenshot(page, personaKey, route.slug);
        matrixResults.push({
          persona: personaKey,
          route: route.slug,
          path: route.path,
          expectation,
          pass,
          finalUrl,
          consoleErrors: [...consoleErrors],
          failedRequests: [...failedRequests],
          screenshot,
          notes,
        });

        expect.soft(pass, `${personaKey} ${route.path}: ${notes ?? "failed"}`).toBe(true);
      }

      // Scanner overlay (layout bottom nav) — staging-safe open/close
      await page.goto("/equipment", { waitUntil: "domcontentloaded" });
      await waitForAppSettled(page);
      const scanBtn = page
        .locator('button[aria-label*="scan" i], button[aria-label*="QR" i]')
        .first();
      if (await scanBtn.isVisible().catch(() => false)) {
        await scanBtn.click({ timeout: 8_000 }).catch(() => {});
        await page.waitForTimeout(600);
        const overlay = page.locator('[class*="scanner"], video, canvas').first();
        const scannerVisible = await overlay.isVisible().catch(() => false);
        await captureRouteScreenshot(page, personaKey, "scanner-overlay");
        matrixResults.push({
          persona: personaKey,
          route: "scanner-overlay",
          path: "/equipment",
          expectation: "loads",
          pass: scannerVisible,
          finalUrl: page.url(),
          consoleErrors: [...consoleErrors],
          failedRequests: [...failedRequests],
          notes: scannerVisible ? undefined : "Scanner overlay not visible after click",
        });
        await page.keyboard.press("Escape").catch(() => {});
      }

      // Realtime: ward display should attempt SSE (not WebSocket)
      if (["admin", "vet", "technician"].includes(personaKey)) {
        const sseSeen: string[] = [];
        const onResponse = (res: { url: () => string; status: () => number }) => {
          const u = res.url();
          if (u.includes("/api/realtime/stream")) {
            sseSeen.push(`${res.status()} stream`);
          }
        };
        page.on("response", onResponse);
        await page.goto("/display", { waitUntil: "domcontentloaded", timeout: 45_000 });
        await waitForAppSettled(page);
        await page.waitForTimeout(3_000);
        page.off("response", onResponse);
        const shot = await captureRouteScreenshot(page, personaKey, "display-realtime");
        const realtimePass =
          sseSeen.length > 0 && sseSeen.some((entry) => entry.startsWith("200"));
        matrixResults.push({
          persona: personaKey,
          route: "display-realtime",
          path: "/display",
          expectation: "loads",
          pass: realtimePass,
          finalUrl: page.url(),
          consoleErrors: [...consoleErrors],
          failedRequests: [...failedRequests],
          screenshot: shot,
          notes: sseSeen.length ? `SSE: ${sseSeen.join(",")}` : "No /api/realtime/stream response observed",
        });
        expect.soft(realtimePass, `${personaKey} display realtime`).toBe(true);
      }

      // Code Blue page UI (no session start unless vet already passed API gate elsewhere)
      if (personaKey === "admin" || personaKey === "vet" || personaKey === "technician") {
        await page.goto("/code-blue", { waitUntil: "domcontentloaded" });
        await waitForAppSettled(page);
        await assertNoCrashSurface(page);
        await captureRouteScreenshot(page, personaKey, "code-blue-ui");
      }

      await signOutStaging(page);
    });
  }

  test("mobile viewport sanity — technician home", async ({ browser }) => {
    const manifest = loadManifest();
    if (!manifest) throw new Error("manifest missing");
    const context = await browser.newContext({
      ...devices["iPhone 13"],
      baseURL: STAGING_BASE_URL,
    });
    const page = await context.newPage();
    const { consoleErrors, failedRequests } = attachPageObservers(page);
    await signInStagingPersona(page, personaByKey("technician"));
    await page.goto("/home", { waitUntil: "domcontentloaded" });
    await waitForAppSettled(page);
    await assertNoCrashSurface(page);
    const shot = join(artifactDir("technician"), "home-mobile.png");
    await page.screenshot({ path: shot, fullPage: true });
    matrixResults.push({
      persona: "technician",
      route: "home-mobile",
      path: "/home",
      expectation: "loads",
      pass: true,
      finalUrl: page.url(),
      consoleErrors: [...consoleErrors],
      failedRequests: [...failedRequests],
      screenshot: shot,
    });
    await signOutStaging(page);
    await context.close();
  });
});

test.afterAll(() => {
  const root = join(process.cwd(), "artifacts", "staging-walkthrough");
  mkdirSync(root, { recursive: true });
  const out = join(root, "matrix.json");
  writeFileSync(
    out,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        target: STAGING_BASE_URL,
        summary: {
          total: matrixResults.length,
          passed: matrixResults.filter((r) => r.pass).length,
          failed: matrixResults.filter((r) => !r.pass).length,
        },
        results: matrixResults,
      },
      null,
      2,
    ),
    "utf8",
  );
});
