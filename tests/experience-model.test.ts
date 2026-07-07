import { describe, it, expect } from "vitest";
import type { UserRole, ShiftRole } from "@/types/platform";
import {
  archetypeForRole,
  buildRoleExperience,
  can,
  resolveCapabilities,
  type ExperienceInput,
} from "@/lib/roles/experience-model";

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
