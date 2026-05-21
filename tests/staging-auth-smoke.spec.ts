/**
 * Staging Clerk E2E auth smoke — roles and account status gates.
 *
 * Prerequisites:
 *   pnpm staging:seed  (STAGING_E2E_CONFIRM=yes, STAGING_E2E_PASSWORD, sk_test_*, staging DATABASE_URL)
 *
 * Run:
 *   TEST_BASE_URL=https://vettrack-staging.up.railway.app \
 *   STAGING_E2E_PASSWORD=... CLERK_SECRET_KEY=sk_test_... \
 *   pnpm test:staging:e2e
 */
import { test, expect } from "@playwright/test";
import {
  assertStagingPlaywrightEnv,
  loadManifest,
  personaByKey,
  STAGING_BASE_URL,
  type StagingPersonaKey,
} from "./staging/fixtures.js";
import { signInStagingPersona, signOutStaging } from "./staging/helpers.js";

test.beforeAll(() => {
  assertStagingPlaywrightEnv();
  const manifest = loadManifest();
  if (!manifest?.personas?.length) {
    throw new Error(
      "Missing .staging-e2e-manifest.json — run pnpm staging:seed before staging E2E",
    );
  }
});

test.describe.serial("Staging auth smoke", () => {
  test("healthz and startup", async ({ request }) => {
    const hz = await request.get(`${STAGING_BASE_URL}/api/healthz`);
    expect(hz.status()).toBe(200);
    expect(await hz.text()).toBe("ok");

    const startup = await request.get(`${STAGING_BASE_URL}/api/health/startup`);
    expect(startup.status()).toBe(200);
    const body = (await startup.json()) as {
      checks: Record<string, boolean | string>;
    };
    expect(body.checks.hasClerkSecretKey).toBe(true);
    expect(body.checks.hasDatabaseUrl).toBe(true);
    expect(body.checks.hasRedisUrl).toBe(true);
    expect(body.checks.databaseReachable).toBe(true);
  });

  test("unauthenticated /api/users/me → 401", async ({ request }) => {
    const res = await request.get(`${STAGING_BASE_URL}/api/users/me`);
    expect(res.status()).toBe(401);
  });

  const roleCases: Array<{
    key: StagingPersonaKey;
    expectStatus: number;
    expectRole?: string;
    expectAccountStatus?: string;
    reason?: string;
  }> = [
    { key: "admin", expectStatus: 200, expectRole: "admin", expectAccountStatus: "active" },
    { key: "vet", expectStatus: 200, expectRole: "vet", expectAccountStatus: "active" },
    { key: "technician", expectStatus: 200, expectRole: "technician", expectAccountStatus: "active" },
    { key: "student", expectStatus: 200, expectRole: "student", expectAccountStatus: "active" },
    {
      key: "pending",
      expectStatus: 403,
      reason: "ACCOUNT_PENDING_APPROVAL",
    },
    {
      key: "blocked",
      expectStatus: 403,
      reason: "ACCOUNT_BLOCKED",
    },
  ];

  for (const tc of roleCases) {
    test(`/api/users/me as ${tc.key}`, async ({ page }) => {
      const persona = personaByKey(tc.key);
      await signInStagingPersona(page, persona);

      const res = await page.request.get(`${STAGING_BASE_URL}/api/users/me`);
      expect(res.status()).toBe(tc.expectStatus);

      const body = (await res.json()) as Record<string, unknown>;
      if (tc.expectStatus === 200) {
        expect(body.role).toBe(tc.expectRole);
        expect(body.status).toBe(tc.expectAccountStatus);
      } else if (tc.reason) {
        expect(body.reason).toBe(tc.reason);
      }

      await signOutStaging(page);
    });
  }
});
