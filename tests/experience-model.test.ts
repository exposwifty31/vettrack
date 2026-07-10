import { describe, it, expect } from "vitest";
import type { UserRole, ShiftRole } from "@/types/platform";
import {
  archetypeForRole,
  buildRoleExperience,
  can,
  filterAdminNav,
  filterCustodyNav,
  homeSurfaceForRole,
  isCustodyOnly,
  resolveCapabilities,
  TAB_BAR_ORDER_BY_ARCHETYPE,
  type Capability,
  type ExperienceArchetype,
  type ExperienceInput,
  type HomeSurface,
} from "@/lib/roles/experience-model";
import { NAV } from "@/lib/routes/nav-model";
import { getNativeNavSections } from "@/lib/routes/native-nav-model";

// The full 7-role client space (src/types/platform.ts) — the two aliases
// (lead_technician / vet_tech) are type-level only; the server never emits them,
// but the model must still map them (total map, no default fallthrough).
const ALL_ROLES: UserRole[] = [
  "admin",
  "vet",
  "technician",
  "senior_technician",
  "lead_technician",
  "vet_tech",
  "student",
];
const SHIFT_ROLES: ShiftRole[] = ["technician", "senior_technician", "admin"];

// ── Pre-Phase-2 predicates, inlined verbatim from the live source ──────────────
// These are the checks the capability migration must reproduce byte-for-byte.
const oldCanAccessCodeBlue = (role: UserRole, isAdmin: boolean) =>
  isAdmin || role === "vet" || role === "senior_technician" || role === "technician"; // layout.tsx:466
const oldCanSendBroadcast = (role: UserRole, effectiveRole: UserRole | ShiftRole) =>
  effectiveRole === "senior_technician" ||
  role === "senior_technician" ||
  effectiveRole === "admin" ||
  role === "admin"; // ShiftChatPanel.tsx
const oldCanPin = (role: UserRole, effectiveRole: UserRole | ShiftRole) =>
  effectiveRole === "vet" ||
  role === "vet" ||
  effectiveRole === "senior_technician" ||
  role === "senior_technician" ||
  effectiveRole === "admin" ||
  role === "admin"; // ShiftChatPanel.tsx
const oldHasVetAccess = (role: UserRole, effectiveRole: UserRole | ShiftRole, isAdmin: boolean) =>
  isAdmin || effectiveRole === "vet" || role === "vet"; // equipment-detail.tsx:177
const oldNavAdmin = (isAdmin: boolean) => isAdmin; // nav `!adminOnly || isAdmin`

describe("experience-model — archetype map", () => {
  it("maps every one of the 7 client roles (total, no undefined)", () => {
    for (const role of ALL_ROLES) {
      expect(archetypeForRole(role)).toBeDefined();
    }
  });

  it("collapses aliases per the keystone (senior+lead→lead, technician+vet_tech→tech)", () => {
    expect(archetypeForRole("admin")).toBe("admin");
    expect(archetypeForRole("vet")).toBe("vet");
    expect(archetypeForRole("senior_technician")).toBe("lead");
    expect(archetypeForRole("lead_technician")).toBe("lead");
    expect(archetypeForRole("technician")).toBe("tech");
    expect(archetypeForRole("vet_tech")).toBe("tech");
    expect(archetypeForRole("student")).toBe("student");
  });
});

describe("experience-model — homeSurface (Phase 3 / A2)", () => {
  it("is total over the 7 client roles (ops | floor, never undefined)", () => {
    for (const role of ALL_ROLES) {
      const surface: HomeSurface = homeSurfaceForRole(role);
      expect(surface === "ops" || surface === "floor").toBe(true);
    }
  });

  it("maps ops = admin + lead (senior/lead_technician), floor = vet + tech + student (I.4)", () => {
    expect(homeSurfaceForRole("admin")).toBe("ops");
    expect(homeSurfaceForRole("senior_technician")).toBe("ops");
    expect(homeSurfaceForRole("lead_technician")).toBe("ops");
    expect(homeSurfaceForRole("vet")).toBe("floor");
    expect(homeSurfaceForRole("technician")).toBe("floor");
    expect(homeSurfaceForRole("vet_tech")).toBe("floor");
    expect(homeSurfaceForRole("student")).toBe("floor");
  });

  it("buildRoleExperience derives homeSurface from the PERMANENT role", () => {
    const exp = buildRoleExperience({
      role: "admin",
      effectiveRole: "admin",
      roleSource: "permanent",
      isAdmin: true,
    });
    expect(exp.homeSurface).toBe("ops");
  });

  it("shift elevation changes capabilities but NEVER homeSurface (I.4)", () => {
    const base: ExperienceInput = {
      role: "technician",
      effectiveRole: "technician",
      roleSource: "permanent",
      isAdmin: false,
    };
    const elevated: ExperienceInput = {
      role: "technician",
      effectiveRole: "senior_technician",
      roleSource: "shift",
      isAdmin: false,
    };
    const permExp = buildRoleExperience(base);
    const shiftExp = buildRoleExperience(elevated);
    // capabilities DO react to the shift…
    expect(can(permExp, "shiftChat.broadcast")).toBe(false);
    expect(can(shiftExp, "shiftChat.broadcast")).toBe(true);
    // …but the home surface stays keyed to the permanent role.
    expect(permExp.homeSurface).toBe("floor");
    expect(shiftExp.homeSurface).toBe("floor");
  });

  it("degrades an unmapped runtime role to floor without throwing", () => {
    const run = () => homeSurfaceForRole("ghost_role" as unknown as UserRole);
    expect(run).not.toThrow();
    expect(run()).toBe("floor");
  });
});

describe("experience-model — capability parity with pre-Phase-2 checks", () => {
  // Parity is proven over the 5 roles the server actually emits. The two client
  // aliases (lead_technician / vet_tech) never reach runtime, and the archetype
  // model INTENTIONALLY maps them to lead/tech (the old exact-string checks never
  // handled them) — so sweeping parity over them would compare against dead paths.
  const DB_ROLES: UserRole[] = ["admin", "vet", "technician", "senior_technician", "student"];

  // Build the same (role, effectiveRole, roleSource, isAdmin) shapes useAuth produces.
  const permanentCases: ExperienceInput[] = DB_ROLES.flatMap((role) => [
    { role, effectiveRole: role, roleSource: "permanent", isAdmin: role === "admin" },
    // secondary-admin path: any role can carry isAdmin=true via secondaryRole==="admin"
    { role, effectiveRole: role, roleSource: "permanent", isAdmin: true },
  ]);
  const shiftCases: ExperienceInput[] = DB_ROLES.flatMap((role) =>
    SHIFT_ROLES.map((effectiveRole) => ({
      role,
      effectiveRole,
      roleSource: "shift" as const,
      // isAdmin is derived from the permanent role/secondary, never the shift role
      isAdmin: role === "admin",
    })),
  );
  const allCases = [...permanentCases, ...shiftCases];
  // Shift-chat reads role OR effectiveRole; both equal `role` when not on shift.
  const effShift = (c: ExperienceInput) => (c.roleSource === "shift" ? c.effectiveRole : c.role);

  it("codeBlue.manage matches layout.canAccessCodeBlue (permanent role + isAdmin, ignores shift)", () => {
    for (const c of allCases) {
      const exp = buildRoleExperience(c);
      expect(can(exp, "codeBlue.manage")).toBe(oldCanAccessCodeBlue(c.role, c.isAdmin));
    }
  });

  it("shiftChat.broadcast matches ShiftChatPanel.canSendBroadcast (respects shift, not secondary-admin)", () => {
    for (const c of allCases) {
      const exp = buildRoleExperience(c);
      expect(can(exp, "shiftChat.broadcast")).toBe(oldCanSendBroadcast(c.role, effShift(c)));
    }
  });

  it("shiftChat.pin matches ShiftChatPanel.canPin (respects shift, not secondary-admin)", () => {
    for (const c of allCases) {
      const exp = buildRoleExperience(c);
      expect(can(exp, "shiftChat.pin")).toBe(oldCanPin(c.role, effShift(c)));
    }
  });

  it("equipment.vetActions matches hasVetAccess (permanent role + isAdmin)", () => {
    for (const c of allCases) {
      const exp = buildRoleExperience(c);
      expect(can(exp, "equipment.vetActions")).toBe(oldHasVetAccess(c.role, effShift(c), c.isAdmin));
    }
  });

  it("app.adminNav matches the nav isAdmin gate exactly", () => {
    for (const c of allCases) {
      const exp = buildRoleExperience(c);
      expect(can(exp, "app.adminNav")).toBe(oldNavAdmin(c.isAdmin));
    }
  });
});

describe("experience-model — shift overlay is capabilities-only + shift-scoped", () => {
  it("a student shift-elevated to senior_technician gains shift-chat but NOT code-blue or admin nav", () => {
    const caps = resolveCapabilities({
      role: "student",
      effectiveRole: "senior_technician",
      roleSource: "shift",
      isAdmin: false,
    });
    expect(caps.has("shiftChat.broadcast")).toBe(true); // shift-sensitive → overlaid
    expect(caps.has("shiftChat.pin")).toBe(true);
    expect(caps.has("codeBlue.manage")).toBe(false); // standing authority — permanent role only
    expect(caps.has("app.adminNav")).toBe(false);
    expect(caps.has("equipment.vetActions")).toBe(false);
  });

  it("shift never changes the archetype (home/nav shape is stable under elevation)", () => {
    const permanent = buildRoleExperience({
      role: "technician",
      effectiveRole: "technician",
      roleSource: "permanent",
      isAdmin: false,
    });
    const elevated = buildRoleExperience({
      role: "technician",
      effectiveRole: "admin",
      roleSource: "shift",
      isAdmin: false,
    });
    expect(permanent.archetype).toBe("tech");
    expect(elevated.archetype).toBe("tech"); // unchanged by the shift
  });

  it("secondary-admin (isAdmin true on a non-admin role) grants the admin capability set", () => {
    const caps = resolveCapabilities({
      role: "student",
      effectiveRole: "student",
      roleSource: "permanent",
      isAdmin: true,
    });
    expect(caps.has("app.adminNav")).toBe(true);
    expect(caps.has("codeBlue.manage")).toBe(true);
    expect(caps.has("management.webWrite")).toBe(true);
  });
});

describe("experience-model — defensive against out-of-map runtime roles (crash-vs-degrade)", () => {
  // Compile-time types constrain roles to the 7-key union, but runtime values can
  // violate that (stale offline cache, unnormalized legacy alias in a vt_shifts.role
  // row). The model must degrade to no-grant, never throw on for...of undefined.
  it("does not throw and grants no shift caps when effectiveRole is an unmapped value", () => {
    const run = () =>
      resolveCapabilities({
        role: "technician",
        effectiveRole: "ghost_role" as unknown as ShiftRole,
        roleSource: "shift",
        isAdmin: false,
      });
    expect(run).not.toThrow();
    const caps = run();
    expect(caps.has("codeBlue.manage")).toBe(true); // from the permanent tech base
    expect(caps.has("shiftChat.broadcast")).toBe(false); // unknown shift role contributes nothing
    expect(caps.has("shiftChat.pin")).toBe(false);
  });

  it("does not throw and degrades to no-grant when the permanent role is unmapped", () => {
    const run = () =>
      resolveCapabilities({
        role: "legacy_role" as unknown as UserRole,
        effectiveRole: "legacy_role" as unknown as UserRole,
        roleSource: "permanent",
        isAdmin: false,
      });
    expect(run).not.toThrow();
    expect(run().size).toBe(0);
  });
});

describe("experience-model — student is a restricted-tech subset (Phase 8)", () => {
  // The permanent archetype base grant (no shift overlay, no secondary-admin) — the
  // raw CAPABILITIES_BY_ARCHETYPE entry, reached through the public resolver.
  const baseCaps = (role: UserRole): ReadonlySet<Capability> =>
    resolveCapabilities({ role, effectiveRole: role, roleSource: "permanent", isAdmin: false });

  // One representative DB role per archetype (aliases collapse onto these).
  const REP: Record<ExperienceArchetype, UserRole> = {
    admin: "admin",
    vet: "vet",
    lead: "senior_technician",
    tech: "technician",
    student: "student",
  };

  it("student ⊆ tech — every student cap is also a tech cap", () => {
    const tech = baseCaps("technician");
    const student = baseCaps("student");
    expect([...student].every((c) => tech.has(c))).toBe(true);
  });

  it("student ⊊ tech — a STRICT subset once tech carries ≥1 cap", () => {
    const tech = baseCaps("technician");
    const student = baseCaps("student");
    expect(tech.size).toBeGreaterThanOrEqual(1);
    expect(student.size).toBeLessThan(tech.size);
  });

  it("student baseline is EMPTY today — byte-identical to the pre-Phase-8 literal", () => {
    expect(
      resolveCapabilities({
        role: "student",
        effectiveRole: "student",
        roleSource: "permanent",
        isAdmin: false,
      }).size,
    ).toBe(0);
  });

  it("per-archetype capability snapshots (guards silent over/under-grant)", () => {
    // Exact base grant per archetype. A change here must be a deliberate edit — this
    // is the tripwire that a refactor (e.g. the student derivation) left grants intact.
    const SNAPSHOT: Record<ExperienceArchetype, Capability[]> = {
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
    for (const [archetype, expected] of Object.entries(SNAPSHOT) as [ExperienceArchetype, Capability[]][]) {
      const caps = [...baseCaps(REP[archetype])].sort();
      expect(caps).toEqual([...expected].sort());
    }
  });
});

describe("experience-model — TAB_BAR_ORDER_BY_ARCHETYPE seam (Phase 8, dormant)", () => {
  const ARCHETYPES: ExperienceArchetype[] = ["admin", "vet", "lead", "tech", "student"];
  const validTabIds = new Set(
    getNativeNavSections({ hasActiveShift: true }).flatMap((s) => s.items.map((i) => i.id)),
  );

  it("is total over the 5 archetypes — a non-empty order each, no undefined", () => {
    for (const archetype of ARCHETYPES) {
      const order = TAB_BAR_ORDER_BY_ARCHETYPE[archetype];
      expect(order).toBeDefined();
      expect(order.length).toBeGreaterThan(0);
    }
  });

  it("every ordered id is a real native-nav item id, with no duplicates", () => {
    for (const archetype of ARCHETYPES) {
      const order = TAB_BAR_ORDER_BY_ARCHETYPE[archetype];
      for (const id of order) expect(validTabIds.has(id)).toBe(true);
      expect(new Set(order).size).toBe(order.length);
    }
  });
});

describe("filterAdminNav — byte-identical to the pre-Phase-2 nav gate", () => {
  const ALL_ROLES: UserRole[] = [
    "admin",
    "vet",
    "technician",
    "senior_technician",
    "lead_technician",
    "vet_tech",
    "student",
  ];
  const expFor = (role: UserRole) =>
    buildRoleExperience({ role, effectiveRole: role, roleSource: "permanent", isAdmin: role === "admin" });

  it("web NAV visibility matches the old `!adminOnly || isAdmin` filter for every role", () => {
    for (const role of ALL_ROLES) {
      const before = NAV.filter((n) => !n.adminOnly || role === "admin").map((n) => n.id);
      const after = filterAdminNav(NAV, expFor(role)).map((n) => n.id);
      expect(after).toEqual(before);
    }
  });

  it("native sections visibility matches the old `!adminOnly || isAdmin` filter for every role", () => {
    const sections = getNativeNavSections({ hasActiveShift: true });
    for (const role of ALL_ROLES) {
      const before = sections.filter((s) => !s.adminOnly || role === "admin").map((s) => s.id);
      const after = filterAdminNav(sections, expFor(role)).map((s) => s.id);
      expect(after).toEqual(before);
    }
  });
});

describe("experience-model — custody-only archetype (student)", () => {
  const exp = (role: UserRole) => buildRoleExperience({ role, effectiveRole: role, roleSource: "permanent", isAdmin: role === "admin" });

  it("isCustodyOnly is true only for the student archetype", () => {
    expect(isCustodyOnly(exp("student"))).toBe(true);
    for (const role of ["admin", "vet", "senior_technician", "technician"] as const) {
      expect(isCustodyOnly(exp(role))).toBe(false);
    }
  });

  it("filterCustodyNav pares the native operations items to the custody set for a student", () => {
    const ops = getNativeNavSections()[0].items;
    const studentIds = filterCustodyNav(ops, exp("student")).map((i) => i.id);
    // Allowed: home + scan (checkout/checkin) + equipment + my-equipment + inventory.
    expect(new Set(studentIds)).toEqual(new Set(["today", "scan", "equipment", "mine", "inventory"]));
    // Explicitly NOT present: emergency / tasks / crash-cart / rooms / alerts.
    for (const denied of ["emergency", "tasks", "crash-cart", "rooms", "alerts"]) {
      expect(studentIds).not.toContain(denied);
    }
  });

  it("filterCustodyNav is a no-op for non-custody archetypes", () => {
    const ops = getNativeNavSections()[0].items;
    for (const role of ["admin", "vet", "technician"] as const) {
      expect(filterCustodyNav(ops, exp(role)).length).toBe(ops.length);
    }
  });
});
