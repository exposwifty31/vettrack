import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { Page, Response } from "@playwright/test";
import { expect } from "@playwright/test";
import type { StagingPersonaKey } from "./fixtures.js";
import type { WalkthroughExpectation } from "./walkthrough-routes.js";

export type RouteCheckResult = {
  persona: StagingPersonaKey;
  route: string;
  path: string;
  expectation: WalkthroughExpectation;
  pass: boolean;
  finalUrl: string;
  consoleErrors: string[];
  failedRequests: string[];
  screenshot?: string;
  notes?: string;
};

const ARTIFACT_ROOT = join(process.cwd(), "artifacts", "staging-walkthrough");

const IGNORE_REQUEST_PATTERNS = [
  /clerk\./i,
  /challenges\.cloudflare/i,
  /google-analytics/i,
  /sentry\.io/i,
  /favicon\.ico/i,
];

const IGNORE_FAILED_STATUSES_FOR_PROBE = new Set([401, 403, 404]);

export function artifactDir(persona: StagingPersonaKey): string {
  const dir = join(ARTIFACT_ROOT, persona);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function attachPageObservers(page: Page): {
  consoleErrors: string[];
  failedRequests: string[];
} {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/failed to load resource/i.test(text) && /401|403/.test(text)) return;
    consoleErrors.push(text.slice(0, 500));
  });

  page.on("pageerror", (err) => {
    consoleErrors.push(`pageerror: ${err.message}`.slice(0, 500));
  });

  page.on("response", (res: Response) => {
    const url = res.url();
    if (!url.includes("/api/")) return;
    if (IGNORE_REQUEST_PATTERNS.some((p) => p.test(url))) return;
    const status = res.status();
    if (status < 400) return;
    if (IGNORE_FAILED_STATUSES_FOR_PROBE.has(status)) return;
    failedRequests.push(`${status} ${url.split("?")[0]}`.slice(0, 400));
  });

  return { consoleErrors, failedRequests };
}

export async function openMobileMenuIfNeeded(page: Page): Promise<void> {
  const menuBtn = page.getByRole("button", { name: /menu|תפריט/i }).first();
  if (await menuBtn.isVisible().catch(() => false)) {
    await menuBtn.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

export async function waitForAppSettled(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  const spinner = page.locator(".animate-spin").first();
  await spinner.waitFor({ state: "hidden", timeout: 25_000 }).catch(() => {});
  await page.waitForTimeout(400);
}

export async function assertNoCrashSurface(page: Page): Promise<void> {
  const crashText = page.getByText(/Page rendering failed|Something went wrong|ChunkLoadError/i);
  await expect(crashText).toHaveCount(0);
  const blank = page.locator("body");
  const text = (await blank.innerText().catch(() => "")).trim();
  expect(text.length).toBeGreaterThan(0);
}

/** AuthGuard pending gate (en/he auth.guard.pendingTitle). */
export async function assertAuthGatePending(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", {
      name: /account pending hospital management approval|החשבון ממתין לאישור/i,
    }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /sign out|התנתק/i })).toBeVisible();
}

/** AuthGuard blocked gate (en/he auth.guard.blockedTitle). */
export async function assertAuthGateBlocked(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: /access blocked|גישה חסומה/i }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /sign out|התנתק/i })).toBeVisible();
}

/** Inline admin/page RBAC or AuthGuard access-denied surfaces (en/he). */
export async function assertAccessDeniedSurface(page: Page): Promise<void> {
  const deniedHeading = page.getByRole("heading", { name: /access denied|אין גישה/i });
  const adminRequired = page.getByText(
    /administrator access required|נדרשת הרשאת מנהל/i,
  );
  const insufficientRole = page.getByText(
    /do not have permission to access this area|אין לך הרשאה לגשת לאזור זה/i,
  );
  const anyDenied = deniedHeading.or(adminRequired).or(insufficientRole).first();
  await expect(anyDenied).toBeVisible({ timeout: 15_000 });
}

export async function captureRouteScreenshot(
  page: Page,
  persona: StagingPersonaKey,
  slug: string,
): Promise<string> {
  const dir = artifactDir(persona);
  const file = join(dir, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

export function evaluateRoutePass(params: {
  expectation: WalkthroughExpectation;
  finalUrl: string;
  path: string;
  consoleErrors: string[];
  failedRequests: string[];
}): { pass: boolean; notes?: string } {
  const { expectation, finalUrl, path, consoleErrors, failedRequests } = params;

  if (consoleErrors.some((e) => /ChunkLoadError|hydration|Minified React error/i.test(e))) {
    return { pass: false, notes: "React/hydration console error" };
  }
  if (failedRequests.length > 0) {
    return { pass: false, notes: `API failures: ${failedRequests.slice(0, 3).join("; ")}` };
  }

  switch (expectation) {
    case "auth_gate_pending":
    case "auth_gate_blocked":
      return { pass: true };
    case "redirect":
      if (path === "/meds" && !finalUrl.includes("/meds")) return { pass: true };
      return { pass: false, notes: `Expected redirect away from ${path}, got ${finalUrl}` };
    case "access_denied":
      // Caller must run assertAccessDeniedSurface(page) before evaluateRoutePass.
      if (finalUrl.includes("/signin")) {
        return { pass: false, notes: "Redirected to sign-in instead of access-denied UI" };
      }
      return { pass: true };
    case "loads":
      if (finalUrl.includes("/signin")) {
        return { pass: false, notes: "Unexpected redirect to sign-in (auth loop?)" };
      }
      return { pass: true };
    default:
      return { pass: true };
  }
}

export function writeMatrixReport(results: RouteCheckResult[]): string {
  mkdirSync(ARTIFACT_ROOT, { recursive: true });
  const out = join(ARTIFACT_ROOT, "matrix.json");
  const payload = {
    generatedAt: new Date().toISOString(),
    summary: {
      total: results.length,
      passed: results.filter((r) => r.pass).length,
      failed: results.filter((r) => !r.pass).length,
    },
    results,
  };
  writeFileSync(out, JSON.stringify(payload, null, 2), "utf8");
  return out;
}
