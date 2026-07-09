import { describe, it, expect } from "vitest";
import type { UserRole } from "@/types/platform";
import { buildRoleExperience, type ExperienceInput } from "@/lib/roles/experience-model";
import {
  WEB_MANAGEMENT_NAV,
  WEB_MANAGEMENT_HREFS,
  visibleWebManagementNav,
  type WebManagementGroup,
} from "@/lib/routes/web-management-nav-model";

const GROUPS: WebManagementGroup[] = ["administration", "operations"];
const permanent = (role: UserRole, isAdmin = role === "admin"): ExperienceInput => ({
  role,
  effectiveRole: role,
  roleSource: "permanent",
  isAdmin,
});

describe("web-management-nav-model — structure", () => {
  it("every node is gated on management.web", () => {
    for (const n of WEB_MANAGEMENT_NAV) {
      expect(n.reach).toBe("management.web");
    }
  });

  it("uses only known groups and unique ids/hrefs", () => {
    for (const n of WEB_MANAGEMENT_NAV) {
      expect(GROUPS).toContain(n.group);
    }
    expect(new Set(WEB_MANAGEMENT_NAV.map((n) => n.id)).size).toBe(WEB_MANAGEMENT_NAV.length);
    expect(new Set(WEB_MANAGEMENT_NAV.map((n) => n.href)).size).toBe(WEB_MANAGEMENT_NAV.length);
  });

  it("WEB_MANAGEMENT_HREFS mirrors the node hrefs (dead-link parity)", () => {
    expect(WEB_MANAGEMENT_HREFS).toEqual(WEB_MANAGEMENT_NAV.map((n) => n.href));
  });

  it("labelKeys are nav.* keys, never literals", () => {
    for (const n of WEB_MANAGEMENT_NAV) {
      expect(n.labelKey.startsWith("nav.")).toBe(true);
    }
  });

  it("only administration modules carry a write capability (ops-health is read-only)", () => {
    const opsHealth = WEB_MANAGEMENT_NAV.find((n) => n.id === "mgmt-ops-health");
    expect(opsHealth?.writeCap).toBeUndefined();
    expect(opsHealth?.group).toBe("operations");
  });

  it("7f: People & Roles node is present, administration group, writable", () => {
    const people = WEB_MANAGEMENT_NAV.find((n) => n.id === "mgmt-people");
    expect(people).toBeDefined();
    expect(people?.href).toBe("/admin/people");
    expect(people?.labelKey).toBe("nav.people");
    expect(people?.icon).toBe("Users");
    expect(people?.group).toBe("administration");
    expect(people?.writeCap).toBe("management.webWrite");
  });

  it("7c: Equipment Governance node is present, administration group, writable", () => {
    const gov = WEB_MANAGEMENT_NAV.find((n) => n.id === "mgmt-governance");
    expect(gov).toBeDefined();
    expect(gov?.href).toBe("/admin/governance");
    expect(gov?.labelKey).toBe("nav.governance");
    expect(gov?.icon).toBe("ShieldCheck");
    expect(gov?.group).toBe("administration");
    expect(gov?.writeCap).toBe("management.webWrite");
  });

  it("7e: Analytics node is present, operations group, read-only", () => {
    const an = WEB_MANAGEMENT_NAV.find((n) => n.id === "mgmt-analytics");
    expect(an).toBeDefined();
    expect(an?.href).toBe("/analytics");
    expect(an?.labelKey).toBe("nav.analytics");
    expect(an?.icon).toBe("BarChart3");
    expect(an?.group).toBe("operations");
    expect(an?.writeCap).toBeUndefined();
  });

  it("7d: Inventory node is present, administration group, read-only", () => {
    const inv = WEB_MANAGEMENT_NAV.find((n) => n.id === "mgmt-inventory");
    expect(inv).toBeDefined();
    expect(inv?.href).toBe("/admin/inventory");
    expect(inv?.labelKey).toBe("nav.inventory");
    expect(inv?.icon).toBe("Package");
    expect(inv?.group).toBe("administration");
    expect(inv?.writeCap).toBeUndefined();
  });

  it("7e: Audit Log node is present, administration group, read-only", () => {
    const audit = WEB_MANAGEMENT_NAV.find((n) => n.id === "mgmt-audit");
    expect(audit).toBeDefined();
    expect(audit?.href).toBe("/admin/audit-log");
    expect(audit?.labelKey).toBe("nav.auditLog");
    expect(audit?.icon).toBe("ScrollText");
    expect(audit?.group).toBe("administration");
    expect(audit?.writeCap).toBeUndefined();
  });

  it("7a: Management Home node is present (restaged /dashboard), operations, read-only", () => {
    const home = WEB_MANAGEMENT_NAV.find((n) => n.id === "mgmt-home");
    expect(home).toBeDefined();
    expect(home?.href).toBe("/dashboard");
    expect(home?.labelKey).toBe("nav.managementHome");
    expect(home?.icon).toBe("Gauge");
    expect(home?.group).toBe("operations");
    expect(home?.writeCap).toBeUndefined();
  });
});

describe("web-management-nav-model — capability visibility", () => {
  it("admin, lead (senior + lead_technician), and secondary-admin see the console", () => {
    const visible = (input: ExperienceInput) => visibleWebManagementNav(buildRoleExperience(input));
    expect(visible(permanent("admin"))).toHaveLength(WEB_MANAGEMENT_NAV.length);
    expect(visible(permanent("senior_technician"))).toHaveLength(WEB_MANAGEMENT_NAV.length);
    expect(visible(permanent("lead_technician"))).toHaveLength(WEB_MANAGEMENT_NAV.length);
    // secondary-admin: non-admin primary role carrying isAdmin
    expect(visible(permanent("technician", true))).toHaveLength(WEB_MANAGEMENT_NAV.length);
  });

  it("vet, tech, and student do not see the console", () => {
    const hidden = (input: ExperienceInput) => visibleWebManagementNav(buildRoleExperience(input));
    expect(hidden(permanent("vet"))).toHaveLength(0);
    expect(hidden(permanent("technician"))).toHaveLength(0);
    expect(hidden(permanent("student"))).toHaveLength(0);
  });
});
