/**
 * Phase-10 III.6 live walk — NATIVE (iOS Capacitor shell), dev-bypass.
 *
 * Drives the WKWebView of the installed shell and asserts the manifest's
 * `expectedNativeOutcome` for each iphone/ipad row. On the mobile target the
 * desktop management-web gate (T-31) is inert, so this is where the real
 * per-route guards are proven: WebOnlyGuard → /home, CustodyGuard student →
 * /equipment, legacy redirects → their targets, everything else renders.
 *
 * Role coverage: native outcomes differ by role ONLY via CustodyGuard (student).
 * So the walk cycles `admin` (baseline: render/redirect per guard) and `student`
 * (custody rows must redirect to /equipment). management.web is irrelevant here.
 *
 * This file is a SCAFFOLD: it is complete and manifest-driven, but running it
 * needs a booted simulator + an installed dev-bypass shell (see ./README.md).
 * The two integration seams that a booted sim must confirm are marked TODO(sim).
 */
import { browser } from "@wdio/globals";
import {
  DEV_ROLE_KEY,
  expectedNativeOutcome,
  pathMatchesTarget,
  rowsForPlatform,
  type FlowRow,
  type Platform,
  type RoleArchetype,
} from "../flow-inventory.manifest";

const PLATFORM: Platform = process.env.DEVICE === "ipad" ? "ipad" : "iphone";
const NATIVE_ROLES: RoleArchetype[] = ["admin", "student"];

/** Switch the Appium session into the Capacitor WKWebView context. */
async function enterWebview(): Promise<void> {
  await browser.waitUntil(
    async () => {
      const contexts = (await browser.getContexts()) as string[];
      const webview = contexts.find((c) => String(c).startsWith("WEBVIEW"));
      if (!webview) return false;
      await browser.switchContext(webview);
      return true;
    },
    { timeout: 30_000, timeoutMsg: "No WEBVIEW context — is the Capacitor shell loaded?" },
  );
}

async function setDevRoleAndReload(role: RoleArchetype): Promise<void> {
  await browser.execute(
    (key: string, value: string) => {
      window.localStorage.setItem(key, value);
      // TODO(sim): if the router doesn't pick up the new role, a full reload is the
      // safe reset — Capacitor serves from a fixed origin so location.reload() is fine.
      window.location.replace("/home");
    },
    DEV_ROLE_KEY,
    role,
  );
  await browser.pause(1_500);
  await enterWebview();
}

/** In-app navigation via the history router (wouter listens to popstate). */
async function navigate(path: string): Promise<void> {
  await browser.execute((p: string) => {
    window.history.pushState({}, "", p);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
  await browser.pause(300);
}

async function currentPath(): Promise<string> {
  return browser.execute<string, []>(() => window.location.pathname + window.location.search);
}

/**
 * Read the path once redirect chains stop moving (guard bounces, Tasks' custody
 * redirect, the scan overlay stripping its query param). A fixed pause raced the
 * heavier rows — the row after /scan flaked on the camera teardown — so poll
 * until two consecutive reads agree, capped at ~5s.
 */
async function settledPath(): Promise<string> {
  let prev = await currentPath();
  for (let i = 0; i < 24; i++) {
    await browser.pause(200);
    const cur = await currentPath();
    if (cur === prev && i >= 2) return cur;
    prev = cur;
  }
  return prev;
}

async function isVisible(testid: string): Promise<boolean> {
  return browser.execute<boolean, [string]>((id: string) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    return !!el && (el as HTMLElement).offsetParent !== null;
  }, testid);
}

/** iPad-native serves some rows via a master-detail route, but the base path still matches. */
function pathForRow(row: FlowRow): string {
  return row.paths[0];
}

describe(`VetTrack native flow walk (${PLATFORM})`, () => {
  before(async () => {
    await enterWebview();
  });

  for (const role of NATIVE_ROLES) {
    describe(`role: ${role}`, () => {
      before(async () => {
        await setDevRoleAndReload(role);
      });

      for (const row of rowsForPlatform(PLATFORM)) {
        const expected = expectedNativeOutcome(row, role);
        it(`${row.id} → ${expected.kind}${expected.to ? ` (${expected.to})` : ""}`, async () => {
          await navigate(pathForRow(row));
          const final = await settledPath();

          if (expected.kind === "redirect" || expected.kind === "guard-redirect") {
            // The router should have bounced us to the guard/redirect target.
            if (!pathMatchesTarget(final, expected.to)) {
              throw new Error(`${row.id}: landed on ${final}, expected redirect → ${expected.to}`);
            }
            return;
          }

          // expected: render — still on the row's path (query/detail extensions ok)…
          const base = pathForRow(row);
          if (!pathMatchesTarget(final, base) && !final.startsWith(base)) {
            throw new Error(`${row.id}: expected to stay on ${base}, landed on ${final}`);
          }
          // …with no error boundary mounted.
          expect(await isVisible("app-error-boundary")).toBe(false);
          expect(await isVisible("page-error-boundary")).toBe(false);
          // TODO(sim): tighten to a per-page content marker once the seeded sim state
          // is known (e.g. equipment list needs custody_state != untracked to populate).
        });
      }
    });
  }
});
