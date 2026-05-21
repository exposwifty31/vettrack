/**
 * Full veterinary clinic day simulation (staging-only, non-blocking).
 *
 * Requires:
 *   STAGING_E2E_CONFIRM=yes
 *   TEST_BASE_URL=https://vettrack-staging.up.railway.app (or staging secret)
 *   Staging seed personas (pnpm staging:seed on staging branch)
 *
 * Never run against production. CI: see .github/workflows/workday-simulation-nightly.yml
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const STAGING_OK =
  process.env.STAGING_E2E_CONFIRM === "yes" &&
  (process.env.TEST_BASE_URL ?? "").includes("vettrack-staging");

const ARTIFACTS_DIR = path.join(process.cwd(), "artifacts");
const REPORT_PATH = path.join(ARTIFACTS_DIR, "workday-report.html");
const BASE_URL = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3001";

const CRASH_PATTERNS = [
  /something went wrong/i,
  /application error/i,
  /unexpected error/i,
];

type Persona = {
  name: string;
  role: string;
  emailEnv?: string;
};

const PERSONAS: Persona[] = [
  { name: "admin", role: "admin" },
  { name: "vet", role: "vet" },
  { name: "technician", role: "technician" },
  { name: "student", role: "student" },
  { name: "receptionist", role: "technician" },
  { name: "pending", role: "student" },
  { name: "blocked", role: "technician" },
];

function attachGuards(page: Page): void {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("response", (res) => {
    const url = res.url();
    if (!url.includes("/api/")) return;
    if (res.status() >= 500) errors.push(`${res.status()} ${url}`);
  });
  page.on("close", () => {
    expect(errors, `console/network errors for ${page.url()}`).toEqual([]);
  });
}

function pathnameMatchesRoute(pathname: string, route: string): boolean {
  if (route === "/home") {
    return pathname === "/home" || pathname === "/";
  }
  return pathname === route || pathname.startsWith(`${route}/`);
}

async function timelineStep(
  _ctx: BrowserContext,
  page: Page,
  label: string,
  route: string,
): Promise<void> {
  await test.step(label, async () => {
    await page.goto(route, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await expect(page).not.toHaveURL(/\/signin(?:\?|$)/);

    const pathname = new URL(page.url()).pathname;
    expect(
      pathnameMatchesRoute(pathname, route),
      `expected ${route}, landed on ${pathname} (${page.url()})`,
    ).toBe(true);

    const bodyHtml = await page.locator("body").innerHTML();
    expect(bodyHtml.trim().length, `${route} — page body is empty`).toBeGreaterThan(0);

    const pageText = (await page.content()).toLowerCase();
    for (const pattern of CRASH_PATTERNS) {
      expect(pattern.test(pageText), `${route} — React crash: ${pattern}`).toBe(false);
    }
  });
}

test.describe("Workday simulation (staging-only)", () => {
  test.skip(!STAGING_OK, "Requires STAGING_E2E_CONFIRM=yes and staging TEST_BASE_URL");

  test.beforeAll(() => {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  });

  test.afterAll(async () => {
    const html = `<!DOCTYPE html><html><body><h1>Workday simulation</h1><p>Staging-only run ${new Date().toISOString()}</p></body></html>`;
    fs.writeFileSync(REPORT_PATH, html, "utf8");
  });

  for (const persona of PERSONAS) {
    test(`${persona.name} — compressed clinical day`, async ({ browser }) => {
      const context = await browser.newContext({
        baseURL: BASE_URL,
        recordVideo: { dir: path.join(ARTIFACTS_DIR, "videos", persona.name) },
      });
      const page = await context.newPage();
      attachGuards(page);

      // Timeline (compressed) — routes are read-heavy where possible; mutations need staging seed wiring.
      await timelineStep(context, page, "08:00 open clinic", "/home");
      await timelineStep(context, page, "08:30 patient intake", "/patients");
      await timelineStep(context, page, "09:00 clinical review", "/patients");
      await timelineStep(context, page, "10:00 meds hub", "/meds");
      await timelineStep(context, page, "12:00 billing", "/billing");
      await timelineStep(context, page, "14:00 equipment", "/equipment");
      await timelineStep(context, page, "16:00 tasks", "/appointments");
      await timelineStep(context, page, "17:30 ward display", "/display");

      await context.close();
    });
  }
});
