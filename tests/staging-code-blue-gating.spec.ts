/**
 * Staging Code Blue API auth gating (real Clerk sessions, no dev headers).
 */
import { test, expect } from "@playwright/test";
import {
  assertStagingPlaywrightEnv,
  loadManifest,
  personaByKey,
  STAGING_BASE_URL,
} from "./staging/fixtures.js";
import { signInStagingPersona, signOutStaging } from "./staging/helpers.js";

test.beforeAll(() => {
  assertStagingPlaywrightEnv();
  const manifest = loadManifest();
  if (!manifest?.personas?.length) {
    throw new Error("Run pnpm staging:seed before staging Code Blue E2E");
  }
});

function managerPayload(adminVtUserId: string) {
  return {
    managerUserId: adminVtUserId,
    managerUserName: "Staging E2E Admin",
    preCheckPassed: true,
  };
}

test.describe.serial("Staging Code Blue gating", () => {
  test("unauthenticated POST /api/code-blue/sessions → 401", async ({ request }) => {
    const res = await request.post(`${STAGING_BASE_URL}/api/code-blue/sessions`, {
      data: { managerUserId: "x", managerUserName: "X" },
    });
    expect(res.status()).toBe(401);
  });

  test("student cannot start Code Blue session (requireClinicalUser)", async ({ page }) => {
    await signInStagingPersona(page, personaByKey("student"));
    const manifest = loadManifest()!;
    const admin = manifest.personas.find((p) => p.key === "admin")!;

    const res = await page.request.post(`${STAGING_BASE_URL}/api/code-blue/sessions`, {
      data: managerPayload(admin.vtUserId),
    });
    expect(res.status()).toBe(403);
    const body = (await res.json()) as { reason?: string };
    expect(body.reason).toBe("INSUFFICIENT_ROLE");

    await signOutStaging(page);
  });

  test("vet with clinical check-in passes clinical user gate (not INSUFFICIENT_ROLE)", async ({
    page,
  }) => {
    await signInStagingPersona(page, personaByKey("vet"));
    const manifest = loadManifest()!;
    const admin = manifest.personas.find((p) => p.key === "admin")!;

    const res = await page.request.post(`${STAGING_BASE_URL}/api/code-blue/sessions`, {
      data: managerPayload(admin.vtUserId),
    });

    const body = (await res.json()) as { reason?: string; id?: string };
    expect(body.reason).not.toBe("INSUFFICIENT_ROLE");
    expect([200, 201, 403, 409, 400]).toContain(res.status());

    if (res.ok() && body.id) {
      await page.request.patch(`${STAGING_BASE_URL}/api/code-blue/sessions/${body.id}/end`, {
        data: { outcome: "ongoing" },
      });
    }

    await signOutStaging(page);
  });

  test("GET /api/code-blue/sessions/active is readable when signed in", async ({ page }) => {
    await signInStagingPersona(page, personaByKey("technician"));
    const res = await page.request.get(`${STAGING_BASE_URL}/api/code-blue/sessions/active`);
    expect(res.status()).toBe(200);
    await signOutStaging(page);
  });

  test("pending user cannot access Code Blue active sessions API", async ({ page }) => {
    await signInStagingPersona(page, personaByKey("pending"));
    const res = await page.request.get(`${STAGING_BASE_URL}/api/code-blue/sessions/active`);
    expect(res.status()).toBe(403);
    const body = (await res.json()) as { reason?: string };
    expect(body.reason).toBe("ACCOUNT_PENDING_APPROVAL");
    await signOutStaging(page);
  });
});
