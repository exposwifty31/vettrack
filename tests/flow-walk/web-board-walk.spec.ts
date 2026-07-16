/**
 * Phase-10 III.6 live walk — WEB + BOARD + MARKETING surfaces (dev-bypass, local).
 *
 * Runs the reconciled FLOW_INVENTORY manifest across the role archetypes in a
 * desktop browser (>=1024px so WebOnlyGuard renders for management roles), stamps
 * each row pass/broken/degraded/observe/unreachable, screenshots it, and writes
 * `artifacts/flow-walk/web-matrix.json` — the recorded III.6 evidence.
 *
 * Prerequisites: a LOCAL walk server — `pnpm dev:walk` (dev-bypass client+server,
 * clinicId=dev-clinic-default, PLAYWRIGHT_E2E=true so the global per-IP API rate
 * limiter is skipped: a 5-role walk is hundreds of /api calls, and a single 429 on
 * /api/users/me flips the client signed-out for every row after it). Never point
 * this at staging/production — it cycles dev-role headers.
 *
 * Discovery: allowlisted only via `PW_SUITE=flow-walk` (see playwright.shared.ts);
 * the default CI suite never runs it, and it self-skips (with the reason) when the
 * target is missing, is the API-only port, or is not a dev-bypass server.
 *
 *   pnpm dev:walk       # in one terminal
 *   pnpm test:playwright:flow-walk
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  ROLE_ARCHETYPES,
  expectedWebOutcome,
  roleHasManagementWeb,
  webWalkRows,
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

// In dev the SPA lives on the Vite port (:5000; /api proxied to :3001) — the API
// port serves no frontend. Single-port deployments can override via TEST_BASE_URL.
const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:5000";
const results: WalkResult[] = [];
let reachable = false;
let unreachableReason = "";

/**
 * Fail fast with a reason instead of walking 45 bogus rows. The target must be
 * up, must serve the SPA (not the dev API-only port), and must honor the
 * dev-role override (a dev-bypass server) — the exact misconfigurations that
 * previously produced all-/signin matrices.
 */
async function probe(request: APIRequestContext): Promise<string | null> {
  try {
    const hz = await request.get(`${BASE}/api/healthz`, { timeout: 4_000 });
    if (!hz.ok()) {
      return `API unhealthy at ${BASE}/api/healthz (HTTP ${hz.status()}) — start \`pnpm dev:walk\`.`;
    }
  } catch {
    return `App not reachable at ${BASE}. Start a local walk server first: \`pnpm dev:walk\`.`;
  }
  try {
    const root = await request.get(`${BASE}/`, { timeout: 8_000 });
    if (!(await root.text()).includes('id="root"')) {
      return `${BASE} answers /api but serves no app shell — in dev, walk the Vite port (:5000), not the API port (:3001).`;
    }
  } catch {
    return `${BASE}/ did not return the app shell.`;
  }
  try {
    const me = await request.get(`${BASE}/api/users/me`, {
      headers: { "x-dev-role-override": "student" },
      timeout: 8_000,
    });
    if (!me.ok()) {
      return `/api/users/me returned HTTP ${me.status()} — server not in dev-bypass? Start \`pnpm dev:walk\`.`;
    }
    const body = (await me.json()) as { effectiveRole?: string; role?: string };
    if ((body.effectiveRole ?? body.role) !== "student") {
      return `server ignored x-dev-role-override (role stayed ${body.effectiveRole ?? body.role ?? "?"}) — not a dev-bypass server. Start \`pnpm dev:walk\` (CLERK_ENABLED=false).`;
    }
  } catch {
    return `/api/users/me probe failed — server not in dev-bypass? Start \`pnpm dev:walk\`.`;
  }
  return null;
}

/**
 * "eq1" / "s1" are manifest placeholders; against a live DB they 400/404 every
 * detail row (non-UUID ids are rejected). Resolve them to real seeded ids at
 * walk start; if the lookup fails the placeholder walks as-is and the matrix
 * shows the noise honestly.
 */
const idSubstitutions = new Map<string, string>();

async function resolveSeededIds(request: APIRequestContext): Promise<void> {
  try {
    const eq = await request.get(`${BASE}/api/equipment`, { timeout: 8_000 });
    if (eq.ok()) {
      const body = (await eq.json()) as { id?: string }[] | { items?: { id?: string }[] };
      const first = Array.isArray(body) ? body[0] : body.items?.[0];
      if (first?.id) idSubstitutions.set("eq1", first.id);
    }
  } catch {
    /* keep placeholder */
  }
  try {
    const sh = await request.get(`${BASE}/api/shifts`, { timeout: 8_000 });
    if (sh.ok()) {
      const body = (await sh.json()) as { id?: string }[] | { shifts?: { id?: string }[] };
      const first = Array.isArray(body) ? body[0] : body.shifts?.[0];
      if (first?.id) idSubstitutions.set("s1", first.id);
    }
  } catch {
    /* keep placeholder */
  }
}

function substitutePlaceholders(path: string): string {
  let out = path;
  for (const [placeholder, real] of idSubstitutions) {
    out = out.replace(new RegExp(`\\b${placeholder}\\b`, "g"), real);
  }
  return out;
}

test.describe.serial("Flow walk (dev-bypass) — web + board + marketing", () => {
  test.beforeAll(async ({ request }) => {
    unreachableReason = (await probe(request)) ?? "";
    reachable = unreachableReason === "";
    if (reachable) await resolveSeededIds(request);
  });

  test.beforeEach(() => {
    test.skip(!reachable, unreachableReason);
  });

  for (const role of ROLE_ARCHETYPES) {
    test(`walk as ${role}${roleHasManagementWeb(role) ? " (management.web)" : " (gated on web)"}`, async ({
      browser,
    }) => {
      // A role walks ~35 rows; against a Vite dev server each cold lazy route
      // compiles on first navigation, so the 30s suite default is far too short.
      test.setTimeout(10 * 60_000);
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
        const requestedPath = substitutePlaceholders(row.paths[0]);

        let navigated = true;
        await page
          .goto(`${BASE}${requestedPath}`, { waitUntil: "domcontentloaded", timeout: 30_000 })
          .catch(() => {
            navigated = false;
          });

        if (!navigated) {
          results.push({
            rowId: row.id,
            group: row.group,
            path: requestedPath,
            platform: "web",
            role,
            expected: expectedWebOutcome(row, role).kind,
            actual: "unreachable",
            status: "unreachable",
            finalUrl: relativePath(page.url()),
            consoleErrors: [...consoleErrors],
            failedRequests: [...failedRequests],
            notes: "navigation threw",
          });
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

        // Recording only — the assertions live in the final "matrix assertions"
        // test. In a serial group a failing role test would skip every remaining
        // role's walk (the admin run's failures silenced roles 2-5 entirely).
      }

      await context.close();
    });
  }

  test("matrix assertions — no broken rows across all roles", () => {
    expect(results.length, "walk recorded no rows").toBeGreaterThan(0);
    for (const r of results) {
      expect
        .soft(r.status !== "broken", `${r.role} ${r.path}: ${r.notes ?? r.status}`)
        .toBe(true);
    }
  });

  test.afterAll(() => {
    if (!reachable || results.length === 0) return;
    writeMatrix(
      results,
      { target: BASE, platform: "web+board", generatedAt: new Date().toISOString() },
      artifactPath("web-matrix.json"),
    );
  });
});
