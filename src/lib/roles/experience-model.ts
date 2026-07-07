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
  | "management.webWrite"; // Phase 6: mutate in the web console (admin only)

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
  ],
  vet: ["codeBlue.manage", "shiftChat.pin", "equipment.vetActions"],
  lead: ["codeBlue.manage", "shiftChat.broadcast", "shiftChat.pin", "management.web"],
  tech: ["codeBlue.manage"],
  student: [],
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
