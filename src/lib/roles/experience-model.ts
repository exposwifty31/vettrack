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

/** Total map — every one of the 7 client roles, no default fallthrough (II role divergence). */
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
export function resolveCapabilities(input: ExperienceInput): ReadonlySet<Capability> {
  const caps = new Set<Capability>(CAPABILITIES_BY_ARCHETYPE[archetypeForRole(input.role)]);
  if (input.isAdmin) {
    for (const c of SECONDARY_ADMIN_CAPS) caps.add(c);
  }
  if (input.roleSource === "shift") {
    for (const c of CAPABILITIES_BY_ARCHETYPE[archetypeForRole(input.effectiveRole)]) {
      if (SHIFT_SENSITIVE.has(c)) caps.add(c);
    }
  }
  return caps;
}

export function buildRoleExperience(input: ExperienceInput): RoleExperience {
  return {
    archetype: archetypeForRole(input.role),
    capabilities: resolveCapabilities(input),
  };
}

export function can(experience: RoleExperience, capability: Capability): boolean {
  return experience.capabilities.has(capability);
}
