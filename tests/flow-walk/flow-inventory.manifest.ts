/**
 * Flow-walk manifest — the machine-readable form of `docs/audit/FLOW_INVENTORY.md`,
 * reconciled against the CURRENT `src/app/routes.tsx` (the inventory doc was
 * generated 2026-07-06 and has since drifted: several rows it lists as pages are
 * now redirects, and the Phase-6 web management console did not exist yet).
 *
 * This module is the single source of truth for the Phase-10 III.6 live walk:
 *   - `tests/flow-walk/web-board-walk.spec.ts` consumes the web/board/marketing rows.
 *   - `tests/flow-walk/native/native-walk.e2e.ts` consumes the iphone/ipad rows.
 *   - `tests/flow-walk/flow-inventory.manifest.test.ts` cross-checks it against
 *     `routes.tsx` so it cannot silently rot when routes change again.
 *
 * KEEP THIS DEPENDENCY-LIGHT: pure data + pure derivation. No imports from `src/`
 * (it runs in both the vitest node env and the Playwright runner).
 */

/**
 * localStorage key the in-app Dev Role Switcher writes (src/lib/auth-fetch.ts).
 * Lives here (not in walk-helpers) so both the Playwright walk and the native
 * Appium walk can import it without pulling in @playwright/test.
 */
export const DEV_ROLE_KEY = "vt:devRole";

export type Platform = "iphone" | "ipad" | "web" | "board" | "marketing";

/** Guard/registration shape as read from routes.tsx. Drives outcome derivation. */
export type Guard =
  | "marketing" // marketing platform target, chrome-free (signin/signup/legal)
  | "auth" // AuthGuard only — renders on every app platform
  | "custody" // AuthGuard > CustodyGuard — student archetype redirected to /equipment
  | "web-only" // AuthGuard > WebOnlyGuard — native redirects to /home, mobile browser shows guard screen
  | "management" // AuthGuard > WebOnlyGuard > ManagementGuard — non-management.web sees access-denied
  | "kiosk" // /board — AuthGuard only, BoardShell kiosk (board/web)
  | "redirect"; // pure <Redirect> — no page renders

/**
 * Terminal state a walk row is expected to reach on a given platform.
 *
 * Note: `guard-screen` is **observed-only** — `classifyActual` (walk-helpers)
 * returns it to name a wrong-surface if one appears, but the derivations never
 * produce it: the web walk runs at a desktop viewport, so WebOnlyGuard renders
 * rather than showing its <1024 screen. `access-denied` IS derived for
 * `webAdminFloor` rows (T22: pages with a literal-admin floor render
 * ManagementAccessDenied for management.web roles below admin, walk-verified);
 * anywhere else it appears it is a wrong-surface mismatch.
 */
export type OutcomeKind =
  | "render" // page renders without a crash surface
  | "redirect" // navigates away to `to`
  | "guard-redirect" // WebOnlyGuard native redirect to /home
  | "guard-screen" // WebOnlyGuard mobile-browser (<1024) dark guard screen — observed-only
  | "management-web-gate" // AuthGuard desktop gate (T-31/R-WEB-01) — non-management.web role on the web console
  | "access-denied" // ManagementGuard inline "not authorized" surface — observed-only
  | "kiosk"; // BoardShell kiosk chrome

/** Coarse role gating, from the guard wrapping the route. */
export type RoleGating = "open" | "custody" | "management";

/** Role archetypes to cycle, per FLOW_INVENTORY.md §"How to complete the live walk". */
export const ROLE_ARCHETYPES = [
  "admin",
  "vet",
  "senior_technician",
  "technician",
  "student",
] as const;
export type RoleArchetype = (typeof ROLE_ARCHETYPES)[number];

/**
 * Roles that hold the `management.web` capability. Two things gate on this:
 *  1. AuthGuard's desktop clause (T-31/R-WEB-01): the ENTIRE desktop web app is a
 *     management console — a role without `management.web` gets ManagementWebGate on
 *     every route (it preempts WebOnlyGuard/ManagementGuard, which mount inside it).
 *  2. ManagementGuard itself (for the console sub-routes).
 * Per AuthGuard.tsx:171 the set is admin + senior_technician + lead_technician +
 * secondary-admin; of the walk archetypes that is admin + senior_technician.
 */
const MANAGEMENT_ROLES: readonly RoleArchetype[] = ["admin", "senior_technician"];
/** The custody-only archetype CustodyGuard redirects away (native only — see note). */
const CUSTODY_ONLY_ROLES: readonly RoleArchetype[] = ["student"];

/** True when the role may enter the desktop web console at all (T-31/R-WEB-01). */
export function roleHasManagementWeb(role: RoleArchetype): boolean {
  return MANAGEMENT_ROLES.includes(role);
}

export interface FlowRow {
  /** Stable slug, used as the matrix key + screenshot name. */
  id: string;
  /** FLOW_INVENTORY.md section this maps to (drift rows say "drift" / "post-inventory"). */
  group: string;
  /** Concrete paths this row covers; the first is the one the web walk navigates. */
  paths: string[];
  guard: Guard;
  /** Platforms on which this flow is reachable (walk targets). */
  platforms: Platform[];
  roleGating: RoleGating;
  /** Redirect target for `guard: "redirect"` (and the canonical kiosk redirects). */
  redirectTo?: string;
  /**
   * Where the redirect chain SETTLES on the mobile shell when it differs from
   * `redirectTo` (deep-link forwards: /equipment?scan=1 → /scan in the shell).
   */
  nativeRedirectTo?: string;
  /**
   * The page itself redirects on non-mobile shells (e.g. scan.tsx renders
   * ScanScreen only in the mobile shell; desktop gets the equipment scan
   * overlay). Applies to management.web roles — others hit the T-31 gate first.
   */
  webRedirectTo?: string;
  /**
   * Page enforces a literal-admin floor INSIDE the console (T22
   * ManagementAccessDenied): management.web roles below admin see access-denied
   * on web. (Server-side these surfaces are requireAdmin-only; contrast
   * /admin/code-blue-history, whose floor is management.web.)
   */
  webAdminFloor?: boolean;
  /** iPad-native serves this via a master-detail route instead of the list path. */
  tabletMasterDetail?: boolean;
  /** True when the doc listed this as a page but routes.tsx now redirects/reshapes it. */
  drift?: boolean;
  notes?: string;
}

export interface ExpectedOutcome {
  kind: OutcomeKind;
  to?: string;
  /**
   * "firm" → a mismatch is a real defect (fails the row).
   * "observe" → the doc/guard capability mapping is not fully pinned; record but
   *   don't fail (e.g. does `vet` hold management.web? verified only by walking).
   */
  confidence: "firm" | "observe";
}

/**
 * The reconciled inventory. Covers all of FLOW_INVENTORY.md's 31 rows (several
 * split into multiple manifest rows for per-path guard precision), plus a
 * drift-tagged block of routes.tsx surfaces the 2026-07-06 doc predates.
 */
export const FLOW_ROWS: FlowRow[] = [
  // ── Marketing (unauthenticated, chrome-free) — FLOW_INVENTORY §Marketing ──
  { id: "signin", group: "marketing", paths: ["/signin"], guard: "marketing", platforms: ["marketing"], roleGating: "open" },
  { id: "signup", group: "marketing", paths: ["/signup"], guard: "marketing", platforms: ["marketing"], roleGating: "open" },
  { id: "legal-support", group: "marketing", paths: ["/privacy", "/terms", "/support"], guard: "marketing", platforms: ["marketing"], roleGating: "open" },

  // ── Core operational (AuthGuard) — FLOW_INVENTORY §Core operational ──
  { id: "home", group: "core", paths: ["/home", "/"], guard: "auth", platforms: ["iphone", "ipad", "web", "board"], roleGating: "open", notes: "RootRoute: '/' resolves to home under auth, marketing landing when signed out." },
  { id: "equipment-list", group: "core", paths: ["/equipment"], guard: "auth", platforms: ["iphone", "ipad", "web"], roleGating: "open", tabletMasterDetail: true, notes: "iPad-native serves /equipment via the /equipment/:id? master-detail (routes.tsx isNativeTablet); the base path still resolves there." },
  { id: "equipment-new", group: "core", paths: ["/equipment/new"], guard: "auth", platforms: ["iphone", "ipad", "web"], roleGating: "open" },
  { id: "equipment-detail", group: "core", paths: ["/equipment/eq1"], guard: "auth", platforms: ["iphone", "ipad", "web"], roleGating: "open", notes: "Device audit gotcha: non-UUID ids like 'eq1' may 404 against a real DB; walk against a seeded id." },
  { id: "equipment-edit", group: "core", paths: ["/equipment/eq1/edit"], guard: "auth", platforms: ["iphone", "ipad", "web"], roleGating: "open" },
  { id: "tasks", group: "core", paths: ["/equipment/tasks"], guard: "auth", platforms: ["iphone", "ipad", "web", "board"], roleGating: "open", notes: "Tasks.tsx inline-redirects the custody-only (student) archetype; frozen appointmentsPage.* keys." },
  { id: "scan", group: "core", paths: ["/scan"], guard: "auth", platforms: ["iphone", "ipad", "web"], roleGating: "open", webRedirectTo: "/equipment", notes: "scan.tsx renders ScanScreen only in the mobile shell; desktop self-redirects toward /equipment?scan=1, but web has no scanner (BUG-016) so the settled URL is pathname /equipment — the scan=1 query is inert there and matched pathname-only." },
  { id: "scan-alias-redirect", group: "core", paths: ["/equipment/scan"], guard: "redirect", platforms: ["iphone", "ipad", "web"], roleGating: "open", redirectTo: "/equipment?scan=1", webRedirectTo: "/equipment", nativeRedirectTo: "/scan", drift: true, notes: "DRIFT: doc listed /equipment/scan as a page; now <Redirect> to /equipment?scan=1. WEB settles at pathname /equipment (scan=1 is inert — no web scanner, BUG-016 — and non-deterministic in the settled URL: the desktop list cleans it, the T-31 gate leaves it), so web matches pathname-only. The mobile shell forwards ?scan=1 on to /scan (the scanner is its own surface there — equipment-list.tsx / EquipmentMasterDetail)." },
  { id: "equipment-ops-redirect", group: "core", paths: ["/equipment/maintenance", "/equipment/intelligence"], guard: "redirect", platforms: ["iphone", "ipad", "web"], roleGating: "open", redirectTo: "/equipment", drift: true, notes: "DRIFT: doc §Core 'Equipment ops' pages are now query-param redirects (/equipment?status=maintenance and /equipment)." },
  { id: "alerts", group: "core", paths: ["/alerts"], guard: "custody", platforms: ["iphone", "ipad", "web"], roleGating: "custody" },
  { id: "my-equipment", group: "core", paths: ["/my-equipment"], guard: "auth", platforms: ["iphone", "ipad", "web"], roleGating: "open" },
  { id: "my-profile", group: "core", paths: ["/my-profile"], guard: "auth", platforms: ["iphone", "ipad", "web"], roleGating: "open" },
  { id: "rooms", group: "core", paths: ["/rooms"], guard: "custody", platforms: ["iphone", "ipad", "web"], roleGating: "custody", tabletMasterDetail: true, notes: "iPad-native uses /rooms/:id? master-detail." },
  { id: "locations", group: "core", paths: ["/locations"], guard: "custody", platforms: ["iphone", "ipad", "web"], roleGating: "custody", tabletMasterDetail: true, notes: "Alias of rooms; iPad-native uses /locations/:id? master-detail." },
  { id: "code-blue", group: "core", paths: ["/code-blue"], guard: "auth", platforms: ["iphone", "ipad", "web", "board"], roleGating: "open", notes: "Emergency: page renders for all; session start is server-gated. Requires online (offline-emergency-block)." },
  { id: "crash-cart", group: "core", paths: ["/crash-cart"], guard: "auth", platforms: ["iphone", "ipad", "web"], roleGating: "open" },
  { id: "handoff", group: "core", paths: ["/handoff"], guard: "auth", platforms: ["iphone", "ipad", "web"], roleGating: "open" },
  { id: "emergency-kit", group: "core", paths: ["/critical-kit-check", "/emergency-equipment-log", "/emergency-equipment-history"], guard: "auth", platforms: ["iphone", "ipad", "web"], roleGating: "open" },
  { id: "inventory", group: "core", paths: ["/inventory"], guard: "auth", platforms: ["iphone", "ipad", "web"], roleGating: "open" },
  { id: "inventory-items", group: "core", paths: ["/inventory-items"], guard: "auth", platforms: ["iphone", "ipad", "web"], roleGating: "open", tabletMasterDetail: true, notes: "iPad-native serves /inventory-items via the /inventory-items/:id? master-detail; the base path still resolves there." },
  { id: "app-surfaces", group: "core", paths: ["/settings", "/help", "/whats-new"], guard: "auth", platforms: ["iphone", "ipad", "web"], roleGating: "open", notes: "/stability and /app-tour now redirect to /home (see app-surfaces-redirect)." },
  { id: "app-surfaces-redirect", group: "core", paths: ["/stability", "/app-tour"], guard: "redirect", platforms: ["iphone", "ipad", "web"], roleGating: "open", redirectTo: "/home", drift: true, notes: "DRIFT: doc §Core listed /stability + /app-tour as surfaces; now redirect to /home." },
  { id: "shift-chat", group: "core", paths: ["/shift-chat/s1"], guard: "auth", platforms: ["iphone", "ipad", "web"], roleGating: "open" },
  { id: "shift-ops-redirect", group: "core", paths: ["/shift-handover", "/pending", "/pending-emergencies"], guard: "redirect", platforms: ["iphone", "ipad", "web"], roleGating: "open", redirectTo: "/equipment", drift: true, notes: "DRIFT: doc §Core 'Shift ops' row — only /shift-chat/:shiftId is still a page; the rest redirect to /equipment." },

  // ── Web-only / large-format (AuthGuard > WebOnlyGuard) — FLOW_INVENTORY §Web-only ──
  { id: "board-kiosk", group: "web-only", paths: ["/board"], guard: "kiosk", platforms: ["web", "board"], roleGating: "open", notes: "Canonical Command Center. AuthGuard-only → BoardShell. Native (Capacitor) resolves to the mobile shell before the board path check." },
  { id: "board-alias-redirect", group: "web-only", paths: ["/equipment/board", "/display", "/equipment-board"], guard: "redirect", platforms: ["iphone", "ipad", "web", "board"], roleGating: "open", redirectTo: "/board", drift: true, notes: "DRIFT: doc pointed these at /equipment/board; now all redirect to the canonical /board kiosk." },
  { id: "qr-print", group: "web-only", paths: ["/equipment/eq1/qr", "/print"], guard: "web-only", platforms: ["web", "board"], roleGating: "open" },
  { id: "emergency-wall", group: "web-only", paths: ["/code-blue/display", "/emergency-equipment-wall"], guard: "web-only", platforms: ["web", "board"], roleGating: "open", notes: "Emergency wall displays; SSE only, never cached (emergency denylist)." },
  { id: "management-dashboard", group: "web-only", paths: ["/dashboard"], guard: "management", platforms: ["web", "board"], roleGating: "management" },
  { id: "analytics", group: "web-only", paths: ["/analytics", "/analytics/shift-leaderboard"], guard: "management", platforms: ["web", "board"], roleGating: "management", notes: "/analytics/shift-leaderboard is WebOnlyGuard w/o ManagementGuard; /analytics/outcome-kpi redirects to /analytics." },
  { id: "procurement", group: "web-only", paths: ["/procurement"], guard: "management", platforms: ["web", "board"], roleGating: "management" },
  { id: "audit-log", group: "web-only", paths: ["/audit-log"], guard: "web-only", platforms: ["web", "board"], roleGating: "open", webAdminFloor: true, notes: "Legacy audit surface (WebOnlyGuard, no ManagementGuard) with an in-page literal-admin floor (T22). Distinct from the new /admin/audit-log console." },

  // ── Admin / management (AuthGuard; not WebOnly-fenced, II.1) — FLOW_INVENTORY §Admin ──
  { id: "admin-home", group: "admin", paths: ["/admin", "/admin/metrics"], guard: "auth", platforms: ["iphone", "ipad", "web", "board"], roleGating: "open", webAdminFloor: true, notes: "II.1: /admin + /admin/metrics are AuthGuard-only (NOT WebOnly-fenced). Server enforces admin actions; the pages render the T22 denial below literal admin." },
  { id: "admin-config", group: "admin", paths: ["/admin/shifts", "/admin/asset-types", "/admin/docks"], guard: "auth", platforms: ["iphone", "ipad", "web"], roleGating: "open", webAdminFloor: true },
  { id: "admin-history", group: "admin", paths: ["/admin/code-blue-history"], guard: "auth", platforms: ["iphone", "ipad", "web"], roleGating: "open", notes: "/admin/medication-integrity now redirects to /admin (see legacy-med-integrity-redirect)." },

  // ── Post-inventory: Phase-6 web management console (routes.tsx, absent from the 2026-07-06 doc) ──
  {
    id: "management-console",
    group: "post-inventory",
    paths: [
      "/admin/integrations",
      "/admin/webhooks",
      "/admin/notifications",
      "/admin/rfid-readers",
      "/admin/governance",
      "/admin/audit-log",
      "/admin/inventory",
      "/admin/people",
      "/admin/displays",
      "/ops/health",
    ],
    guard: "management",
    platforms: ["web", "board"],
    roleGating: "management",
    drift: true,
    notes: "POST-INVENTORY: the AuthGuard > WebOnlyGuard > ManagementGuard web console (program-plan.md 'web app as management console'). Not in FLOW_INVENTORY.md.",
  },

  // ── Legacy redirects & removed scope — FLOW_INVENTORY §Legacy ──
  { id: "legacy-tasks-alias", group: "legacy", paths: ["/appointments", "/equipment-tasks"], guard: "redirect", platforms: ["iphone", "ipad", "web"], roleGating: "open", redirectTo: "/equipment/tasks" },
  { id: "legacy-med-integrity-redirect", group: "legacy", paths: ["/admin/medication-integrity"], guard: "redirect", platforms: ["iphone", "ipad", "web"], roleGating: "open", redirectTo: "/admin", drift: true },
  { id: "legacy-meds", group: "legacy", paths: ["/meds", "/pharmacy-forecast"], guard: "redirect", platforms: ["iphone", "ipad", "web"], roleGating: "open", redirectTo: "/equipment/tasks", notes: "Removed scope (migrations 142-143). A rendered page here is a blocking finding." },
  { id: "legacy-patients", group: "legacy", paths: ["/patients", "/patients/p1"], guard: "redirect", platforms: ["iphone", "ipad", "web"], roleGating: "open", redirectTo: "/equipment", notes: "Removed scope. Rendered page = blocking finding." },
  { id: "legacy-billing", group: "legacy", paths: ["/billing", "/billing/x"], guard: "redirect", platforms: ["iphone", "ipad", "web"], roleGating: "open", redirectTo: "/equipment", notes: "Removed scope. Rendered page = blocking finding." },
  { id: "legacy-er", group: "legacy", paths: ["/er", "/er/x"], guard: "redirect", platforms: ["iphone", "ipad", "web"], roleGating: "open", redirectTo: "/equipment", notes: "Removed scope. Rendered page = blocking finding." },
];

/** Rows whose walk targets include the given platform. */
export function rowsForPlatform(platform: Platform): FlowRow[] {
  return FLOW_ROWS.filter((r) => r.platforms.includes(platform));
}

/**
 * Does an already-relative path match a redirect target, ignoring query strings?
 * Shared by both walks (web `walk-helpers.ts` and native `native-walk.e2e.ts`) so
 * the redirect-matching rule lives in exactly one place.
 */
export function pathMatchesTarget(actualPath: string, target?: string): boolean {
  if (!target) return true;
  const [actualPathname, actualQuery = ""] = splitPathQuery(actualPath);
  const [targetPathname, targetQuery = ""] = splitPathQuery(target);
  if (actualPathname !== targetPathname) return false;
  // Every query param the TARGET declares must be present with the same value in
  // the actual URL (extra params are allowed — a redirect may append its own).
  // Pathname-only matching let /equipment pass for a /equipment?scan=1 target,
  // so a scan redirect that never opened the scanner overlay false-passed.
  if (!targetQuery) return true;
  const actualParams = new URLSearchParams(actualQuery);
  for (const [key, value] of new URLSearchParams(targetQuery)) {
    if (actualParams.get(key) !== value) return false;
  }
  return true;
}

/** Split "/path?a=1" → ["/path", "a=1"]; no query → ["/path", ""]. */
function splitPathQuery(path: string): [string, string] {
  const q = path.indexOf("?");
  return q === -1 ? [path, ""] : [path.slice(0, q), path.slice(q + 1)];
}

/** Deduped union of web + board + marketing rows (what the browser walk can reach). */
export function webBoardRows(): FlowRow[] {
  const seen = new Set<string>();
  const out: FlowRow[] = [];
  for (const platform of ["marketing", "web", "board"] as const) {
    for (const row of rowsForPlatform(platform)) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
  }
  return out;
}

/** Guards that resolve to a NON-desktop platform target, so the console gate skips them. */
const UNGATED_GUARDS: readonly Guard[] = ["marketing", "kiosk", "redirect"];

/**
 * The rows a browser walk should navigate for a given role.
 *  - management.web roles enter the console → walk everything.
 *  - other roles see ManagementWebGate on every desktop route, so walking all of
 *    them re-proves the same gate N times. Instead walk the ungated rows (which are
 *    role-relevant) plus one representative row per gated guard family to confirm
 *    the gate fires — the matrix notes the sampling so nothing reads as full coverage.
 */
export function webWalkRows(role: RoleArchetype): FlowRow[] {
  const all = webBoardRows();
  if (roleHasManagementWeb(role)) return all;

  const ungated = all.filter((r) => UNGATED_GUARDS.includes(r.guard));
  const gatedByGuard = new Map<Guard, FlowRow>();
  for (const r of all) {
    if (UNGATED_GUARDS.includes(r.guard)) continue;
    if (!gatedByGuard.has(r.guard)) gatedByGuard.set(r.guard, r);
  }
  return [...ungated, ...gatedByGuard.values()];
}

function roleIsCustodyOnly(role: RoleArchetype): boolean {
  return CUSTODY_ONLY_ROLES.includes(role);
}

/**
 * The outcome a desktop-web (>=1024px) walk should observe for a row under a role.
 *
 * The dominant fact: the desktop web app is a MANAGEMENT CONSOLE (T-31/R-WEB-01).
 * AuthGuard renders ManagementWebGate for any non-`management.web` role, on EVERY
 * `desktop`-target route — so it preempts the per-route custody/web-only/management
 * guards. Only the surfaces that resolve to a NON-desktop platform target escape it:
 *   - `redirect` rows (<Redirect>, not wrapped in AuthGuard) → still redirect
 *   - `marketing` rows (marketing target) → still render
 *   - `kiosk` (/board resolves to the board target) → still the kiosk
 * Native/mobile derivations (where custody/web-only actually fire) live in
 * `expectedNativeOutcome`.
 */
export function expectedWebOutcome(row: FlowRow, role: RoleArchetype): ExpectedOutcome {
  // webRedirectTo is the web-settled target when it differs from redirectTo — a
  // deep-link query consumed/cleaned on web (e.g. /equipment/scan settles at
  // pathname /equipment, scan=1 inert per BUG-016). Falls back to redirectTo.
  if (row.guard === "redirect") return { kind: "redirect", to: row.webRedirectTo ?? row.redirectTo, confidence: "firm" };
  if (row.guard === "marketing") {
    // The walk is permanently authenticated (dev-bypass has no signed-out state),
    // and a signed-in visit to /signin or /signup bounces to /home (the pages'
    // redirect effects; signup goes via "/", which resolves to /home under auth).
    // Legal pages (/privacy, /terms, /support) have no bounce and render for all.
    if (row.id === "signin" || row.id === "signup") {
      return { kind: "redirect", to: "/home", confidence: "firm" };
    }
    return { kind: "render", confidence: "firm" };
  }
  if (row.guard === "kiosk") return { kind: "kiosk", confidence: "firm" };

  // Every remaining guard (auth/custody/web-only/management) is a `desktop`-target
  // route, so AuthGuard's console gate decides the outcome before any of them run.
  if (!roleHasManagementWeb(role)) {
    return { kind: "management-web-gate", confidence: "firm" };
  }

  // management.web roles reach the page itself — which may self-redirect on
  // non-mobile shells (scan.tsx) …
  if (row.webRedirectTo) {
    return { kind: "redirect", to: row.webRedirectTo, confidence: "firm" };
  }
  // … or enforce a literal-admin floor inside the console (T22).
  if (row.webAdminFloor && role !== "admin") {
    return { kind: "access-denied", confidence: "firm" };
  }

  // Otherwise the role clears the console gate, WebOnlyGuard (desktop), and
  // ManagementGuard — the page renders.
  return { kind: "render", confidence: "firm" };
}

/**
 * The outcome a Capacitor-native (iphone/ipad) walk should observe for a row.
 * WebOnlyGuard/ManagementGuard surfaces redirect to /home on native; redirects
 * still redirect; everything else renders in the mobile/tablet shell.
 */
export function expectedNativeOutcome(row: FlowRow, role: RoleArchetype): ExpectedOutcome {
  // Tasks.tsx inline-redirects the custody-only archetype to /equipment (see the
  // "tasks" row note) — so both the surface itself AND any redirect landing on
  // /equipment/tasks (/appointments, /meds, …) chain through for students.
  // Web never sees this: the T-31 console gate preempts the page there.
  if (
    roleIsCustodyOnly(role) &&
    (row.id === "tasks" || row.redirectTo === "/equipment/tasks")
  ) {
    return { kind: "redirect", to: "/equipment", confidence: "firm" };
  }
  if (row.guard === "redirect") {
    // Native uses nativeRedirectTo when the mobile shell forwards elsewhere
    // (e.g. /equipment/scan → /scan); otherwise the declared redirectTo. Note:
    // webRedirectTo is deliberately NOT consulted here — it is the web-settled
    // target, and native has its own shell behavior.
    return { kind: "redirect", to: row.nativeRedirectTo ?? row.redirectTo, confidence: "firm" };
  }
  if (row.guard === "web-only" || row.guard === "management") {
    return { kind: "guard-redirect", to: "/home", confidence: "firm" };
  }
  if (row.guard === "custody" && roleIsCustodyOnly(role)) {
    return { kind: "redirect", to: "/equipment", confidence: "firm" };
  }
  return { kind: "render", confidence: "firm" };
}
