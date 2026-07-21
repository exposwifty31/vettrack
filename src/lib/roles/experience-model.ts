/**
 * Role → experience model (Phase 2 / IV.2-A keystone).
 *
 * The single client-side source of truth for how a role SHAPES the UI. Pure TS —
 * no React/DOM/wouter imports — so the native app + `@vettrack/contracts` can
 * consume it as a spec (I.2 portability). This is UX shaping ONLY; the server
 * stays the enforcement boundary (`requireAdmin` / authority evaluators). A client
 * capability grant never authorizes anything on its own.
 *
 * Phase 2 is behavior-preserving: `admin` sees today's admin view, everyone else
 * today's non-admin view. Per-role home/nav differentiation lands in Phase 3/8 by
 * adding `homeSurface` / nav-delta consumers — not by changing this map.
 */
import type { UserRole, ShiftRole } from "@/types/platform";

/** Five UI archetypes. The 7 client roles collapse onto these (total map). */
export type ExperienceArchetype = "admin" | "vet" | "lead" | "tech" | "student";

/**
 * Two home compositions (Phase 3 / A2, I.4 locked v1 split). `ops` = admin + lead
 * (coverage / readiness / exceptions); `floor` = vet / tech / student (scan / tasks /
 * my-equipment). Derived from the PERMANENT archetype — shift elevation never reshapes
 * home (I.4). Full 5-archetype differentiation is Phase 8; this is the v1 two-way split.
 */
export type HomeSurface = "ops" | "floor";

/**
 * Closed capability union (bounded-enum doctrine). Extend deliberately: every new
 * member needs an archetype grant below and, if server-enforced, an authority
 * evaluator. `management.*` are defined for the Phase 6 web console (admin full;
 * lead read-only) and have no Phase 2 consumer yet.
 */
export type Capability =
  | "codeBlue.manage" // access Code Blue management — layout `canAccessCodeBlue`
  | "shiftChat.broadcast" // send a broadcast in shift chat
  | "shiftChat.pin" // pin a shift-chat message
  | "equipment.vetActions" // vet-only equipment actions — `hasVetAccess`
  | "app.adminNav" // see `adminOnly` nav sections — today's `isAdmin` nav gate
  | "management.web" // Phase 6: reach the web management console
  | "management.webWrite" // Phase 6: mutate in the web console (admin only)
  | "equipment.actOffShift"; // scan/checkout/claim without an active roster shift — doctor pilot 2026-07; admins per owner decision 2026-07

/**
 * Capabilities that respond to shift elevation (`roleSource === "shift"` overlays
 * the effective role's grant for these). Only shift-scoped collaboration reacts to
 * a shift; standing clinical/admin authority (code-blue, vet actions, admin nav)
 * stays keyed to the permanent role + `isAdmin`. This mirrors the pre-Phase-2
 * checks exactly: `ShiftChatPanel` reads `effectiveRole`, `layout.canAccessCodeBlue`
 * and `hasVetAccess` read the permanent `role`.
 */
const SHIFT_SENSITIVE: ReadonlySet<Capability> = new Set<Capability>([
  "shiftChat.broadcast",
  "shiftChat.pin",
]);

/**
 * Total map — every one of the 7 client roles, no default fallthrough (II role divergence).
 *
 * NOTE — intentional client↔server divergence (do not "align" without a plan change):
 * this follows the IV.2-A keystone — `senior_technician`/`lead_technician` → lead,
 * `technician`/`vet_tech` → tech. The SERVER's `normalizeUserRole`
 * (`server/middleware/auth.ts`) instead collapses the two ALIASES (`lead_technician`,
 * `vet_tech`) to `student`, since they are not real DB roles. These disagree, but it
 * is safe: `normalizeUserRole` runs at every authUser construction, so the client's
 * `useAuth().role` is always one of the 5 real DB roles — an alias never reaches this
 * map at runtime. The server stays the enforcement boundary; a client capability grant
 * authorizes nothing on its own. If an alias ever did flow raw, the client would show
 * affordances the server 403s (a UX bug, not a privilege escalation), and
 * `capabilitiesForRole`'s `?? []` guard degrades any unmapped value to no-grant.
 */
const ARCHETYPE_BY_ROLE: Record<UserRole, ExperienceArchetype> = {
  admin: "admin",
  vet: "vet",
  senior_technician: "lead",
  lead_technician: "lead",
  technician: "tech",
  vet_tech: "tech",
  student: "student",
};

export function archetypeForRole(role: UserRole | ShiftRole): ExperienceArchetype {
  return ARCHETYPE_BY_ROLE[role];
}

/**
 * Archetype → home surface (Phase 3 / A2). ops = admin + lead; floor = vet + tech +
 * student (I.4 locked). Total over the 5 archetypes; the `?? "floor"` degrade mirrors
 * `capabilitiesForRole` so an unmapped runtime value never throws — floor is the
 * least-capable home, the safe default (matches the pre-Phase-3 non-admin view).
 */
const HOME_SURFACE_BY_ARCHETYPE: Record<ExperienceArchetype, HomeSurface> = {
  admin: "ops",
  lead: "ops",
  vet: "floor",
  tech: "floor",
  student: "floor",
};

/** Home surface for a role, via its archetype. Derives from the PERMANENT role — never
 *  the shift overlay (I.4: shift changes capabilities only, never home/nav shape). */
export function homeSurfaceForRole(role: UserRole | ShiftRole): HomeSurface {
  return HOME_SURFACE_BY_ARCHETYPE[archetypeForRole(role)] ?? "floor";
}

/**
 * Standing authority / governance capabilities WITHHELD from the student archetype.
 *
 * Doctrine — "student = restricted tech" (Phase 8): a student is a technician MINUS
 * standing authority. So `student` is DERIVED as `tech − WITHHELD_FROM_STUDENT`,
 * never hand-listed — the mirror of the SECONDARY_ADMIN_CAPS "admin set MINUS
 * shift-chat" style below. The payoff is a one-way ratchet: a capability added to
 * `tech` later either flows to students automatically (a shared floor affordance) or
 * is named here (standing authority) — it can never SILENTLY leak into the student
 * grant. Withheld = code-blue command + admin nav + the web-console grants. Shift-
 * scoped collaboration (shiftChat.*) is deliberately NOT withheld: a student elevated
 * on a shift still earns it through the SHIFT_SENSITIVE overlay in `resolveCapabilities`,
 * which this set does not touch (it filters only the permanent tech→student base).
 *
 * Today `tech = ["codeBlue.manage"]`, so the derivation yields `student = []` —
 * BYTE-IDENTICAL to the pre-Phase-8 literal `student: []` (see experience-model test).
 * Extend THIS set (never the student list) if an authority cap ever lands in tech.
 */
const WITHHELD_FROM_STUDENT: ReadonlySet<Capability> = new Set<Capability>([
  "codeBlue.manage",
  "app.adminNav",
  "management.web",
  "management.webWrite",
  "equipment.actOffShift",
]);

/** Technician base grant — the floor authority the student archetype is a restricted subset of. */
const TECH_CAPABILITIES: readonly Capability[] = ["codeBlue.manage"];

/**
 * Base capability grant per archetype — reproduces the pre-Phase-2 ad-hoc checks:
 * - codeBlue.manage      : isAdmin || vet || senior_technician || technician  (layout:466)
 * - shiftChat.broadcast  : senior_technician || admin                         (ShiftChatPanel)
 * - shiftChat.pin        : vet || senior_technician || admin                  (ShiftChatPanel)
 * - equipment.vetActions : isAdmin || vet                                     (equipment-detail:177)
 * - app.adminNav         : isAdmin                                            (nav `!adminOnly || isAdmin`)
 */
const CAPABILITIES_BY_ARCHETYPE: Record<ExperienceArchetype, readonly Capability[]> = {
  admin: [
    "codeBlue.manage",
    "shiftChat.broadcast",
    "shiftChat.pin",
    "equipment.vetActions",
    "app.adminNav",
    "management.web",
    "management.webWrite",
    "equipment.actOffShift",
  ],
  vet: ["codeBlue.manage", "shiftChat.pin", "equipment.vetActions", "equipment.actOffShift"],
  lead: ["codeBlue.manage", "shiftChat.broadcast", "shiftChat.pin", "management.web"],
  tech: TECH_CAPABILITIES,
  // student = tech − WITHHELD_FROM_STUDENT (restricted technician). Derived, not
  // literal, so it is a strict subset of tech by construction. Today → [].
  student: TECH_CAPABILITIES.filter((c) => !WITHHELD_FROM_STUDENT.has(c)),
};

/**
 * Per-archetype native tab-bar ORDER (Phase 8 seam). DORMANT data — like
 * `management.web`, which shipped consumer-less in Phase 2, this ships without a
 * reader: `NativeTabBar` is frozen this phase. It records the intended primary-tab
 * emphasis per archetype so a future tab bar can reorder without re-deriving intent:
 *   - vet     → clinical-first (code-blue / rooms lead)
 *   - tech    → scan / tasks first (custody throughput)
 *   - student → guided: tasks first, emergency last (read-mostly)
 *   - admin / lead → ops-first (fleet coverage / exceptions)
 * Values are real native-nav item ids (`src/lib/routes/native-nav-model.ts`); the
 * experience-model test asserts totality over the 5 archetypes + id validity. This
 * is ORDERING only — it grants nothing; access stays the capability set + server.
 */
export const TAB_BAR_ORDER_BY_ARCHETYPE: Record<ExperienceArchetype, readonly string[]> = {
  admin: ["today", "equipment", "alerts", "rooms", "scan"],
  lead: ["today", "equipment", "alerts", "rooms", "scan"],
  vet: ["today", "emergency", "rooms", "equipment", "tasks"],
  tech: ["today", "scan", "tasks", "equipment", "emergency"],
  student: ["today", "tasks", "equipment", "scan", "emergency"],
};

/**
 * Capabilities granted by the secondary-admin path (`secondaryRole === "admin"`,
 * surfaced as `isAdmin`). This is the admin set MINUS shift-chat: the pre-Phase-2
 * code-blue / vet-access / nav checks read `isAdmin` (so they honor a secondary
 * admin), but `ShiftChatPanel` reads `role === "admin"` (primary only). Folding the
 * full admin set on `isAdmin` would over-grant shift-chat to a secondary admin.
 */
const SECONDARY_ADMIN_CAPS: readonly Capability[] = [
  "codeBlue.manage",
  "equipment.vetActions",
  "app.adminNav",
  "management.web",
  "management.webWrite",
  "equipment.actOffShift",
];

export interface RoleExperience {
  archetype: ExperienceArchetype;
  /** Which home composition renders (Phase 3). Derived from the permanent archetype;
   *  invariant under shift elevation (I.4). */
  homeSurface: HomeSurface;
  capabilities: ReadonlySet<Capability>;
}

export interface ExperienceInput {
  /** Permanent role — drives archetype + standing capabilities. */
  role: UserRole;
  /** Shift-effective role — overlays SHIFT_SENSITIVE capabilities only. */
  effectiveRole: UserRole | ShiftRole;
  roleSource: "shift" | "permanent";
  /** `role === "admin" || secondaryRole === "admin"` — folds in the secondary-admin path. */
  isAdmin: boolean;
}

/**
 * Effective capability set:
 *   base(archetype(role))
 *   ∪ (isAdmin ? SECONDARY_ADMIN_CAPS : ∅)                 // secondary-admin, minus shift-chat
 *   ∪ (shift ? SHIFT_SENSITIVE ∩ base(archetype(effectiveRole)) : ∅)
 * The overlay adds capabilities only; it never changes archetype (I.4 — shift never
 * reshapes home/nav).
 */
/**
 * Base capabilities for a role, defensive against runtime values outside the 7-key
 * map. `effectiveRole` in particular can arrive unnormalized (a stale offline-cache
 * snapshot, or a legacy alias in a `vt_shifts.role` row — see role-resolution),
 * violating the compile-time type. An unknown role degrades to no grant — matching
 * the pre-Phase-2 string checks, which returned `false` — instead of throwing on
 * `for...of undefined` and crashing every nav render.
 */
function capabilitiesForRole(role: UserRole | ShiftRole): readonly Capability[] {
  return CAPABILITIES_BY_ARCHETYPE[archetypeForRole(role)] ?? [];
}

export function resolveCapabilities(input: ExperienceInput): ReadonlySet<Capability> {
  const caps = new Set<Capability>(capabilitiesForRole(input.role));
  if (input.isAdmin) {
    for (const c of SECONDARY_ADMIN_CAPS) caps.add(c);
  }
  if (input.roleSource === "shift") {
    for (const c of capabilitiesForRole(input.effectiveRole)) {
      if (SHIFT_SENSITIVE.has(c)) caps.add(c);
    }
  }
  return caps;
}

export function buildRoleExperience(input: ExperienceInput): RoleExperience {
  return {
    archetype: archetypeForRole(input.role),
    homeSurface: homeSurfaceForRole(input.role),
    capabilities: resolveCapabilities(input),
  };
}

export function can(experience: RoleExperience, capability: Capability): boolean {
  return experience.capabilities.has(capability);
}

/**
 * Filter admin-gated nav items behind the experience object — the single home for
 * the old `!item.adminOnly || isAdmin` gate, now expressed as the `app.adminNav`
 * capability (byte-identical; see tests). Generic over any `{ adminOnly?: boolean }`
 * shape so the web nav model (`NavNode`) and native sections (`NativeNavSection`)
 * share one implementation.
 */
export function filterAdminNav<T extends { adminOnly?: boolean }>(
  items: readonly T[],
  experience: RoleExperience,
): T[] {
  const showAdmin = can(experience, "app.adminNav");
  return items.filter((item) => !item.adminOnly || showAdmin);
}

/**
 * Custody-only archetypes: their entire system footprint is equipment custody +
 * inventory (owner scope, 2026-07). Today only the student — a supervised trainee
 * whose nav is pared to Home · Scan (checkout/checkin) · Equipment · My Equipment ·
 * Inventory (dispense/restock). See [[student-role-meaning]].
 */
const CUSTODY_ONLY_ARCHETYPES: ReadonlySet<ExperienceArchetype> = new Set<ExperienceArchetype>(["student"]);

/**
 * Nav-item keys a custody-only archetype may see; everything else is hidden.
 * Matched against BOTH the item id (native sections, web NAV nodes) and the item
 * href (web layout nav items, which have no id) so one filter covers every nav
 * shape. Anything not listed — Command Board, Alerts, Rooms, Emergency, Tasks,
 * admin — is dropped for the student.
 */
const CUSTODY_ONLY_NAV_KEYS: ReadonlySet<string> = new Set<string>([
  // ids
  "today", // home
  "scan", // scan = checkout/checkin
  "equipment", // find equipment to check out
  "mine", // my equipment (return)
  "inventory", // dispense / restock
  // hrefs (web layout nav items key on href, not id)
  "/", // layout.tsx Home nav item uses "/" (Topbar/sidebar Home uses "/home")
  "/home",
  "/scan",
  "/equipment",
  "/my-equipment",
  "/inventory",
]);

/** True when this experience is restricted to the custody-only nav set. */
export function isCustodyOnly(experience: RoleExperience): boolean {
  return CUSTODY_ONLY_ARCHETYPES.has(experience.archetype);
}

/**
 * A student is a supervised trainee whose operational footprint is deliberately
 * narrow — equipment checkout/checkin + inventory dispense/restock only — so their
 * nav must not offer surfaces they can't act on. This keeps only the custody
 * allow-set (matched by id OR href, since the web layout keys items on `href` and
 * the native model on `id`); it is a no-op for every other archetype. Layered
 * after {@link filterAdminNav} on both the native sections and the web nav so the
 * two filters compose without either re-deriving the other's rules.
 */
export function filterCustodyNav<T extends { id?: string; href?: string }>(
  items: readonly T[],
  experience: RoleExperience,
): T[] {
  if (!isCustodyOnly(experience)) return [...items];
  return items.filter(
    (item) =>
      (item.id !== undefined && CUSTODY_ONLY_NAV_KEYS.has(item.id)) ||
      (item.href !== undefined && CUSTODY_ONLY_NAV_KEYS.has(item.href)),
  );
}

/**
 * Single source for a flat (web) nav's visible items, so `layout.tsx` /
 * `IconSidebar` / `Topbar` compose the admin + custody filters identically instead
 * of re-deriving the order per shell.
 */
export function visibleNavItems<T extends { adminOnly?: boolean; id?: string; href?: string }>(
  items: readonly T[],
  experience: RoleExperience,
): T[] {
  return filterCustodyNav(filterAdminNav(items, experience), experience);
}

/**
 * Single source for a native nav's visible sections (same admin + custody rules as
 * {@link visibleNavItems}, applied per section). Callers that need a further
 * per-item filter (e.g. MoreSheet hiding tab-bar items) apply it on top and re-drop
 * empties.
 */
export function visibleNavSections<
  I extends { id: string },
  S extends { adminOnly?: boolean; items: I[] },
>(sections: readonly S[], experience: RoleExperience): S[] {
  return filterAdminNav(sections, experience)
    .map((section) => ({ ...section, items: filterCustodyNav(section.items, experience) }))
    .filter((section) => section.items.length > 0);
}
