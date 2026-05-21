import type { Locator, Page } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import type { StagingPersona } from "./fixtures.js";
import { stagingE2ePassword } from "./fixtures.js";

/** Clerk dashboard onboarding / org prompts that overlay the sign-in form. */
const CLERK_OVERLAY_DISMISS_NAMES: RegExp[] = [
  /I'll remove it myself/i,
  /remove it myself/i,
  /not now/i,
  /^skip$/i,
  /^got it$/i,
  /^dismiss$/i,
  /^close$/i,
];

/**
 * Dismiss optional Clerk onboarding/org overlays when present (staging E2E only).
 * No-op when nothing is blocking the sign-in form.
 */
export async function dismissOptionalClerkOnboardingOverlays(page: Page): Promise<void> {
  const portal = page.locator("[data-floating-ui-portal]");

  for (let pass = 0; pass < 3; pass++) {
    let dismissed = false;

    for (const pattern of CLERK_OVERLAY_DISMISS_NAMES) {
      const scopes: Locator[] = [
        portal.getByRole("button", { name: pattern }),
        page.getByRole("button", { name: pattern }),
      ];
      for (const scope of scopes) {
        const count = await scope.count();
        for (let i = 0; i < count; i++) {
          const button = scope.nth(i);
          if (!(await button.isVisible().catch(() => false))) continue;
          await button.click({ timeout: 5_000 }).catch(() => {});
          dismissed = true;
          await page.waitForTimeout(250);
        }
      }
    }

    const closeInPortal = portal.locator(
      'button[aria-label*="close" i], button[aria-label*="Close" i]',
    );
    const closeCount = await closeInPortal.count();
    for (let i = 0; i < closeCount; i++) {
      const button = closeInPortal.nth(i);
      if (!(await button.isVisible().catch(() => false))) continue;
      await button.click({ timeout: 5_000 }).catch(() => {});
      dismissed = true;
      await page.waitForTimeout(250);
    }

    if (!dismissed) break;
  }

  if (await portal.first().isVisible().catch(() => false)) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(200);
  }
}

function clerkSignInContinueButton(page: Page): Locator {
  const signInRoot = page.locator('.cl-signIn-root, [data-clerk-component="SignIn"]').first();
  return signInRoot
    .locator('button[data-localization-key="formButtonPrimary"]')
    .or(signInRoot.getByRole("button", { name: /^continue$/i }))
    .first();
}

async function clickClerkFormPrimary(page: Page): Promise<void> {
  const primary = clerkSignInContinueButton(page);
  for (let attempt = 0; attempt < 4; attempt++) {
    await dismissOptionalClerkOnboardingOverlays(page);
    try {
      await primary.click({ timeout: 10_000 });
      return;
    } catch {
      if (attempt === 3) throw new Error("Clerk sign-in Continue button blocked by overlay");
    }
  }
}

/** Clerk hash-routing keeps /signin until the app session is active. */
async function waitForClerkSignedIn(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const clerk = (window as { Clerk?: { loaded?: boolean; user?: unknown } }).Clerk;
      return Boolean(clerk?.loaded && clerk?.user);
    },
    { timeout: 45_000 },
  );
  await page
    .waitForURL((url) => /\/home(\?|#|$)/.test(url.pathname), { timeout: 20_000 })
    .catch(() => {});
}

/**
 * Clerk sign-in against staging (testing token + ticket sign-in for seeded users).
 * Falls back to password UI when ticket sign-in is unavailable.
 */
export async function signInStagingPersona(page: Page, persona: StagingPersona): Promise<void> {
  await setupClerkTestingToken({ page });
  await page.goto("/signin", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await dismissOptionalClerkOnboardingOverlays(page);

  for (let attempt = 0; attempt < 3; attempt++) {
    await dismissOptionalClerkOnboardingOverlays(page);
    try {
      await clerk.signIn({ page, emailAddress: persona.email });
      await waitForClerkSignedIn(page);
      return;
    } catch {
      await page.waitForTimeout(500);
    }
  }

  const password = stagingE2ePassword();
  await dismissOptionalClerkOnboardingOverlays(page);
  try {
    await clerk.signIn({
      page,
      signInParams: {
        strategy: "password",
        identifier: persona.email,
        password,
      },
    });
    await waitForClerkSignedIn(page);
    return;
  } catch {
    // Last resort: password UI with overlay dismissal.
  }

  const identifier = page.locator('input[name="identifier"], input[type="email"]').first();
  await identifier.waitFor({ state: "visible", timeout: 20_000 });
  await identifier.fill(persona.email);
  await clickClerkFormPrimary(page);

  const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
  await passwordInput.waitFor({ state: "visible", timeout: 15_000 });
  await passwordInput.fill(password);
  await dismissOptionalClerkOnboardingOverlays(page);
  await clickClerkFormPrimary(page);

  await waitForClerkSignedIn(page);
}

export async function signOutStaging(page: Page): Promise<void> {
  try {
    await clerk.signOut({ page });
  } catch {
    await page.goto("/signin", { waitUntil: "domcontentloaded" });
    await page
      .evaluate(async () => {
        const c = (window as unknown as { Clerk?: { signOut?: () => Promise<void> } }).Clerk;
        if (c?.signOut) await c.signOut();
      })
      .catch(() => {});
  }
  await page
    .waitForFunction(() => !(window as { Clerk?: { user?: unknown } }).Clerk?.user, {
      timeout: 15_000,
    })
    .catch(() => {});
  await page.goto("/signin", { waitUntil: "domcontentloaded" });
}
