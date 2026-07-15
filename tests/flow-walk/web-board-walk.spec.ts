/**
 * Phase-10 III.6 live walk — WEB + BOARD + MARKETING surfaces (dev-bypass, local).
 *
 * Runs the reconciled FLOW_INVENTORY manifest across the role archetypes in a
 * desktop browser (>=1024px so WebOnlyGuard renders for management roles), stamps
 * each row pass/broken/degraded/observe/unreachable, screenshots it, and writes
 * `artifacts/flow-walk/web-matrix.json` — the recorded III.6 evidence.
 *
 * Prerequisites: a LOCAL dev-bypass server (`pnpm dev`, clinicId=dev-clinic-default,
 * no Clerk key). Never point this at staging/production — it cycles dev-role headers.
 *
 * Discovery: allowlisted only via `PW_SUITE=flow-walk` (see playwright.shared.ts);
 * the default CI suite never runs it, and it self-skips if the app is unreachable.
 *
 *   pnpm dev            # in one terminal
 *   pnpm test:playwright:flow-walk
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  ROLE_ARCHETYPES,
  expectedWebOutcome,
  roleHasManagementWeb,
  webWalkRows,
  type RoleArchetype,
} from "./flow-inventory.manifest";
import {
  applyDevRole,
  artifactPath,
  attachObservers,
  classifyActual,
  evaluateRow,
  readSurfaces,
  relativePath,
  screenshotName,
  waitForSettled,
  writeMatrix,
  type WalkResult,
} from "./walk-helpers";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3001";
const results: WalkResult[] = [];
let reachable = false;

async function probe(request: APIRequestContext): Promise<boolean> {
  try {
    const res = await request.get(`${BASE}/api/healthz`, { timeout: 4_000 });
    return res.ok();
  } catch {
    return false;
  }
}

test.describe.serial("Flow walk (dev-bypass) — web + board + marketing", () => {
  test.beforeAll(async ({ request }) => {
    reachable = await probe(request);
  });

  test.beforeEach(() => {
    test.skip(
      !reachable,
      `App not reachable at ${BASE}. Start a local dev-bypass server first: \`pnpm dev\`.`,
    );
  });

  for (const role of ROLE_ARCHETYPES) {
    test(`walk as ${role}${roleHasManagementWeb(role) ? " (management.web)" : " (gated on web)"}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 }, // >=1024 so WebOnlyGuard renders, not the guard screen
        baseURL: BASE,
      });
      await applyDevRole(context, role);
      const page = await context.newPage();
      const { consoleErrors, failedRequests } = attachObservers(page);

      for (const row of webWalkRows(role)) {
        consoleErrors.length = 0;
        failedRequests.length = 0;
        const requestedPath = row.paths[0];

        let navigated = true;
        await page
          .goto(`${BASE}${requestedPath}`, { waitUntil: "domcontentloaded", timeout: 30_000 })
          .catch(() => {
            navigated = false;
          });

        if (!navigated) {
          results.push(baseResult(row, role, requestedPath, "unreachable", "unreachable", page.url(), consoleErrors, failedRequests, "navigation threw"));
          continue;
        }

        await waitForSettled(page);
        const surfaces = await readSurfaces(page);
        const actual = classifyActual(requestedPath, page.url(), surfaces);
        const expected = expectedWebOutcome(row, role);
        const platform = surfaces.hasKiosk ? "board" : row.guard === "marketing" ? "marketing" : "web";

        const { status, notes } = evaluateRow({
          requestedPath,
          finalUrl: page.url(),
          expected,
          actual,
          surfaces,
          consoleErrors: [...consoleErrors],
        });

        const shot = artifactPath("screenshots", screenshotName(row, role, platform));
        await page.screenshot({ path: shot, fullPage: false }).catch(() => {});

        results.push({
          rowId: row.id,
          group: row.group,
          path: requestedPath,
          platform,
          role,
          expected: expected.kind,
          actual,
          status,
          finalUrl: relativePath(page.url()),
          screenshot: shot,
          consoleErrors: [...consoleErrors],
          failedRequests: [...failedRequests],
          notes,
        });

        // A walk records everything; only a hard mismatch on a firm expectation fails.
        expect
          .soft(status !== "broken", `${role} ${requestedPath}: ${notes ?? status}`)
          .toBe(true);
      }

      await context.close();
    });
  }

  test.afterAll(() => {
    if (!reachable || results.length === 0) return;
    writeMatrix(
      results,
      { target: BASE, platform: "web+board", generatedAt: new Date().toISOString() },
      artifactPath("web-matrix.json"),
    );
  });
});

function baseResult(
  row: { id: string; group: string },
  role: RoleArchetype,
  path: string,
  expected: WalkResult["expected"],
  actual: WalkResult["actual"],
  finalUrl: string,
  consoleErrors: string[],
  failedRequests: string[],
  notes: string,
): WalkResult {
  return {
    rowId: row.id,
    group: row.group,
    path,
    platform: "web",
    role,
    expected,
    actual,
    status: "unreachable",
    finalUrl: relativePath(finalUrl),
    consoleErrors: [...consoleErrors],
    failedRequests: [...failedRequests],
    notes,
  };
}
