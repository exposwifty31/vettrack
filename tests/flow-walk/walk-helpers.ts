/**
 * Shared helpers for the Phase-10 III.6 flow walk (dev-bypass, local).
 *
 * Role cycling is done the same way the in-app Dev Role Switcher does it:
 * write `vt:devRole` to localStorage; `src/lib/auth-fetch.ts` reads it and stamps
 * `x-dev-role-override` on every /api/ call, and `server/middleware/auth.ts` honors
 * it. No Clerk, no seeded personas — this is why the walk is local dev-bypass only.
 */
import type { Page, BrowserContext } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DEV_ROLE_KEY,
  pathMatchesTarget,
  type ExpectedOutcome,
  type FlowRow,
  type OutcomeKind,
  type RoleArchetype,
} from "./flow-inventory.manifest";

export { DEV_ROLE_KEY };

export type WalkStatus = "pass" | "broken" | "degraded" | "unreachable" | "observe";

export interface WalkResult {
  rowId: string;
  group: string;
  path: string;
  platform: string;
  role: RoleArchetype;
  expected: OutcomeKind;
  actual: OutcomeKind | "unreachable";
  status: WalkStatus;
  finalUrl: string;
  screenshot?: string;
  consoleErrors: string[];
  failedRequests: string[];
  notes?: string;
}

/** Console + network-failure observers, mirroring the staging walkthrough pattern. */
export function attachObservers(page: Page): {
  consoleErrors: string[];
  failedRequests: string[];
} {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on("response", (res) => {
    const url = res.url();
    // >=400, not >=500: a 401/403/429 on /api/users/me flips the client to
    // signed-out and poisons every subsequent row — the admin walk's rate-limit
    // cliff (429s) was invisible under the old >=500 filter.
    if (url.includes("/api/") && res.status() >= 400) {
      failedRequests.push(`${res.status()} ${url}`);
    }
  });
  page.on("requestfailed", (req) => {
    const url = req.url();
    const err = req.failure()?.errorText ?? "?";
    // ERR_ABORTED is normal teardown — the SSE stream and in-flight fetches are
    // cancelled by the walk's next page.goto; recording it flags healthy rows.
    if (url.includes("/api/") && err !== "net::ERR_ABORTED") {
      failedRequests.push(`FAILED ${err} ${url}`);
    }
  });
  return { consoleErrors, failedRequests };
}

/** Set the dev-role override for every navigation in this context (before load). */
export async function applyDevRole(
  context: BrowserContext,
  role: RoleArchetype,
): Promise<void> {
  await context.addInitScript(
    ([key, value]) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* private mode / storage disabled — walk still records the attempt */
      }
    },
    [DEV_ROLE_KEY, role] as const,
  );
}

/** Wait for the SPA to mount + settle, tolerant of the offline-first network chatter. */
export async function waitForSettled(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  // #root gets content once React mounts; give lazy route chunks a beat.
  await page
    .locator("#root")
    .first()
    .waitFor({ state: "attached", timeout: 15_000 })
    .catch(() => {});
  await page.waitForTimeout(700);
}

/** Relative pathname + search, for redirect-target comparison. */
export function relativePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

interface Surfaces {
  hasCrash: boolean;
  hasWebGate: boolean;
  hasGuardScreen: boolean;
  hasDenied: boolean;
  hasKiosk: boolean;
}

/** Read the terminal surface markers the app exposes (all data-testid / data-attr). */
export async function readSurfaces(page: Page): Promise<Surfaces> {
  const visible = async (selector: string): Promise<boolean> =>
    page
      .locator(selector)
      .first()
      .isVisible()
      .catch(() => false);
  const [hasCrash, hasPageCrash, hasWebGate, hasGuardScreen, hasDenied, hasKiosk] =
    await Promise.all([
      visible('[data-testid="app-error-boundary"]'),
      visible('[data-testid="page-error-boundary"]'),
      visible('[data-testid="management-web-gate-screen"]'),
      visible('[data-testid="web-only-guard-screen"]'),
      visible('[data-testid="management-access-denied"]'),
      visible("[data-board-shell]"),
    ]);
  return {
    hasCrash: hasCrash || hasPageCrash,
    hasWebGate,
    hasGuardScreen,
    hasDenied,
    hasKiosk,
  };
}

/** Map the observed page state to a single OutcomeKind. */
export function classifyActual(
  requestedPath: string,
  finalUrl: string,
  s: Surfaces,
): OutcomeKind {
  if (s.hasKiosk) return "kiosk";
  // The desktop console gate (T-31) preempts every per-route guard — check it first.
  if (s.hasWebGate) return "management-web-gate";
  if (s.hasGuardScreen) return "guard-screen";
  if (s.hasDenied) return "access-denied";
  const final = relativePath(finalUrl);
  const stayed = final === requestedPath || final.startsWith(requestedPath + "?") || final.startsWith(requestedPath + "/");
  if (!stayed) return "redirect";
  return "render"; // crash is reported separately via `s.hasCrash`
}

function redirectMatches(finalUrl: string, target?: string): boolean {
  // Redirect target may add/keep query params; match on the pathname.
  return pathMatchesTarget(relativePath(finalUrl), target);
}

/** Grade one walked row: pass / broken / degraded / observe. */
export function evaluateRow(args: {
  requestedPath: string;
  finalUrl: string;
  expected: ExpectedOutcome;
  actual: OutcomeKind;
  surfaces: Surfaces;
  consoleErrors: string[];
}): { status: WalkStatus; notes?: string } {
  const { expected, actual, surfaces, finalUrl, consoleErrors } = args;
  const mismatchStatus: WalkStatus = expected.confidence === "observe" ? "observe" : "broken";

  // Redirect / guard-redirect: grade the REDIRECT — did the page leave the
  // requested path and land on the declared target. What the destination itself
  // renders (kiosk chrome on /board, ManagementWebGate for a non-management
  // role, an admin-floor denial) is the destination's own contract, graded by
  // that row — so `actual` (a surface classification) is deliberately not
  // consulted here. The first full walk misgraded 33 correct redirects broken
  // because the destination's surface marker preempted "redirect".
  if (expected.kind === "redirect" || expected.kind === "guard-redirect") {
    const final = relativePath(finalUrl);
    if (final === args.requestedPath) {
      return { status: mismatchStatus, notes: `expected redirect→${expected.to}, stayed on ${final}` };
    }
    if (!redirectMatches(finalUrl, expected.to)) {
      return { status: mismatchStatus, notes: `redirected to ${final}, expected ${expected.to}` };
    }
    // Landed on the right target — but the destination must be healthy, or a
    // flow that redirects onto a crashed/erroring page would false-"pass".
    if (surfaces.hasCrash) {
      return { status: "broken", notes: `redirect landed on a crashed page (${final})` };
    }
    if (consoleErrors.length > 0) {
      return { status: "degraded", notes: `redirect landed with ${consoleErrors.length} console error(s)` };
    }
    return { status: "pass" };
  }

  if (expected.kind !== actual) {
    return { status: mismatchStatus, notes: `expected ${expected.kind}, got ${actual} (${relativePath(finalUrl)})` };
  }

  // Matched kind. A rendered page that also mounted an error boundary is degraded.
  if (actual === "render" && surfaces.hasCrash) {
    return { status: "broken", notes: "error boundary mounted on a page expected to render" };
  }
  if (actual === "render" && consoleErrors.length > 0) {
    return { status: "degraded", notes: `rendered with ${consoleErrors.length} console error(s)` };
  }
  return { status: "pass" };
}

export function summarize(results: WalkResult[]) {
  const by = (s: WalkStatus) => results.filter((r) => r.status === s).length;
  return {
    total: results.length,
    pass: by("pass"),
    broken: by("broken"),
    degraded: by("degraded"),
    observe: by("observe"),
    unreachable: by("unreachable"),
  };
}

/** Write the walk matrix JSON (the III.6 evidence artifact). */
export function writeMatrix(
  results: WalkResult[],
  meta: { target: string; platform: string; generatedAt: string },
  outFile: string,
): void {
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(
    outFile,
    JSON.stringify(
      { ...meta, summary: summarize(results), results },
      null,
      2,
    ),
    "utf8",
  );
}

export function artifactPath(...parts: string[]): string {
  return join(process.cwd(), "artifacts", "flow-walk", ...parts);
}

/** Ordered by group so the matrix reads like FLOW_INVENTORY.md. */
export function screenshotName(row: FlowRow, role: RoleArchetype, platform: string): string {
  return `${platform}__${row.group}__${row.id}__${role}.png`;
}
