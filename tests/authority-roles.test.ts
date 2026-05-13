import { describe, expect, it } from "vitest";
import {
  mapLegacyRoleToSystemRole,
  mapLegacyRoleToClinicalRole,
  normalizeShiftRoleToClinical,
} from "../server/lib/authority-roles.js";

// ---------------------------------------------------------------------------
// mapLegacyRoleToSystemRole
// ---------------------------------------------------------------------------

describe("mapLegacyRoleToSystemRole", () => {
  it("maps 'admin' → 'Admin'", () => {
    expect(mapLegacyRoleToSystemRole("admin")).toBe("Admin");
  });

  it.each(["vet", "senior_technician", "technician", "student"])(
    "maps '%s' → 'User'",
    (role) => {
      expect(mapLegacyRoleToSystemRole(role)).toBe("User");
    },
  );

  it("maps legacy aliases → 'User'", () => {
    expect(mapLegacyRoleToSystemRole("lead_technician")).toBe("User");
    expect(mapLegacyRoleToSystemRole("vet_tech")).toBe("User");
  });

  it("maps unrecognized strings → 'User'", () => {
    expect(mapLegacyRoleToSystemRole("viewer")).toBe("User");
    expect(mapLegacyRoleToSystemRole("unknown_role")).toBe("User");
    expect(mapLegacyRoleToSystemRole("")).toBe("User");
  });

  it("normalizes casing", () => {
    expect(mapLegacyRoleToSystemRole("Admin")).toBe("Admin");
    expect(mapLegacyRoleToSystemRole("ADMIN")).toBe("Admin");
  });

  it("normalizes surrounding whitespace", () => {
    expect(mapLegacyRoleToSystemRole("  admin  ")).toBe("Admin");
  });

  it("never returns null", () => {
    for (const input of ["admin", "vet", "viewer", "", "unknown"]) {
      expect(mapLegacyRoleToSystemRole(input)).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// "viewer" legacy alias — Phase 2A decision
//
// auth.ts normalizes the pre-migration DB value "viewer" to "student" on the
// way into the system. Phase 2A classifiers do NOT replicate that quirk:
// "viewer" is treated as an unknown legacy role here. By the time a role
// reaches these classifiers it should already be canonical.
// ---------------------------------------------------------------------------

describe("'viewer' legacy alias (Phase 2A decision)", () => {
  it("mapLegacyRoleToSystemRole('viewer') → 'User'", () => {
    expect(mapLegacyRoleToSystemRole("viewer")).toBe("User");
  });

  it("mapLegacyRoleToClinicalRole('viewer') → null (no viewer→student in 2A)", () => {
    expect(mapLegacyRoleToClinicalRole("viewer")).toBeNull();
  });

  it("normalizeShiftRoleToClinical('viewer') → null", () => {
    expect(normalizeShiftRoleToClinical("viewer")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapLegacyRoleToClinicalRole
// ---------------------------------------------------------------------------

describe("mapLegacyRoleToClinicalRole", () => {
  it("maps 'admin' → null (no clinical role)", () => {
    expect(mapLegacyRoleToClinicalRole("admin")).toBeNull();
  });

  it("maps 'vet' → 'vet'", () => {
    expect(mapLegacyRoleToClinicalRole("vet")).toBe("vet");
  });

  it("maps 'senior_technician' → 'senior_technician'", () => {
    expect(mapLegacyRoleToClinicalRole("senior_technician")).toBe("senior_technician");
  });

  it("maps legacy alias 'lead_technician' → 'senior_technician'", () => {
    expect(mapLegacyRoleToClinicalRole("lead_technician")).toBe("senior_technician");
  });

  it("maps 'technician' → 'technician'", () => {
    expect(mapLegacyRoleToClinicalRole("technician")).toBe("technician");
  });

  it("maps legacy alias 'vet_tech' → 'technician'", () => {
    expect(mapLegacyRoleToClinicalRole("vet_tech")).toBe("technician");
  });

  it("maps 'student' → 'student'", () => {
    expect(mapLegacyRoleToClinicalRole("student")).toBe("student");
  });

  it("maps unrecognized strings → null", () => {
    expect(mapLegacyRoleToClinicalRole("viewer")).toBeNull();
    expect(mapLegacyRoleToClinicalRole("unknown_role")).toBeNull();
    expect(mapLegacyRoleToClinicalRole("")).toBeNull();
  });

  it("normalizes casing and whitespace", () => {
    expect(mapLegacyRoleToClinicalRole("Vet")).toBe("vet");
    expect(mapLegacyRoleToClinicalRole("  technician  ")).toBe("technician");
    expect(mapLegacyRoleToClinicalRole("Lead_Technician")).toBe("senior_technician");
  });
});

// ---------------------------------------------------------------------------
// normalizeShiftRoleToClinical
// ---------------------------------------------------------------------------

describe("normalizeShiftRoleToClinical", () => {
  it("maps 'vet' → 'vet'", () => {
    expect(normalizeShiftRoleToClinical("vet")).toBe("vet");
  });

  it("maps 'senior_technician' → 'senior_technician'", () => {
    expect(normalizeShiftRoleToClinical("senior_technician")).toBe("senior_technician");
  });

  it("maps legacy alias 'lead_technician' → 'senior_technician'", () => {
    expect(normalizeShiftRoleToClinical("lead_technician")).toBe("senior_technician");
  });

  it("maps 'technician' → 'technician'", () => {
    expect(normalizeShiftRoleToClinical("technician")).toBe("technician");
  });

  it("maps legacy alias 'vet_tech' → 'technician'", () => {
    expect(normalizeShiftRoleToClinical("vet_tech")).toBe("technician");
  });

  it("maps 'student' → null (student never elevated)", () => {
    expect(normalizeShiftRoleToClinical("student")).toBeNull();
  });

  it("maps 'admin' → null (no clinical shift role)", () => {
    expect(normalizeShiftRoleToClinical("admin")).toBeNull();
  });

  it("maps null → null", () => {
    expect(normalizeShiftRoleToClinical(null)).toBeNull();
  });

  it("maps unrecognized strings → null", () => {
    expect(normalizeShiftRoleToClinical("viewer")).toBeNull();
    expect(normalizeShiftRoleToClinical("unknown_role")).toBeNull();
    expect(normalizeShiftRoleToClinical("")).toBeNull();
  });

  it("normalizes casing and whitespace", () => {
    expect(normalizeShiftRoleToClinical("VET")).toBe("vet");
    expect(normalizeShiftRoleToClinical("Technician")).toBe("technician");
    expect(normalizeShiftRoleToClinical("  senior_technician  ")).toBe("senior_technician");
    expect(normalizeShiftRoleToClinical("Lead_Technician")).toBe("senior_technician");
  });

  it("never returns 'student'", () => {
    for (const input of ["student", "STUDENT", "Student", "  student  "]) {
      const result = normalizeShiftRoleToClinical(input);
      expect(result).not.toBe("student");
      expect(result).toBeNull();
    }
  });

  it("never returns 'admin'", () => {
    for (const input of ["admin", "ADMIN", "Admin", "  admin  "]) {
      const result = normalizeShiftRoleToClinical(input);
      expect(result).not.toBe("admin");
      expect(result).toBeNull();
    }
  });
});
